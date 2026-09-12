"use client";

import {
  BanIcon,
  BusFrontIcon,
  CircleCheckIcon,
  DoorOpenIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  PencilIcon,
  StoreIcon,
  TicketIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useRecordControls, type RowAction } from "@/components/admin/shared/record-controls";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAdminMutation, type RecordRef } from "@/hooks/use-admin-mutation";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { adminApi } from "@/lib/api/admin";
import type { AdminTrip, TripStatus } from "@/lib/api/admin-types";
import { pluralize } from "@/lib/format";
import { STATUS_TRANSITIONS } from "@/lib/validations/trips";

import { STATUS_ACTION_LABEL, STATUS_HELP, TRIP_STATUS_LABEL, isOpenTrip } from "./trip-status";

export interface TripRef extends RecordRef {
  bookingCount: number;
}

export function tripRef(trip: AdminTrip): TripRef {
  return { id: trip.id, label: trip.code, bookingCount: trip.booking_count };
}

const STATUS_ICONS: Record<TripStatus, ReactNode> = {
  scheduled: <Undo2Icon />,
  boarding: <DoorOpenIcon />,
  departed: <BusFrontIcon />,
  completed: <CircleCheckIcon />,
  cancelled: <BanIcon />,
};

function CancelTripDialog({ trip, onClose }: { trip: TripRef | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const cancel = useAdminMutation({
    mutationFn: (target: TripRef) => adminApi.trips.cancel(target.id, reason.trim()),
    successMessage: (_, target) => `${target.label} was cancelled.`,
  });

  async function confirmCancel() {
    if (!trip) return;
    try {
      await cancel.mutateAsync(trip);
      onClose();
    } catch {
      // The mutation already showed the API's message as a toast.
    }
  }

  return (
    <Dialog
      open={trip !== null}
      onOpenChange={(open) => {
        if (!open && !cancel.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!cancel.isPending} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel {trip?.label}?</DialogTitle>
          <DialogDescription>
            The trip comes off sale straight away and the bus is free for other journeys at this
            time. A cancelled trip can’t be reinstated.
          </DialogDescription>
        </DialogHeader>
        {trip && trip.bookingCount > 0 && (
          <Alert>
            <TicketIcon />
            <AlertDescription>
              {pluralize(trip.bookingCount, "booking")} {trip.bookingCount === 1 ? "is" : "are"} on
              this trip. Let those passengers know about the cancellation.
            </AlertDescription>
          </Alert>
        )}
        <div className="grid gap-2">
          <Label htmlFor="cancel-reason">
            Reason <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            maxLength={500}
            rows={3}
            placeholder="e.g. Road closure near Habarana"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>
            Keep trip
          </Button>
          <Button variant="destructive" onClick={() => void confirmCancel()} disabled={cancel.isPending}>
            {cancel.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            Cancel trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Status changes, cancellation, sale on/off and deletion for trips, with confirmations and
 * toasts. Render `dialogs` once in the component.
 */
export function useTripControls() {
  const controls = useRecordControls("trips", adminApi.trips, "trip");
  const { confirm, dialog: statusDialog } = useConfirmDialog();
  const [cancelTarget, setCancelTarget] = useState<TripRef | null>(null);
  const status = useAdminMutation({
    mutationFn: ({ trip, status }: { trip: TripRef; status: TripStatus }) =>
      adminApi.trips.setStatus(trip.id, status),
    successMessage: (_, { trip, status }) =>
      `${trip.label} is now ${TRIP_STATUS_LABEL[status].toLowerCase()}.`,
  });

  return {
    isBusy: controls.isBusy || status.isPending,
    changeStatus: (trip: TripRef, next: TripStatus) =>
      confirm({
        title: `${STATUS_ACTION_LABEL[next]} for ${trip.label}?`,
        description: STATUS_HELP[next],
        confirmLabel: STATUS_ACTION_LABEL[next],
        onConfirm: () => status.mutateAsync({ trip, status: next }),
      }),
    requestCancel: (trip: TripRef) => setCancelTarget(trip),
    putOnSale: (trip: TripRef) => controls.activate(trip),
    takeOffSale: (trip: TripRef) =>
      controls.requestDeactivate(
        trip,
        "Passengers can’t find or book this trip until you put it back on sale. It stays on the timetable.",
      ),
    requestDelete: (trip: TripRef, onDeleted?: () => void) =>
      controls.requestDelete(trip, {
        description:
          "This permanently removes the trip and its stop timings. Trips with bookings can’t be deleted — cancel them instead.",
        onDeleted,
      }),
    dialogs: (
      <>
        {controls.dialog}
        {statusDialog}
        <CancelTripDialog
          key={cancelTarget?.id ?? "closed"}
          trip={cancelTarget}
          onClose={() => setCancelTarget(null)}
        />
      </>
    ),
  };
}

export type TripControls = ReturnType<typeof useTripControls>;

/** Every action that applies to a trip in its current state, for "…" menus. */
export function tripMenuActions(
  trip: AdminTrip,
  controls: TripControls,
  { onDetailPage = false, onDeleted }: { onDetailPage?: boolean; onDeleted?: () => void } = {},
): RowAction[] {
  const ref = tripRef(trip);
  const actions: RowAction[] = [];
  if (!onDetailPage) {
    actions.push({ label: "View", icon: <EyeIcon />, href: `/admin/trips/${trip.id}` });
    if (trip.status === "scheduled") {
      actions.push({ label: "Edit", icon: <PencilIcon />, href: `/admin/trips/${trip.id}/edit` });
    }
  }
  STATUS_TRANSITIONS[trip.status].forEach((next, index) => {
    actions.push({
      label: STATUS_ACTION_LABEL[next],
      icon: STATUS_ICONS[next],
      separatorBefore: index === 0 && actions.length > 0,
      onSelect: () => controls.changeStatus(ref, next),
    });
  });
  if (isOpenTrip(trip)) {
    actions.push(
      trip.active
        ? { label: "Take off sale", icon: <EyeOffIcon />, onSelect: () => controls.takeOffSale(ref) }
        : { label: "Put on sale", icon: <StoreIcon />, onSelect: () => controls.putOnSale(ref) },
    );
  }
  const cancellable = trip.status !== "completed" && trip.status !== "cancelled";
  if (cancellable) {
    actions.push({
      label: "Cancel trip",
      icon: <BanIcon />,
      destructive: true,
      separatorBefore: true,
      onSelect: () => controls.requestCancel(ref),
    });
  }
  if (trip.booking_count === 0) {
    actions.push({
      label: "Delete",
      icon: <Trash2Icon />,
      destructive: true,
      separatorBefore: !cancellable,
      onSelect: () => controls.requestDelete(ref, onDeleted),
    });
  }
  return actions;
}
