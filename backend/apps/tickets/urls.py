from django.urls import path

from .views import TicketVerifyView

urlpatterns = [
    path("tickets/verify/", TicketVerifyView.as_view(), name="ticket-verify"),
]
