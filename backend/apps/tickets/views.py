import logging
import re

from django.conf import settings
from django.db.models import Q
from django.http import Http404, HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdminOrOperator
from apps.bookings.models import Booking, BookingStatus
from apps.core.exceptions import ServiceUnavailable
from apps.core.logging import client_ip, log_event
from apps.core.renderers import PDFRenderer
from apps.notifications.services import resend_ticket
from apps.notifications.sms import sms_enabled
from apps.notifications.text import mask_phone

from .models import Ticket
from .pdf import render_ticket_pdf
from .serializers import (
    FindTicketSerializer,
    SharedTicketSerializer,
    TicketCheckSerializer,
    paying_payment,
)
from .services import find_ticket

SHARE_CODE = re.compile(r"[A-Za-z0-9_-]{16,32}")
FIND_ANSWER = (
    "If that booking reference and phone number match a paid booking, we’ve texted the ticket "
    "to that number. It can take a minute to arrive."
)


class TicketVerifyView(APIView):
    """
    Check a ticket at the bus door: scan its QR code (or type the ticket number). Admins can
    check any ticket; operator staff only tickets for their company's trips.
    """

    permission_classes = [IsAdminOrOperator]

    @extend_schema(
        summary="Check a scanned e-ticket",
        parameters=[OpenApiParameter("code", OpenApiTypes.STR, required=True)],
        responses=TicketCheckSerializer,
    )
    def get(self, request, *args, **kwargs):
        code = request.query_params.get("code", "").strip()
        if not code:
            raise ValidationError({"code": ["Scan the QR code or type the ticket number."]})
        ticket = find_ticket(code, request.user)
        if ticket is None:
            raise NotFound(
                "This code doesn’t match a ticket you can check.", code="ticket_not_found"
            )
        return Response(TicketCheckSerializer(ticket).data)


class _PublicTicketView(APIView):
    # The link is the credential: no session is read, and nothing is cached on the way.
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]


def shared_ticket(code: str) -> Ticket:
    if not SHARE_CODE.fullmatch(code or ""):
        raise Http404("This ticket link isn’t valid.")
    ticket = (
        Ticket.objects.select_related(
            "booking__trip__route__origin",
            "booking__trip__route__destination",
            "booking__trip__bus",
            "booking__trip__operator",
            "booking__boarding_stop",
            "booking__dropoff_stop",
        )
        .prefetch_related("booking__passengers", "booking__payments")
        .filter(share_code=code)
        .first()
    )
    if ticket is None:
        raise Http404("This ticket link isn’t valid.")
    return ticket


class SharedTicketView(_PublicTicketView):
    """The e-ticket behind the link in a ticket SMS or e-mail."""

    throttle_scope = "ticket_link"

    @extend_schema(summary="Open a shared e-ticket link", responses=SharedTicketSerializer)
    def get(self, request, code: str, *args, **kwargs):
        response = Response(SharedTicketSerializer(shared_ticket(code)).data)
        response["Cache-Control"] = "private, no-store"
        return response


class SharedTicketPdfView(_PublicTicketView):
    throttle_scope = "ticket_link"
    renderer_classes = [JSONRenderer, PDFRenderer]

    @extend_schema(
        summary="Download a shared e-ticket as a PDF",
        responses={(200, "application/pdf"): OpenApiTypes.BINARY},
    )
    def get(self, request, code: str, *args, **kwargs):
        ticket = shared_ticket(code)
        pdf = render_ticket_pdf(ticket, payment=paying_payment(ticket.booking))
        response = HttpResponse(pdf, content_type="application/pdf")
        filename = f"{settings.APP_NAME.lower()}-ticket-{ticket.booking.booking_reference}.pdf"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["Cache-Control"] = "private, no-store"
        return response


class FindTicketView(_PublicTicketView):
    """
    "Find my booking": the booking reference and a phone number on the booking. The ticket is
    texted to that phone — never shown here — so knowing a reference reveals nothing, and the
    answer is the same whether or not anything matched.
    """

    throttle_scope = "ticket_find"

    @extend_schema(
        summary="Text a booking's e-ticket to a phone number on the booking",
        request=FindTicketSerializer,
        responses={202: OpenApiTypes.OBJECT},
    )
    def post(self, request, *args, **kwargs):
        body = FindTicketSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        if not sms_enabled():
            raise ServiceUnavailable(
                "We can’t send text messages right now. Please contact our support team.",
                code="sms_unavailable",
            )
        reference, phone = body.validated_data["reference"], body.validated_data["phone"]
        booking = (
            Booking.objects.filter(booking_reference=reference, status=BookingStatus.CONFIRMED)
            .filter(Q(customer__phone=phone) | Q(passengers__phone=phone))
            .first()
        )
        sent = bool(booking and resend_ticket(booking, phone=phone))
        log_event(
            "ticket.find_requested",
            level=logging.INFO if booking else logging.WARNING,
            matched=booking is not None,
            sent=sent,
            booking_reference=booking.booking_reference if booking else None,
            phone=mask_phone(phone),
            client_ip=client_ip(request),
        )
        return Response({"detail": FIND_ANSWER}, status=status.HTTP_202_ACCEPTED)
