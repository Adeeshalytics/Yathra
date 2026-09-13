"""The SMS gateways, and the text rules every message goes through."""

import io
import json
import logging
from urllib import error, parse

import pytest
from django.test import override_settings

from apps.notifications import sms
from apps.notifications.sms import ConsoleBackend, NotifyLkBackend, SmsError, get_backend
from apps.notifications.text import is_gsm, mask_email, mask_phone, sms_parts, sms_safe

NOTIFYLK = {
    "BACKEND": "notifylk",
    "SENDER_ID": "Yathra",
    "NOTIFYLK_USER_ID": "12345",
    "NOTIFYLK_API_KEY": "secret-api-key",
    "TIMEOUT_SECONDS": 2,
}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def gateway(monkeypatch):
    """Stands in for Notify.lk: records the request and answers with `reply`."""
    calls = []
    state = {"reply": {"status": "success", "data": "Sent"}, "raise": None}

    def urlopen(req, timeout):
        calls.append(
            {"url": req.full_url, "fields": parse.parse_qs(req.data.decode()), "timeout": timeout}
        )
        if state["raise"] is not None:
            raise state["raise"]
        return FakeResponse(json.dumps(state["reply"]).encode())

    monkeypatch.setattr("apps.notifications.sms.request.urlopen", urlopen)
    return calls, state


class TestNotifyLk:
    @pytest.fixture(autouse=True)
    def _notify_lk(self, settings):
        settings.SMS = NOTIFYLK

    def test_a_message_is_posted_the_way_notify_lk_expects(self, gateway):
        calls, _ = gateway

        message_id = get_backend().send("+94771234567", "Your ticket")

        assert message_id == "Sent"
        call = calls[0]
        assert call["url"] == "https://app.notify.lk/api/v1/send"
        assert call["fields"]["to"] == ["94771234567"]
        assert call["fields"]["sender_id"] == ["Yathra"]
        assert call["fields"]["message"] == ["Your ticket"]
        assert "type" not in call["fields"]
        assert call["timeout"] == 2

    def test_sinhala_or_tamil_text_is_sent_as_unicode(self, gateway):
        calls, _ = gateway

        get_backend().send("+94771234567", "ඔබේ ටිකට් පත")

        assert calls[0]["fields"]["type"] == ["unicode"]

    def test_a_refusal_is_final_and_never_repeats_the_api_key(self, gateway):
        _, state = gateway
        state["reply"] = {"status": "error", "errors": "Invalid sender id"}

        with pytest.raises(SmsError) as caught:
            get_backend().send("+94771234567", "Hello")

        assert caught.value.retryable is False
        assert "Invalid sender id" in str(caught.value)
        assert "secret-api-key" not in str(caught.value)

    @pytest.mark.parametrize(
        ("problem", "retryable"),
        [
            (error.HTTPError("https://app.notify.lk", 503, "down", {}, None), True),
            (error.HTTPError("https://app.notify.lk", 429, "slow", {}, None), True),
            (error.HTTPError("https://app.notify.lk", 401, "no", {}, None), False),
            (error.URLError("timed out"), True),
            (TimeoutError(), True),
        ],
    )
    def test_what_is_worth_retrying(self, gateway, problem, retryable):
        _, state = gateway
        state["raise"] = problem

        with pytest.raises(SmsError) as caught:
            get_backend().send("+94771234567", "Hello")

        assert caught.value.retryable is retryable
        assert "secret-api-key" not in str(caught.value)

    def test_missing_credentials_are_reported_not_retried(self, gateway, settings):
        settings.SMS = {**NOTIFYLK, "NOTIFYLK_API_KEY": ""}

        with pytest.raises(SmsError) as caught:
            NotifyLkBackend().send("+94771234567", "Hello")

        assert caught.value.retryable is False
        assert gateway[0] == []


class TestBackends:
    def test_the_console_backend_writes_the_message_to_the_log(self, caplog):
        caplog.set_level(logging.INFO, logger="apps.notifications.sms")

        ConsoleBackend().send("+94771234567", "Hello there")

        assert "Hello there" in caplog.text

    @override_settings(SMS={"BACKEND": ""})
    def test_an_empty_backend_switches_texts_off(self):
        assert sms.sms_enabled() is False
        assert get_backend() is None

    @override_settings(SMS={"BACKEND": "pigeon"})
    def test_an_unknown_backend_counts_as_off(self):
        assert get_backend() is None


class TestTextRules:
    def test_typographic_punctuation_is_made_plain(self):
        text = sms_safe("Colombo – Kandy isn’t “far”…")

        assert text == 'Colombo - Kandy isn\'t "far"...'
        assert is_gsm(text)

    def test_parts_are_counted_the_way_networks_bill_them(self):
        assert sms_parts("a" * 160) == 1
        assert sms_parts("a" * 161) == 2
        assert sms_parts("a" * 306) == 2
        assert sms_parts("€" * 80) == 1  # two characters each
        assert sms_parts("ට" * 70) == 1
        assert sms_parts("ට" * 71) == 2

    def test_numbers_and_addresses_are_masked_for_logs(self):
        assert mask_phone("+94771234567") == "+9477*****67"
        assert mask_email("kasuni@example.com") == "k***@example.com"
