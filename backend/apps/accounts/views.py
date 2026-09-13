import contextlib
import logging

from django.contrib.auth.models import update_last_login
from django.core.exceptions import ObjectDoesNotExist
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.core.exceptions import error_payload
from apps.core.logging import client_ip, log_event

from .cookies import clear_refresh_cookie, get_refresh_token, set_refresh_cookie
from .models import User
from .phone import link_proven_phone, request_code, verify_code
from .serializers import (
    AuthResponseSerializer,
    ChangePasswordSerializer,
    LoginSerializer,
    LogoutRequestSerializer,
    PhoneCodeRequestSerializer,
    PhoneCodeSentSerializer,
    PhoneCodeVerifySerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    UserSerializer,
)


def _auth_response(user: User, refresh: str, access: str, status_code: int) -> Response:
    response = Response({"access": access, "user": UserSerializer(user).data}, status=status_code)
    set_refresh_cookie(response, refresh)
    return response


class _PublicAuthView(APIView):
    # These endpoints must work with no (or an expired) access token, so skip JWT auth entirely.
    authentication_classes = []
    permission_classes = [AllowAny]

    def get_authenticate_header(self, request) -> str:
        # Without an authenticator DRF would downgrade AuthenticationFailed to 403; bad
        # credentials are a 401.
        return 'Bearer realm="api"'


class RegisterView(_PublicAuthView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(
        request=RegisterSerializer,
        responses={201: AuthResponseSerializer},
        summary="Register a customer account and start a session",
    )
    def post(self, request, *args, **kwargs):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = LoginSerializer.get_token(user)
        update_last_login(None, user)
        log_event("auth.registered", user_id=str(user.pk), role=user.role)
        return _auth_response(
            user, str(refresh), str(refresh.access_token), status.HTTP_201_CREATED
        )


class LoginView(_PublicAuthView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(
        request=LoginSerializer,
        responses={
            200: AuthResponseSerializer,
            401: OpenApiResponse(description="Bad credentials"),
        },
        summary="Log in with email and password (all roles)",
    )
    def post(self, request, *args, **kwargs):
        serializer = LoginSerializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except Exception:
            # Never log the password, and never say which half was wrong.
            log_event(
                "auth.login_failed",
                level=logging.WARNING,
                email=str(request.data.get("email", ""))[:150],
                client_ip=client_ip(request),
            )
            raise
        data = serializer.validated_data
        user = serializer.user
        if serializer.phone_proof:
            link_proven_phone(user, serializer.phone_proof)
        log_event("auth.login", user_id=str(user.pk), role=user.role)
        return _auth_response(user, data["refresh"], data["access"], status.HTTP_200_OK)


class PhoneCodeRequestView(_PublicAuthView):
    """Text a six-digit sign-in code to a phone number."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "phone_code"

    @extend_schema(
        request=PhoneCodeRequestSerializer,
        responses={
            202: PhoneCodeSentSerializer,
            429: OpenApiResponse(description="Asked again too soon (see retry_after)"),
            503: OpenApiResponse(description="Text messages are unavailable"),
        },
        summary="Send a sign-in code by SMS (customers)",
    )
    def post(self, request, *args, **kwargs):
        body = PhoneCodeRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        sent = request_code(body.validated_data["phone"])
        return Response(sent.as_dict(), status=status.HTTP_202_ACCEPTED)


class PhoneCodeVerifyView(_PublicAuthView):
    """
    Exchange a texted code for a session. A number we haven't seen before becomes a customer
    account there and then (201); a known one signs in (200).
    """

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "phone_verify"

    @extend_schema(
        request=PhoneCodeVerifySerializer,
        responses={
            200: AuthResponseSerializer,
            201: AuthResponseSerializer,
            400: OpenApiResponse(description="Wrong, expired or used code"),
            409: OpenApiResponse(description="password_required: link the number with a password"),
        },
        summary="Sign in with a texted code (creates the account if needed)",
    )
    def post(self, request, *args, **kwargs):
        body = PhoneCodeVerifySerializer(data=request.data)
        body.is_valid(raise_exception=True)
        user, created = verify_code(body.validated_data["phone"], body.validated_data["code"])
        refresh = LoginSerializer.get_token(user)
        update_last_login(None, user)
        log_event("auth.login", user_id=str(user.pk), role=user.role, method="phone")
        response = _auth_response(
            user,
            str(refresh),
            str(refresh.access_token),
            status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
        response.data["created"] = created
        return response


class RefreshView(_PublicAuthView):
    @extend_schema(
        request=None,
        responses={
            200: AuthResponseSerializer,
            401: OpenApiResponse(description="No valid session"),
        },
        summary="Exchange the refresh cookie for a new access token (rotates the refresh token)",
    )
    def post(self, request, *args, **kwargs):
        raw_refresh = get_refresh_token(request)
        if not raw_refresh:
            return self._reject("not_authenticated", "You are not signed in.")

        serializer = TokenRefreshSerializer(data={"refresh": raw_refresh})
        try:
            serializer.is_valid(raise_exception=True)
            access = serializer.validated_data["access"]
            # Re-validates the user: still exists, still active, password unchanged.
            user = JWTAuthentication().get_user(AccessToken(access))
        except (TokenError, AuthenticationFailed, ObjectDoesNotExist):
            log_event("auth.refresh_rejected", level=logging.WARNING, client_ip=client_ip(request))
            return self._reject(
                "token_not_valid", "Your session has expired. Please sign in again."
            )

        new_refresh = serializer.validated_data.get("refresh", raw_refresh)
        log_event("auth.refreshed", user_id=str(user.pk))
        return _auth_response(user, new_refresh, access, status.HTTP_200_OK)

    @staticmethod
    def _reject(code: str, message: str) -> Response:
        response = Response(error_payload(code, message), status=status.HTTP_401_UNAUTHORIZED)
        clear_refresh_cookie(response)
        return response


class LogoutView(_PublicAuthView):
    @extend_schema(
        request=LogoutRequestSerializer,
        responses={204: None},
        summary="End the session: blacklist the refresh token and clear the cookie",
    )
    def post(self, request, *args, **kwargs):
        raw_refresh = get_refresh_token(request)
        if raw_refresh:
            # An expired or already-blacklisted token means the session is over either way.
            with contextlib.suppress(TokenError):
                RefreshToken(raw_refresh).blacklist()
        user = request.user
        log_event("auth.logout", user_id=str(user.pk) if user.is_authenticated else None)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_refresh_cookie(response)
        return response


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=UserSerializer, summary="The signed-in user")
    def get(self, request, *args, **kwargs):
        return Response(UserSerializer(request.user).data)

    @extend_schema(
        request=ProfileUpdateSerializer,
        responses=UserSerializer,
        summary="Update your own name, phone or email",
    )
    def patch(self, request, *args, **kwargs):
        serializer = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        log_event(
            "auth.profile_updated", user_id=str(user.pk), fields=sorted(serializer.validated_data)
        )
        return Response(UserSerializer(user).data)


class ChangePasswordView(APIView):
    """
    Change your own password. Every token embeds a hash of the password, so the old ones stop
    working the moment it changes — this hands back a fresh session instead of signing you out.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(
        request=ChangePasswordSerializer,
        responses={200: AuthResponseSerializer},
        summary="Change your password",
    )
    def post(self, request, *args, **kwargs):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        refresh = LoginSerializer.get_token(user)
        log_event("auth.password_changed", user_id=str(user.pk))
        return _auth_response(user, str(refresh), str(refresh.access_token), status.HTTP_200_OK)
