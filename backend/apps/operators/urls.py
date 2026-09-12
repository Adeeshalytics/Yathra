from django.urls import path

from .views import OperatorProfileView

urlpatterns = [
    path("operator/profile/", OperatorProfileView.as_view(), name="operator-profile"),
]
