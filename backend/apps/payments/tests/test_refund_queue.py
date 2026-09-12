"""Phase 6: refund records and the queue the support team works through."""

import pytest

from apps.payments.models import Payment, PaymentStatus, Refund, RefundStatus

from .conftest import booking_url, client_for, expire_bookings, lock, notify, start

pytestmark = pytest.mark.django_db

REFUNDS = "/api/v1/refunds/"
ADMIN_REFUNDS = "/api/v1/admin/refunds/"


def cancelled_booking(customer, trip) -> Refund:
    """A paid booking the customer then cancelled: the refund request it raised."""
    client = client_for(customer)
    booking, payment = start(client, trip, "15")
    notify(payment)
    response = client.post(booking_url(booking, "cancel/"), {"reason": "Plans changed"})
    assert response.status_code == 200, response.content
    return Refund.objects.get(booking_id=booking["id"])


def move(staff, refund, status, **body):
    return client_for(staff).post(
        f"{ADMIN_REFUNDS}{refund.pk}/status/", {"status": status, **body}, format="json"
    )


class TestTheQueue:
    def test_a_cancellation_raises_a_request_with_its_paper_trail(self, trip, alice, staff):
        refund = cancelled_booking(alice, trip)

        body = client_for(staff).get(f"{ADMIN_REFUNDS}{refund.pk}/").json()

        assert body["status"] == "requested"
        assert body["reference"].startswith("RF")
        assert body["amount"] == "2500.00"
        assert body["reason"] == "Plans changed"
        assert body["customer"]["email"] == alice.email
        assert body["trip"]["code"] == trip.code
        assert body["payment"]["transaction_reference"].startswith("TXN")
        assert body["payment"]["refund_through_gateway"] is True
        assert body["requested_by"] == alice.email
        assert body["breakdown"]["refund_percent"] == "100"

    def test_it_moves_requested_to_processing_to_completed(self, trip, alice, staff):
        refund = cancelled_booking(alice, trip)

        processing = move(staff, refund, RefundStatus.PROCESSING)
        completed = move(staff, refund, RefundStatus.COMPLETED, note="Sent back to the card")

        assert processing.json()["status"] == "processing"
        assert processing.json()["resolved_at"] is None
        assert completed.status_code == 200, completed.content
        body = completed.json()
        assert (body["status"], body["resolution"]) == ("completed", "Sent back to the card")
        assert body["resolved_at"] is not None
        assert body["resolved_by"] == staff.email
        # Completing actually moves the money back through the gateway.
        payment = Payment.objects.get(booking_id=refund.booking_id)
        assert payment.status == PaymentStatus.REFUNDED
        assert str(payment.refunded_amount) == "2500.00"
        assert payment.requires_refund is False

    def test_rejecting_leaves_the_money_where_it_is(self, trip, alice, staff):
        refund = cancelled_booking(alice, trip)

        rejected = move(staff, refund, RefundStatus.REJECTED, note="Outside the policy")

        assert rejected.json()["status"] == "rejected"
        assert rejected.json()["resolution"] == "Outside the policy"
        payment = Payment.objects.get(booking_id=refund.booking_id)
        assert (payment.status, str(payment.refunded_amount)) == (PaymentStatus.SUCCESSFUL, "0.00")
        # Turned down is still settled: the payment stops asking to be refunded.
        assert payment.requires_refund is False

    def test_a_part_refund_settles_what_the_payment_owed(self, trip, alice, staff):
        """The policy keeps half the fare, so completing the request clears the whole debt."""
        refund = cancelled_booking(alice, trip)
        Refund.objects.filter(pk=refund.pk).update(amount="1250.00")
        refund.refresh_from_db()

        move(staff, refund, RefundStatus.COMPLETED)

        payment = Payment.objects.get(booking_id=refund.booking_id)
        assert payment.status == PaymentStatus.PARTIALLY_REFUNDED
        assert str(payment.refunded_amount) == "1250.00"
        assert payment.requires_refund is False

    def test_a_resolved_refund_cannot_be_resolved_again(self, trip, alice, staff):
        refund = cancelled_booking(alice, trip)
        move(staff, refund, RefundStatus.COMPLETED)

        again = move(staff, refund, RefundStatus.REJECTED, note="Changed my mind")

        assert again.status_code == 409
        assert again.json()["error"]["code"] == "refund_resolved"
        assert Refund.objects.get(pk=refund.pk).status == RefundStatus.COMPLETED

    def test_filters_and_search(self, trip, alice, staff):
        refund = cancelled_booking(alice, trip)
        client = client_for(staff)

        open_only = client.get(ADMIN_REFUNDS, {"status": "requested"}).json()
        completed = client.get(ADMIN_REFUNDS, {"status": "completed"}).json()
        by_reference = client.get(ADMIN_REFUNDS, {"search": refund.reference}).json()

        assert open_only["count"] == 1
        assert completed["count"] == 0
        assert by_reference["count"] == 1

    def test_a_payment_that_could_not_be_used_queues_itself(self, trip, alice, bob):
        """Phase 5's "paid, but the seats had gone" now lands in the same queue."""
        client = client_for(alice)
        booking, payment = start(client, trip, "15")
        expire_bookings()
        assert lock(client_for(bob), trip, "15").status_code == 201  # someone else took the seat

        notify(payment)

        refund = Refund.objects.get(booking_id=booking["id"])
        assert (refund.status, str(refund.amount)) == (RefundStatus.REQUESTED, "2500.00")
        assert refund.breakdown["source"] == "payment_could_not_be_used"
        assert refund.requested_by_id is None


class TestWhatCustomersSee:
    def test_customers_follow_their_own_refunds(self, trip, alice, staff):
        refund = cancelled_booking(alice, trip)
        move(staff, refund, RefundStatus.PROCESSING)

        body = client_for(alice).get(REFUNDS).json()

        [row] = body["results"]
        assert (row["reference"], row["status"], row["status_label"]) == (
            refund.reference,
            "processing",
            "Processing",
        )
        assert row["amount"] == "2500.00"
        assert "breakdown" not in row  # internal notes stay internal

    def test_the_booking_carries_its_refunds(self, trip, alice):
        refund = cancelled_booking(alice, trip)

        body = client_for(alice).get(booking_url({"id": str(refund.booking_id)})).json()

        assert [row["reference"] for row in body["refunds"]] == [refund.reference]

    def test_customers_cannot_move_their_own_refund_along(self, trip, alice):
        refund = cancelled_booking(alice, trip)

        response = client_for(alice).post(
            f"{ADMIN_REFUNDS}{refund.pk}/status/", {"status": "completed"}, format="json"
        )

        assert response.status_code == 403
        assert Refund.objects.get(pk=refund.pk).status == RefundStatus.REQUESTED
