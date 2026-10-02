from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.metrics import metrics

admin.site.site_header = f"{settings.APP_NAME} administration"
admin.site.site_title = f"{settings.APP_NAME} admin"

urlpatterns = [
    path(settings.DJANGO_ADMIN_URL, admin.site.urls),
    # Every API route is versioned: /api/v1/...
    re_path(r"^api/(?P<version>v1)/", include("config.api_urls")),
    # Prometheus scrape endpoint: internal only (see apps.core.metrics.metrics).
    path("metrics", metrics, name="metrics"),
]

if settings.API_DOCS_ENABLED:
    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(api_version="v1"), name="api-schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="api-schema"), name="api-docs"),
    ]

handler404 = "apps.core.views.not_found"
handler500 = "apps.core.views.server_error"
