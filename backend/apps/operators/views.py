from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsOperator

from .selectors import get_active_membership
from .serializers import OperatorProfileSerializer


class OperatorProfileView(APIView):
    """The company the signed-in operator user belongs to (visible even while pending approval)."""

    permission_classes = [IsOperator]

    @extend_schema(responses=OperatorProfileSerializer, summary="Signed-in operator's company")
    def get(self, request, *args, **kwargs):
        membership = get_active_membership(request.user)
        if membership is None:
            raise NotFound("No operator company is linked to this account yet.")
        return Response(OperatorProfileSerializer(membership).data)
