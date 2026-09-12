from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import PaymentViewSet, RefundViewSet, mock_checkout, payment_webhook

router = SimpleRouter()
router.register("payments", PaymentViewSet, basename="payment")
router.register("refunds", RefundViewSet, basename="refund")

urlpatterns = [
    path("payments/webhooks/<slug:provider>/", payment_webhook, name="payment-webhook"),
    path("payments/mock/checkout/", mock_checkout, name="payment-mock-checkout"),
    *router.urls,
]
