"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BanIcon,
  EraserIcon,
  ListOrderedIcon,
  Loader2Icon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WandSparklesIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { FormActions, FormErrorAlert } from "@/components/admin/shared/page-parts";
import { SelectField } from "@/components/forms/select-field";
import { SwitchField } from "@/components/forms/switch-field";
import { TextField } from "@/components/forms/text-field";
import { TextareaField } from "@/components/forms/textarea-field";
import { SeatLegend, SeatMap, seatKey } from "@/components/seats/seat-map";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { adminApi } from "@/lib/api/admin";
import type {
  GenerateLayoutPayload,
  Seat,
  SeatLayoutDetail,
  SeatLayoutPayload,
  SeatType,
} from "@/lib/api/admin-types";
import { getErrorMessage } from "@/lib/api/errors";
import { applyApiErrors, fieldErrorList } from "@/lib/forms";
import {
  MAX_LAYOUT_COLUMNS,
  MAX_LAYOUT_ROWS,
  MIN_LAYOUT_COLUMNS,
  SEAT_NUMBER_PATTERN,
  SEAT_TYPE_OPTIONS,
  applyTool,
  countSeats,
  findSeat,
  isCrew,
  renumberSeats,
  seatsOutside,
  validateSeats,
  type SeatTool,
} from "@/lib/seat-layout";
import { cn } from "@/lib/utils";
import {
  SEAT_LAYOUT_TYPES,
  seatLayoutSchema,
  type SeatLayoutFormValues,
} from "@/lib/validations/admin";

interface Grid {
  rows: number;
  columns: number;
  seats: Seat[];
}

type Tool = SeatTool | "select";

const DEFAULT_TEMPLATE: GenerateLayoutPayload = {
  layout_type: "2x2",
  passenger_rows: 11,
  back_row_full: true,
  conductor_seat: true,
};

const TOOLS: { value: Tool; label: string; icon?: ReactNode; swatch?: string }[] = [
  { value: "select", label: "Select", icon: <MousePointer2Icon /> },
  { value: "window", label: "Window", swatch: "bg-primary/15 border-primary/60" },
  { value: "aisle", label: "Aisle", swatch: "bg-primary/5 border-primary/40" },
  { value: "normal", label: "Standard", swatch: "bg-card border-primary/30" },
  { value: "reserved", label: "Reserved", swatch: "bg-amber-100 border-amber-400" },
  { value: "driver", label: "Driver", swatch: "bg-foreground border-foreground" },
  { value: "conductor", label: "Conductor", swatch: "bg-slate-200 border-slate-400" },
  { value: "toggle-availability", label: "Block / unblock", icon: <BanIcon /> },
  { value: "erase", label: "Erase", icon: <EraserIcon /> },
];

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`Fewer ${label.toLowerCase()}`}
      >
        <MinusIcon />
      </Button>
      <span className="w-6 text-center font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`More ${label.toLowerCase()}`}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}

export function SeatLayoutEditor({
  layout,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  layout?: SeatLayoutDetail;
  submitLabel: string;
  onSubmit: (payload: SeatLayoutPayload) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [edited, setEdited] = useState<Grid | null>(
    layout ? { rows: layout.rows, columns: layout.columns, seats: layout.seats } : null,
  );
  const [template, setTemplate] = useState<GenerateLayoutPayload>(DEFAULT_TEMPLATE);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const { confirm, dialog } = useConfirmDialog();

  // New layouts start from the default 2 + 2 template.
  const starter = useQuery({
    queryKey: ["admin", "seat-layouts", "template", DEFAULT_TEMPLATE],
    queryFn: () => adminApi.seatLayouts.generate(DEFAULT_TEMPLATE),
    enabled: !layout,
    staleTime: Infinity,
  });
  const grid: Grid = edited ??
    (starter.data
      ? { rows: starter.data.rows, columns: starter.data.columns, seats: starter.data.seats }
      : { rows: 12, columns: 5, seats: [] });

  const form = useForm<SeatLayoutFormValues>({
    resolver: zodResolver(seatLayoutSchema),
    defaultValues: {
      name: layout?.name ?? "",
      layout_type: layout?.layout_type ?? "2x2",
      description: layout?.description ?? "",
      active: layout?.active ?? true,
    },
  });

  const generate = useMutation({
    mutationFn: (payload: GenerateLayoutPayload) => adminApi.seatLayouts.generate(payload),
    onSuccess: (result) => {
      setEdited({ rows: result.rows, columns: result.columns, seats: result.seats });
      form.setValue("layout_type", result.layout_type);
      setSelectedKey(null);
      toast.success(`Generated ${result.seat_count} passenger seats.`);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const problems = validateSeats(grid.rows, grid.columns, grid.seats);
  const stats = countSeats(grid.seats);
  const selectedSeat = selectedKey
    ? grid.seats.find((seat) => seatKey(seat.row, seat.column) === selectedKey)
    : undefined;

  const updateSeats = (seats: Seat[]) => setEdited({ ...grid, seats });

  const handleCellClick = (row: number, column: number, seat: Seat | undefined) => {
    if (tool === "select") {
      setSelectedKey(seat ? seatKey(row, column) : null);
      return;
    }
    let seats = grid.seats;
    if (tool === "driver") {
      // One driver per bus: painting a new one moves it.
      seats = seats.filter((s) => s.seat_type !== "driver" || (s.row === row && s.column === column));
    }
    updateSeats(applyTool(seats, row, column, tool));
    if (tool === "erase" && selectedKey === seatKey(row, column)) setSelectedKey(null);
  };

  const resize = (rows: number, columns: number) => {
    const outside = seatsOutside(grid.seats, rows, columns);
    const apply = () => {
      setEdited({ rows, columns, seats: grid.seats.filter((seat) => !outside.includes(seat)) });
      setSelectedKey(null);
    };
    if (outside.length === 0) {
      apply();
      return;
    }
    confirm({
      title: `Remove ${outside.length} seat${outside.length === 1 ? "" : "s"}?`,
      description: "Shrinking the grid removes the seats that no longer fit.",
      confirmLabel: "Remove seats",
      destructive: true,
      onConfirm: apply,
    });
  };

  const runTemplate = () => {
    if (grid.seats.length > 0 && edited !== null) {
      confirm({
        title: "Replace the current seats?",
        description: "Generating a template discards the seats in the editor.",
        confirmLabel: "Replace",
        destructive: true,
        onConfirm: () => generate.mutateAsync(template),
      });
    } else {
      generate.mutate(template);
    }
  };

  const updateSelected = (changes: Partial<Seat>) => {
    if (!selectedSeat) return;
    updateSeats(grid.seats.map((seat) => (seat === selectedSeat ? { ...seat, ...changes } : seat)));
  };

  const submit = form.handleSubmit(async (values) => {
    setServerErrors([]);
    if (problems.length > 0) return;
    try {
      await onSubmit({ ...values, rows: grid.rows, columns: grid.columns, seats: grid.seats });
    } catch (error) {
      const banner = applyApiErrors(error, form.setError, ["name", "layout_type", "description"]);
      const seatErrors = [...fieldErrorList(error, "seats"), ...fieldErrorList(error, "rows"), ...fieldErrorList(error, "columns")];
      setServerErrors(seatErrors.length > 0 ? seatErrors : banner ? [banner] : []);
    }
  });

  const selectedNumberError =
    selectedSeat &&
    (!SEAT_NUMBER_PATTERN.test(selectedSeat.seat_number)
      ? "Use 1–8 letters, digits or dashes."
      : grid.seats.some(
            (seat) => seat !== selectedSeat && seat.seat_number === selectedSeat.seat_number,
          )
        ? "Another seat already has this number."
        : null);

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FormErrorAlert messages={serverErrors} />
      <div className="grid gap-6 xl:grid-cols-[22rem_1fr] xl:items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Layout details</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <TextField control={form.control} name="name" label="Name" placeholder="2+2 Standard · 45 seats" />
                <SelectField control={form.control} name="layout_type" label="Seating pattern" options={SEAT_LAYOUT_TYPES} />
                <TextareaField control={form.control} name="description" label="Description" rows={2} placeholder="Where this layout is used" />
                <SwitchField control={form.control} name="active" label="Active" description="Only active layouts can be assigned to buses." />
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <WandSparklesIcon className="size-4 text-primary" aria-hidden />
                Start from a template
              </CardTitle>
              <CardDescription>Generate a standard layout, then fine-tune it on the grid.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="template-type">Pattern</Label>
                  <Select
                    value={template.layout_type}
                    onValueChange={(value) => setTemplate({ ...template, layout_type: value as "2x2" | "2x1" })}
                  >
                    <SelectTrigger id="template-type" className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2x2">2 + 2</SelectItem>
                      <SelectItem value="2x1">2 + 1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-rows">Passenger rows</Label>
                  <Input
                    id="template-rows"
                    type="number"
                    min={2}
                    max={20}
                    value={template.passenger_rows}
                    onChange={(event) =>
                      setTemplate({ ...template, passenger_rows: Number(event.target.value) || 0 })
                    }
                    className="h-10"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <Label htmlFor="template-back-row" className="font-normal">Full back row</Label>
                <Switch
                  id="template-back-row"
                  checked={template.back_row_full}
                  onCheckedChange={(checked) => setTemplate({ ...template, back_row_full: checked })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <Label htmlFor="template-conductor" className="font-normal">Conductor seat</Label>
                <Switch
                  id="template-conductor"
                  checked={template.conductor_seat}
                  onCheckedChange={(checked) => setTemplate({ ...template, conductor_seat: checked })}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                size="lg"
                onClick={runTemplate}
                disabled={generate.isPending || template.passenger_rows < 2 || template.passenger_rows > 20}
              >
                {generate.isPending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <WandSparklesIcon data-icon="inline-start" />}
                Generate layout
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Seat map</CardTitle>
            <CardDescription>
              Choose a tool, then click cells to paint seats. Use <strong>Select</strong> to edit a
              seat’s number or block it from sale.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div role="radiogroup" aria-label="Editing tool" className="flex flex-wrap gap-1.5">
              {TOOLS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={tool === item.value}
                  onClick={() => setTool(item.value)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4",
                    tool === item.value ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                  )}
                >
                  {item.icon ?? <span aria-hidden className={cn("size-3.5 rounded-sm border", item.swatch)} />}
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Stepper label="Rows" value={grid.rows} min={1} max={MAX_LAYOUT_ROWS} onChange={(rows) => resize(rows, grid.columns)} />
              <Stepper label="Columns" value={grid.columns} min={MIN_LAYOUT_COLUMNS} max={MAX_LAYOUT_COLUMNS} onChange={(columns) => resize(grid.rows, columns)} />
              <Button type="button" variant="outline" size="lg" onClick={() => updateSeats(renumberSeats(grid.seats))} disabled={grid.seats.length === 0}>
                <ListOrderedIcon data-icon="inline-start" />
                Renumber seats
              </Button>
            </div>

            <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-start">
              <div className="overflow-x-auto pb-2">
                {!layout && starter.isPending && edited === null ? (
                  <div className="grid h-96 w-72 place-items-center rounded-3xl border-2 border-dashed text-sm text-muted-foreground">
                    <Loader2Icon className="size-5 animate-spin" aria-label="Loading template" />
                  </div>
                ) : (
                  <SeatMap
                    mode="edit"
                    rows={grid.rows}
                    columns={grid.columns}
                    seats={grid.seats}
                    selectedKey={selectedKey}
                    onCellClick={handleCellClick}
                    label="Seat layout editor"
                  />
                )}
              </div>

              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-2">
                  {[
                    ["Grid", `${grid.rows} × ${grid.columns}`],
                    ["Passenger seats", stats.seatCount],
                    ["Bookable", stats.bookableCount],
                    ["Blocked / reserved", `${stats.unavailableCount} / ${stats.reservedCount}`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg bg-muted/60 px-3 py-2">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-semibold tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="rounded-xl border p-4">
                  {selectedSeat ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold">Seat {selectedSeat.seat_number}</p>
                        <p className="text-xs text-muted-foreground">
                          Row {selectedSeat.row} · Column {selectedSeat.column}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="seat-number">Seat number</Label>
                        <Input
                          id="seat-number"
                          value={selectedSeat.seat_number}
                          onChange={(event) => updateSelected({ seat_number: event.target.value.toUpperCase().trim() })}
                          aria-invalid={Boolean(selectedNumberError)}
                          aria-describedby={selectedNumberError ? "seat-number-error" : undefined}
                          className="h-10 font-mono uppercase"
                        />
                        {selectedNumberError && (
                          <p id="seat-number-error" className="text-sm text-destructive">{selectedNumberError}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="seat-type">Seat type</Label>
                        <Select
                          value={selectedSeat.seat_type}
                          onValueChange={(value) => {
                            const type = value as SeatType;
                            updateSelected({ seat_type: type, is_available: isCrew(type) ? false : selectedSeat.is_available || isCrew(selectedSeat.seat_type) });
                          }}
                        >
                          <SelectTrigger id="seat-type" className="h-10 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SEAT_TYPE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="seat-available" className="font-normal">
                          Available for sale
                        </Label>
                        <Switch
                          id="seat-available"
                          checked={selectedSeat.is_available}
                          disabled={isCrew(selectedSeat.seat_type)}
                          onCheckedChange={(checked) => updateSelected({ is_available: checked })}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        className="w-full"
                        onClick={() => {
                          updateSeats(grid.seats.filter((seat) => seat !== selectedSeat));
                          setSelectedKey(null);
                        }}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        Remove seat
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {tool === "select"
                        ? "Click a seat to edit its number, type or availability."
                        : `Painting with “${TOOLS.find((t) => t.value === tool)?.label}”. Click cells to apply it.`}
                    </p>
                  )}
                </div>

                <SeatLegend />
                {findSeat(grid.seats, 1, grid.columns)?.seat_type !== "driver" && grid.seats.some((s) => s.seat_type === "driver") && (
                  <p className="text-xs text-muted-foreground">
                    Tip: Sri Lankan buses drive on the left, so the driver usually sits front-right.
                  </p>
                )}
              </div>
            </div>

            {problems.length > 0 && (grid.seats.length > 0 || edited !== null) && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                <TriangleAlertIcon />
                <AlertTitle>Fix these before saving</AlertTitle>
                <AlertDescription className="text-amber-900/85">
                  <ul className="list-disc space-y-1 pl-4">
                    {problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <FormActions
        submitLabel={submitLabel}
        pending={form.formState.isSubmitting}
        onCancel={onCancel}
        disabled={problems.length > 0 || Boolean(selectedNumberError)}
      />
      {dialog}
    </form>
  );
}
