from rest_framework.routers import SimpleRouter

from .views import RouteViewSet, StopViewSet

router = SimpleRouter()
router.register("stops", StopViewSet, basename="stop")
router.register("routes", RouteViewSet, basename="route")

urlpatterns = router.urls
