from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdminOrOperator

from .serializers import TicketCheckSerializer
from .services import find_ticket


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
