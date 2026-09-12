from rest_framework.routers import SimpleRouter

from .views import BookingViewSet, SeatLockViewSet

router = SimpleRouter()
router.register("bookings", BookingViewSet, basename="booking")
router.register("seat-locks", SeatLockViewSet, basename="seat-lock")

urlpatterns = router.urls
