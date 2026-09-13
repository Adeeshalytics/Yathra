"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BusFrontIcon,
  CheckIcon,
  InfoIcon,
  LogInIcon,
  RefreshCwIcon,
  SnowflakeIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { FacilityList } from "@/components/admin/buses/facilities";
import { DetailList } from "@/components/admin/shared/detail-list";
import { BackLink } from "@/components/admin/shared/page-parts";
import { HoldTimer, useCountdown } from "@/components/booking/hold-countdown";
import { PhoneSignIn } from "@/components/auth/phone-sign-in";
import { PassengerDetailsForm } from "@/components/booking/passenger-details-form";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { RouteMapPanel } from "@/components/map/route-map-panel";
import { BusSeatPicker, SeatPickerLegend } from "@/components/seats/bus-seat-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import type { PassengerInput } from "@/lib/api/booking-types";
import { bookingsApi, seatLocksApi, tripsApi } from "@/lib/api/endpoints";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { PriceQuote, PublicTrip, StopTime, TripSeat } from "@/lib/api/trip-types";
import { seatAction } from "@/lib/booking";
import { geometryForTrip, selectableIds } from "@/lib/map";
import { formatClock, formatJourney, formatTripDate, minutesBetween } from "@/lib/datetime";
import { formatCurrency, pluralize } from "@/lib/format";
import { resolveSegment, usableBoardings } from "@/lib/trip-selection";
import { cn } from "@/lib/utils";
import { passengerDefaults } from "@/lib/validations/booking";
import { MAX_PASSENGERS } from "@/lib/validations/search";

import { StopPointPicker } from "./stop-point-picker";
import { TripStopTimeline } from "./trip-stop-timeline";

type Step = "journey" | "seats" | "passengers";

const STEPS: { key: Step; label: string }[] = [
  { key: "journey", label: "Boarding & drop-off" },
  { key: "seats", label: "Seats" },
  { key: "passengers", label: "Passengers" },
];

const PASSENGER_FORM_ID = "passenger-details";

function passengersFrom(value: string | null): number {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= MAX_PASSENGERS ? count : 1;
}

function Stepper({
  current,
  reachable,
  onSelect,
}: {
  current: Step;
  reachable: Record<Step, boolean>;
  onSelect: (step: Step) => void;
}) {
  const position = STEPS.findIndex((item) => item.key === current);
  return (
    <ol aria-label="Booking steps" className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
      {STEPS.map((item, index) => {
        const active = index === position;
        const done = index < position;
        return (
          <li key={item.key} className="flex items-center gap-2">
            <button
              type="button"
              disabled={active || !reachable[item.key]}
              aria-current={active ? "step" : undefined}
              onClick={() => onSelect(item.key)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 font-medium transition-colors disabled:cursor-default",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10",
                !active && !done && "text-muted-foreground",
              )}
            >
              <span className="grid size-5 place-items-center rounded-full bg-black/5 text-xs">
                {done ? <CheckIcon className="size-3.5" aria-hidden /> : index + 1}
              </span>
              {item.label}
            </button>
            <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
          </li>
        );
      })}
      <li className="flex items-center gap-2 rounded-full border border-dashed px-3 py-1.5 text-muted-foreground">
        <span className="grid size-5 place-items-center text-xs">4</span>
        Review
      </li>
    </ol>
  );
}

function Summary({
  trip,
  boarding,
  dropoff,
  seats,
  quote,
  remaining,
  action,
  note,
}: {
  trip: PublicTrip;
  boarding: StopTime | null;
  dropoff: StopTime | null;
  seats: string[];
  quote: PriceQuote | null;
  remaining: number | null;
  action: ReactNode;
  note?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your trip</CardTitle>
        <CardDescription>
          {trip.route.origin.city} → {trip.route.destination.city} · {trip.operator.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {boarding && dropoff ? (
          <div className="rounded-xl bg-muted/60 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Board</p>
                <p className="truncate font-medium">{boarding.stop.name}</p>
                <p className="tabular-nums">{formatClock(boarding.time)}</p>
              </div>
              <ArrowRightIcon className="mt-5 size-4 shrink-0 text-muted-foreground" aria-label="to" />
              <div className="min-w-0 text-right">
                <p className="text-xs text-muted-foreground">Get off</p>
                <p className="truncate font-medium">{dropoff.stop.name}</p>
                <p className="tabular-nums">{formatClock(dropoff.time)}</p>
              </div>
            </div>
            <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
              {formatTripDate(boarding.time)} · {formatJourney(minutesBetween(boarding.time, dropoff.time))} journey
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">Choose where you board and get off.</p>
        )}

        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Seats held for you</p>
            {remaining !== null && seats.length > 0 && <HoldTimer remainingMs={remaining} />}
          </div>
          {seats.length ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Your seats">
              {seats.map((seat) => (
                <li key={seat}>
                  <Badge className="tabular-nums">Seat {seat}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-medium">None yet</p>
          )}
        </div>

        <div className="border-t pt-3">
          {quote ? (
            <PriceBreakdown quote={quote} />
          ) : (
            <p className="flex justify-between">
              <span className="text-muted-foreground">Ticket price</span>
              <span className="font-medium tabular-nums">{formatCurrency(trip.price)} per seat</span>
            </p>
          )}
        </div>

        {action}
        {note && <p className="text-xs text-muted-foreground" aria-live="polite">{note}</p>}
      </CardContent>
    </Card>
  );
}

export function TripViewSkeleton() {
  return (
    <div className="container-page space-y-6 py-6 sm:py-10" aria-busy>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-9 w-80" />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="h-[32rem] rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}

/**
 * A trip page and the first part of booking it: boarding & drop-off → seats → passengers.
 * Seats are locked on the server as they are tapped; this page only shows what the server
 * says (your seats, other customers' holds, the countdown and the price).
 */
export function TripView({ id }: { id: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, status: authStatus } = useAuth();
  const back = params.get("back");
  const backHref = back ? `/search?${back}` : "/search";
  const here = params.toString() ? `${pathname}?${params.toString()}` : pathname;

  const [step, setStep] = useState<Step>("journey");
  const [passengers, setPassengers] = useState(() => passengersFrom(params.get("passengers")));
  const [boardingId, setBoardingId] = useState<string | null>(params.get("boarding"));
  const [dropoffId, setDropoffId] = useState<string | null>(params.get("dropoff"));
  const [notice, setNotice] = useState<string | null>(null);
  const [signInNeeded, setSignInNeeded] = useState(false);
  // The seat tapped before signing in: it is held for them the moment they are in.
  const [seatAfterSignIn, setSeatAfterSignIn] = useState<string | null>(null);
  const [pendingSeat, setPendingSeat] = useState<string | null>(null);

  const trip = useQuery({ queryKey: queryKeys.trip(id), queryFn: ({ signal }) => tripsApi.get(id, signal) });
  const stops = useQuery({
    queryKey: queryKeys.tripStops(id),
    queryFn: ({ signal }) => tripsApi.stops(id, signal),
    enabled: trip.isSuccess,
  });
  const seats = useQuery({
    queryKey: queryKeys.tripSeats(id, user?.id ?? "guest"),
    queryFn: ({ signal }) => tripsApi.seats(id, signal),
    enabled: trip.isSuccess && authStatus !== "loading",
    // Other customers' holds and bookings show up within seconds while choosing seats.
    refetchInterval: step === "journey" ? 15_000 : 4_000,
  });

  const hold = seats.data?.hold ?? null;
  const heldSeats = hold?.seats.map((seat) => seat.seat_number) ?? [];
  const remaining = useCountdown(heldSeats.length ? hold?.seconds_remaining : null, seats.dataUpdatedAt);
  const holdRanOut = remaining === 0;

  useEffect(() => {
    // When the hold runs out the server has already released the seats; fetch the new state.
    if (holdRanOut) void queryClient.invalidateQueries({ queryKey: queryKeys.tripSeatsAll(id) });
  }, [holdRanOut, id, queryClient]);

  if (trip.isPending) return <TripViewSkeleton />;
  if (trip.isError) {
    return (
      <div className="container-page py-10">
        {trip.error instanceof ApiError && trip.error.status === 404 ? (
          <EmptyState
            icon={BusFrontIcon}
            title="This trip isn’t available"
            description="It may have left, sold out or been cancelled. Pick another departure."
            action={
              <Button asChild>
                <Link href={backHref}>Back to results</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState title="This trip couldn’t be loaded" error={trip.error} onRetry={() => void trip.refetch()} />
        )}
      </div>
    );
  }

  const data = trip.data;
  const segment = resolveSegment({
    boardings: stops.data?.boarding_points ?? [],
    dropoffs: stops.data?.dropoff_points ?? [],
    boardingId,
    dropoffId,
  });
  // The map is drawn from the stops the trip already carries, so it costs no extra request.
  const geometry = geometryForTrip(data.stops);
  const boardable = selectableIds(usableBoardings(stops.data?.boarding_points ?? [], stops.data?.dropoff_points ?? []));
  const alightable = selectableIds(segment.dropoffOptions);
  const journeyReady = Boolean(segment.boarding && segment.dropoff);
  const seatsReady = heldSeats.length > 0 && heldSeats.length === passengers && !holdRanOut;
  const lostHold = step === "passengers" && !seatsReady;
  const current: Step = lostHold ? "seats" : step === "seats" && !journeyReady ? "journey" : step;
  const extra = heldSeats.length - passengers;
  const available = seats.data?.available_seats ?? data.available_seats;
  const maxPassengers = Math.max(1, Math.min(MAX_PASSENGERS, available + heldSeats.length));

  const refreshSeats = () => queryClient.invalidateQueries({ queryKey: queryKeys.tripSeatsAll(id) });

  async function onSeat(seat: TripSeat) {
    const action = seatAction(seat, hold, passengers, Boolean(user));
    setNotice(null);
    if (action.kind === "unavailable") return;
    if (action.kind === "sign-in") {
      setSignInNeeded(true);
      setSeatAfterSignIn(seat.seat_number);
      return;
    }
    if (action.kind === "limit") {
      setNotice(`You’ve chosen ${pluralize(passengers, "seat")}. Tap one of your seats to release it first, or add a passenger.`);
      return;
    }
    setPendingSeat(seat.seat_number);
    try {
      if (action.kind === "release") {
        await seatLocksApi.release(action.lockId);
      } else {
        await seatLocksApi.lock(id, [seat.seat_number]);
        if (action.kind === "swap") await seatLocksApi.release(action.releaseLockId);
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      await refreshSeats();
      setPendingSeat(null);
    }
  }

  async function holdSeatAfterSignIn() {
    const seat = seatAfterSignIn;
    setSignInNeeded(false);
    setSeatAfterSignIn(null);
    if (!seat) return;
    setPendingSeat(seat);
    try {
      await seatLocksApi.lock(id, [seat]);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      await refreshSeats();
      setPendingSeat(null);
    }
  }

  async function createBooking(details: PassengerInput[]) {
    if (!segment.boarding || !segment.dropoff) return;
    try {
      const booking = await bookingsApi.create({
        trip: id,
        boarding_stop: segment.boarding.stop.id,
        dropoff_stop: segment.dropoff.stop.id,
        passengers: details,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allMyBookings });
      router.push(`/bookings/${booking.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast.error(error.message);
        await refreshSeats();
        setStep("seats");
        return;
      }
      throw error; // field problems are shown by the form
    }
  }

  const action =
    current === "journey" ? (
      <Button variant="cta" size="xl" className="w-full" disabled={!journeyReady} onClick={() => setStep("seats")}>
        Choose seats
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    ) : current === "seats" ? (
      <Button variant="cta" size="xl" className="w-full" disabled={!seatsReady} onClick={() => setStep("passengers")}>
        Passenger details
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    ) : (
      <Button variant="cta" size="xl" className="w-full" type="submit" form={PASSENGER_FORM_ID}>
        Review booking
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    );
  const note =
    current === "seats" && !seatsReady
      ? heldSeats.length < passengers
        ? `Select ${pluralize(passengers - heldSeats.length, "more seat")}.`
        : extra > 0
          ? `Release ${pluralize(extra, "seat")} or add a passenger.`
          : undefined
      : current === "passengers"
        ? "Nothing is charged yet. You’ll review everything next."
        : undefined;

  return (
    <div className="container-page space-y-6 pt-6 pb-32 sm:pt-10 lg:pb-12">
      <BackLink href={backHref}>Back to results</BackLink>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{data.bus.bus_type_label}</Badge>
          {data.bus.is_ac && data.bus.bus_type !== "ac" && (
            <Badge variant="outline" className="gap-1">
              <SnowflakeIcon aria-hidden />
              AC
            </Badge>
          )}
          <span className="font-mono text-xs text-muted-foreground">Trip {data.code}</span>
        </div>
        <h1 className="flex flex-wrap items-center gap-x-3 text-2xl font-bold sm:text-3xl">
          {data.route.origin.city}
          <ArrowRightIcon className="size-6 text-primary" aria-label="to" />
          {data.route.destination.city}
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatTripDate(data.departure_datetime)} · {formatClock(data.departure_datetime)} →{" "}
          {formatClock(data.arrival_datetime)} ({formatJourney(data.duration_minutes)}) · {data.operator.name} ·{" "}
          {data.bus.name}
        </p>
      </header>

      <Stepper
        current={current}
        reachable={{ journey: true, seats: journeyReady, passengers: journeyReady && seatsReady }}
        onSelect={setStep}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {current === "journey" && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Where do you get on and off?</CardTitle>
                  <CardDescription>Only stops you can travel between on this bus are shown.</CardDescription>
                </CardHeader>
                <CardContent>
                  {stops.isError ? (
                    <ErrorState title="Stops couldn’t be loaded" error={stops.error} onRetry={() => void stops.refetch()} />
                  ) : !stops.data ? (
                    <Skeleton className="h-48 w-full rounded-xl" />
                  ) : (
                    <div className="grid gap-6 md:grid-cols-2">
                      <StopPointPicker
                        name="boarding"
                        legend="Boarding point"
                        points={usableBoardings(stops.data.boarding_points, stops.data.dropoff_points)}
                        value={segment.boarding?.stop.id ?? null}
                        onChange={setBoardingId}
                        timeLabel="Departs"
                        emptyText="This bus can’t be boarded any more."
                      />
                      <StopPointPicker
                        name="dropoff"
                        legend="Drop-off point"
                        points={segment.dropoffOptions}
                        value={segment.dropoff?.stop.id ?? null}
                        onChange={setDropoffId}
                        timeLabel="Arrives"
                        emptyText="Choose a boarding point first."
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Route & stops</CardTitle>
                  <CardDescription>{data.route.name} · estimated times, Sri Lanka time</CardDescription>
                </CardHeader>
                <CardContent>
                  <TripStopTimeline
                    stops={data.stops}
                    boardingSequence={segment.boarding?.sequence}
                    dropoffSequence={segment.dropoff?.sequence}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Route map</CardTitle>
                  <CardDescription>
                    {data.route.origin.name} → {data.route.destination.name} · tap a stop to see
                    its times, or to get on or off there
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RouteMapPanel
                    geometry={geometry}
                    roadPath={data.route.road_path}
                    boardingStopId={segment.boarding?.stop.id ?? null}
                    dropoffStopId={segment.dropoff?.stop.id ?? null}
                    selectableBoardingIds={boardable}
                    selectableDropoffIds={alightable}
                    onSelectBoarding={setBoardingId}
                    onSelectDropoff={setDropoffId}
                    emptyDescription="These stops haven’t been placed on the map yet. The list above has every stop and its times."
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>About this bus</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <DetailList
                    items={[
                      { label: "Operator", value: data.operator.name },
                      { label: "Bus", value: data.bus.name },
                      { label: "Registration", value: <span className="font-mono">{data.bus.registration_number}</span> },
                      { label: "Type", value: data.bus.bus_type_label },
                      { label: "Air conditioning", value: data.bus.is_ac ? "Yes" : "No" },
                      {
                        label: "Seats",
                        value: `${data.bus.seat_capacity}${data.bus.seat_layout_name ? ` · ${data.bus.seat_layout_name}` : ""}`,
                      },
                    ]}
                  />
                  <div>
                    <p className="mb-2 text-sm text-muted-foreground">Facilities</p>
                    {data.bus.facilities.length ? (
                      <FacilityList facilities={data.bus.facilities} />
                    ) : (
                      <p className="text-sm">Standard seating, no extra facilities.</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {current === "seats" && (
            <Card>
              <CardHeader className="gap-3 sm:flex sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <CardTitle>Choose your seats</CardTitle>
                  <CardDescription>
                    {seats.data
                      ? `${pluralize(available, "seat")} free · select ${pluralize(passengers, "seat")}`
                      : "Loading the seat map…"}
                  </CardDescription>
                </div>
                <Select value={String(passengers)} onValueChange={(value) => setPassengers(Number(value))}>
                  <SelectTrigger aria-label="Passengers" className="h-10 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {Array.from({ length: maxPassengers }, (_, index) => index + 1).map((count) => (
                      <SelectItem key={count} value={String(count)}>
                        {pluralize(count, "passenger")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent className="space-y-4">
                {lostHold && (
                  <Alert variant="destructive" className="bg-destructive/5">
                    <TriangleAlertIcon />
                    <AlertDescription>
                      Your seat hold ran out or changed, so please choose your seats again.
                    </AlertDescription>
                  </Alert>
                )}
                {signInNeeded && !user && (
                  <section aria-labelledby="hold-sign-in" className="space-y-3 rounded-xl border bg-muted/40 p-4">
                    <div className="flex items-start gap-3">
                      <LogInIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                      <div className="space-y-1">
                        <h3 id="hold-sign-in" className="font-semibold">
                          Enter your mobile number to hold {seatAfterSignIn ? `seat ${seatAfterSignIn}` : "your seats"}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          We’ll text you a code: no password, no forms. Your ticket is sent to this number too.
                        </p>
                      </div>
                    </div>
                    <PhoneSignIn
                      emailSignInHref={`/login?next=${encodeURIComponent(here)}`}
                      onSignedIn={() => void holdSeatAfterSignIn()}
                    />
                    <p className="text-xs text-muted-foreground">
                      Prefer email?{" "}
                      <Link href={`/login?next=${encodeURIComponent(here)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                        Sign in
                      </Link>{" "}
                      or{" "}
                      <Link href={`/register?next=${encodeURIComponent(here)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                        create an account
                      </Link>
                      . You’ll come straight back here.
                    </p>
                  </section>
                )}
                {notice && (
                  <Alert>
                    <InfoIcon />
                    <AlertDescription>{notice}</AlertDescription>
                  </Alert>
                )}
                {heldSeats.length > 0 && remaining !== null && (
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    Your seats are held for <HoldTimer remainingMs={remaining} /> — finish booking before the timer
                    runs out.
                  </p>
                )}
                {seats.isError ? (
                  <ErrorState title="Seats couldn’t be loaded" error={seats.error} onRetry={() => void seats.refetch()} />
                ) : !seats.data ? (
                  <Skeleton className="mx-auto h-[28rem] w-64 rounded-[2.5rem]" />
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="max-w-full overflow-x-auto p-2">
                      <BusSeatPicker map={seats.data} onToggle={(seat) => void onSeat(seat)} pendingSeat={pendingSeat} />
                    </div>
                    <SeatPickerLegend className="justify-center" />
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <RefreshCwIcon className={seats.isFetching ? "size-3 animate-spin" : "size-3"} aria-hidden />
                      Seats update live. A seat you tap is held for you for {hold?.lock_minutes ?? 5} minutes.
                    </p>
                  </div>
                )}
                <Button variant="outline" size="lg" onClick={() => setStep("journey")}>
                  <ArrowLeftIcon data-icon="inline-start" />
                  Boarding & drop-off
                </Button>
              </CardContent>
            </Card>
          )}

          {current === "passengers" && (
            <Card>
              <CardHeader>
                <CardTitle>Passenger details</CardTitle>
                <CardDescription>A name and mobile number for each seat. Tickets are texted to these numbers; add an email for an email copy too.</CardDescription>
              </CardHeader>
              <CardContent>
                <PassengerDetailsForm
                  key={heldSeats.join(",")}
                  id={PASSENGER_FORM_ID}
                  defaultValues={passengerDefaults(heldSeats, user)}
                  submitLabel="Review booking"
                  onSubmit={createBooking}
                  onBack={() => setStep("seats")}
                  backLabel="Seats"
                />
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="hidden lg:sticky lg:top-24 lg:block">
          <Summary
            trip={data}
            boarding={segment.boarding}
            dropoff={segment.dropoff}
            seats={heldSeats}
            quote={hold?.quote ?? null}
            remaining={remaining}
            action={action}
            note={note}
          />
        </aside>
      </div>

      {/* Mobile: the countdown, total and next step pinned to the bottom of the screen. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur lg:hidden">
        <div className="container-page space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="min-w-0 truncate">
              <span className="font-medium">
                {heldSeats.length
                  ? `${heldSeats.length === 1 ? "Seat" : "Seats"} ${heldSeats.join(", ")}`
                  : `Select ${pluralize(passengers, "seat")}`}
              </span>
              <span className="text-muted-foreground"> · </span>
              <span className="font-heading font-bold tabular-nums">
                {hold?.quote
                  ? formatCurrency(hold.quote.total, hold.quote.currency)
                  : `${formatCurrency(data.price)} / seat`}
              </span>
            </p>
            {remaining !== null && heldSeats.length > 0 && (
              <HoldTimer remainingMs={remaining} className="shrink-0" />
            )}
          </div>
          {action}
        </div>
      </div>
    </div>
  );
}
