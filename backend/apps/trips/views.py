from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.bookings.services import hold_summary
from apps.core.admin_viewsets import UUID_LOOKUP_REGEX

from .public_serializers import (
    PublicTripSerializer,
    PublicTripStopSerializer,
    TripSearchQuerySerializer,
    TripSearchResultSerializer,
    boarding_point,
    dropoff_point,
)
from .search import search_trips
from .selectors import public_trips, seat_map

SEARCH_PARAMETERS = [
    OpenApiParameter("from", str, required=True, description="Stop id, or a city / stop name"),
    OpenApiParameter("to", str, required=True, description="Stop id, or a city / stop name"),
    OpenApiParameter("date", OpenApiTypes.DATE, required=True, description="Boarding date"),
    OpenApiParameter("passengers", int, description="1–10 (default 1)"),
    OpenApiParameter("sort", str, enum=["departure", "-departure", "price", "-price",
                                        "duration", "seats"]),
    OpenApiParameter("bus_type", str, description="Comma-separated: normal,ac,luxury,super_luxury"),
    OpenApiParameter("ac", bool),
    OpenApiParameter("min_price", OpenApiTypes.DECIMAL),
    OpenApiParameter("max_price", OpenApiTypes.DECIMAL),
    OpenApiParameter("departure", str,
                     description="Comma-separated: early_morning,morning,afternoon,evening"),
    OpenApiParameter("operator", str, description="Comma-separated operator ids"),
    OpenApiParameter("page", int),
    OpenApiParameter("page_size", int),
]  # fmt: skip


class TripViewSet(viewsets.GenericViewSet):
    """
    Public trip discovery. Only trips that are on sale and can still be boarded are visible;
    anything else answers 404.
    """

    permission_classes = [AllowAny]
    serializer_class = PublicTripSerializer
    lookup_value_regex = UUID_LOOKUP_REGEX
    filter_backends = []

    def get_queryset(self):
        return public_trips()

    @extend_schema(summary="Trip details: route, stops, bus and seats left")
    def retrieve(self, request, *args, **kwargs):
        return Response(self.get_serializer(self.get_object()).data)

    @extend_schema(
        summary="Search trips between two places on a date",
        parameters=SEARCH_PARAMETERS,
        responses=TripSearchResultSerializer(many=True),
    )
    @action(detail=False, methods=["get"])
    def search(self, request, *args, **kwargs):
        query = TripSearchQuerySerializer(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        params = query.validated_data
        outcome = search_trips(params)

        page = self.paginate_queryset(outcome.results)
        response = self.get_paginated_response(TripSearchResultSerializer(page, many=True).data)
        response.data.update(
            {
                "search": {
                    "from": params["from"].as_dict(),
                    "to": params["to"].as_dict(),
                    "date": params["date"].isoformat(),
                    "passengers": params["passengers"],
                    "sort": params["sort"],
                },
                "facets": outcome.facets,
                "route_exists": outcome.route_exists,
                "nearest_available_date": (
                    outcome.nearest_available_date.isoformat()
                    if outcome.nearest_available_date
                    else None
                ),
            }
        )
        return response

    @extend_schema(
        summary="All stops, with the valid boarding and drop-off points",
        parameters=[
            OpenApiParameter(
                "boarding", OpenApiTypes.UUID, description="Only drop-offs after this stop"
            )
        ],
        responses=OpenApiTypes.OBJECT,
    )
    @action(detail=True, methods=["get"])
    def stops(self, request, *args, **kwargs):
        trip = self.get_object()
        stops = list(trip.trip_stops.all())
        now = timezone.now()
        dropoffs = [stop for stop in stops if stop.is_dropoff_point and stop.stop.active]
        boardings = [
            stop
            for stop in stops
            if stop.is_boarding_point
            and stop.stop.active
            and stop.departure_datetime > now
            and any(dropoff.sequence > stop.sequence for dropoff in dropoffs)
        ]
        chosen = request.query_params.get("boarding")
        if chosen:
            boarding = next((stop for stop in boardings if str(stop.stop_id) == chosen), None)
            if boarding is None:
                raise ValidationError({"boarding": ["Choose one of this trip’s boarding points."]})
            dropoffs = [stop for stop in dropoffs if stop.sequence > boarding.sequence]
        elif boardings:
            first = boardings[0].sequence
            dropoffs = [stop for stop in dropoffs if stop.sequence > first]
        else:
            dropoffs = []
        return Response(
            {
                "trip": str(trip.pk),
                "stops": PublicTripStopSerializer(stops, many=True).data,
                "boarding_points": [boarding_point(stop) for stop in boardings],
                "dropoff_points": [dropoff_point(stop) for stop in dropoffs],
            }
        )

    @extend_schema(summary="Seat map with each seat's status", responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"])
    def seats(self, request, *args, **kwargs):
        trip = self.get_object()
        viewer = request.user if request.user.is_authenticated else None
        data = seat_map(trip, viewer=viewer)
        # Signed-in customers also get their own hold: locked seats, countdown and price.
        data["hold"] = hold_summary(trip, viewer) if viewer else None
        return Response(data)
