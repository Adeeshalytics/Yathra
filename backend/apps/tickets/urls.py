from django.urls import path

from .views import FindTicketView, SharedTicketPdfView, SharedTicketView, TicketVerifyView

urlpatterns = [
    path("tickets/verify/", TicketVerifyView.as_view(), name="ticket-verify"),
    path("tickets/find/", FindTicketView.as_view(), name="ticket-find"),
    path("tickets/shared/<str:code>/", SharedTicketView.as_view(), name="ticket-shared"),
    path("tickets/shared/<str:code>/pdf/", SharedTicketPdfView.as_view(), name="ticket-shared-pdf"),
]
