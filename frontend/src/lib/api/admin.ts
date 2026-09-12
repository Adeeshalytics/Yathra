import type {
  ActivityEntry,
  AdminBus,
  AdminOperator,
  AdminRouteDetail,
  AdminRouteSummary,
  AdminStop,
  AdminTrip,
  AdminTripDetail,
  AdminTripSchedule,
  BusPayload,
  DashboardSummary,
  GeneratedLayout,
  GenerateLayoutPayload,
  GenerateTripsPayload,
  GenerateTripsResult,
  OperatorPayload,
  RoutePayload,
  SeatLayoutDetail,
  SeatLayoutPayload,
  SeatLayoutSummary,
  StopPayload,
  TripPayload,
  TripSchedulePayload,
  TripStatus,
} from "./admin-types";
import type { CancellationQuote, CustomerBooking } from "./booking-types";
import { api } from "./client";
import type {
  AdminPayment,
  AdminPaymentDetail,
  AdminRefund,
  PaymentSummary,
  RefundPayload,
  RefundStatusPayload,
} from "./payment-types";
import type {
  AdminBookingRow,
  AdminPassengerRow,
  DashboardCharts,
  ExportFormat,
  ReportCatalogue,
  ReportKey,
  ReportResponse,
  TripManifest,
} from "./report-types";
import type { Paginated } from "./types";

export type ListParams = Record<string, string | number | boolean | undefined>;

/** Standard admin CRUD endpoints for one resource. */
function resource<TSummary, TDetail, TPayload>(base: string) {
  return {
    list: (params: ListParams = {}, signal?: AbortSignal) =>
      api.get<Paginated<TSummary>>(`${base}/`, { query: params, signal }),
    get: (id: string, signal?: AbortSignal) => api.get<TDetail>(`${base}/${id}/`, { signal }),
    create: (payload: TPayload) => api.post<TDetail>(`${base}/`, payload),
    update: (id: string, payload: Partial<TPayload>) =>
      api.patch<TDetail>(`${base}/${id}/`, payload),
    remove: (id: string) => api.delete<void>(`${base}/${id}/`),
    activate: (id: string) => api.post<TDetail>(`${base}/${id}/activate/`),
    deactivate: (id: string) => api.post<TDetail>(`${base}/${id}/deactivate/`),
  };
}

export const adminApi = {
  dashboard: (signal?: AbortSignal) =>
    api.get<DashboardSummary>("/admin/dashboard/", { signal }),
  activity: (params: ListParams = {}, signal?: AbortSignal) =>
    api.get<Paginated<ActivityEntry>>("/admin/activity/", { query: params, signal }),
  operators: resource<AdminOperator, AdminOperator, OperatorPayload>("/admin/operators"),
  buses: resource<AdminBus, AdminBus, BusPayload>("/admin/buses"),
  seatLayouts: {
    ...resource<SeatLayoutSummary, SeatLayoutDetail, SeatLayoutPayload>("/admin/seat-layouts"),
    generate: (payload: GenerateLayoutPayload) =>
      api.post<GeneratedLayout>("/admin/seat-layouts/generate/", payload),
  },
  routes: resource<AdminRouteSummary, AdminRouteDetail, RoutePayload>("/admin/routes"),
  stops: {
    ...resource<AdminStop, AdminStop, StopPayload>("/admin/stops"),
    cities: (signal?: AbortSignal) => api.get<string[]>("/admin/stops/cities/", { signal }),
  },
  trips: {
    ...resource<AdminTrip, AdminTripDetail, TripPayload>("/admin/trips"),
    cancel: (id: string, reason: string) =>
      api.post<AdminTripDetail>(`/admin/trips/${id}/cancel/`, { reason }),
    setStatus: (id: string, status: TripStatus) =>
      api.post<AdminTripDetail>(`/admin/trips/${id}/status/`, { status }),
    resetTimings: (id: string) => api.post<AdminTripDetail>(`/admin/trips/${id}/reset-timings/`),
    manifest: (id: string, signal?: AbortSignal) =>
      api.get<TripManifest>(`/admin/trips/${id}/manifest/`, { signal }),
    manifestPdf: (id: string, code: string) =>
      api.download(`/admin/trips/${id}/manifest/pdf/`, `yathra-manifest-${code}.pdf`),
  },
  tripSchedules: {
    ...resource<AdminTripSchedule, AdminTripSchedule, TripSchedulePayload>(
      "/admin/trip-schedules",
    ),
    generate: (id: string, payload: GenerateTripsPayload) =>
      api.post<GenerateTripsResult>(`/admin/trip-schedules/${id}/generate/`, payload),
  },
  /** Read-only: payments change through the gateway, refunds and status checks. */
  payments: {
    list: (params: ListParams = {}, signal?: AbortSignal) =>
      api.get<Paginated<AdminPayment>>("/admin/payments/", { query: params, signal }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<AdminPaymentDetail>(`/admin/payments/${id}/`, { signal }),
    summary: (signal?: AbortSignal) =>
      api.get<PaymentSummary>("/admin/payments/summary/", { signal }),
    refund: (id: string, payload: RefundPayload) =>
      api.post<AdminPaymentDetail>(`/admin/payments/${id}/refund/`, payload),
    reconcile: (id: string) => api.post<AdminPaymentDetail>(`/admin/payments/${id}/reconcile/`),
  },
  /** Every booking on the platform, read-only apart from cancelling one for a customer. */
  bookings: {
    list: (params: ListParams = {}, signal?: AbortSignal) =>
      api.get<Paginated<AdminBookingRow>>("/admin/bookings/", { query: params, signal }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<CustomerBooking>(`/admin/bookings/${id}/`, { signal }),
    cancellation: (id: string, signal?: AbortSignal) =>
      api.get<CancellationQuote>(`/admin/bookings/${id}/cancellation/`, { signal }),
    cancel: (id: string, reason = "") =>
      api.post<CustomerBooking>(`/admin/bookings/${id}/cancel/`, { reason }),
  },
  /** Who is travelling — by trip, route, date, bus or booking — and who has boarded. */
  passengers: {
    list: (params: ListParams = {}, signal?: AbortSignal) =>
      api.get<Paginated<AdminPassengerRow>>("/admin/passengers/", { query: params, signal }),
    setBoarding: (id: string, boarded: boolean) =>
      api.post<AdminPassengerRow>(`/admin/passengers/${id}/boarding/`, { boarded }),
  },
  /** Reports are aggregated by the database; the browser only ever holds one page of rows. */
  reports: {
    catalogue: (signal?: AbortSignal) =>
      api.get<ReportCatalogue>("/admin/reports/", { signal }),
    run: (key: ReportKey, params: ListParams = {}, signal?: AbortSignal) =>
      api.get<ReportResponse>(`/admin/reports/${key}/`, { query: params, signal }),
    download: (key: ReportKey, format: ExportFormat, params: ListParams = {}) =>
      api.download(`/admin/reports/${key}/export/`, `yathra-${key}.${format}`, {
        query: { ...params, format },
      }),
  },
  charts: (params: ListParams = {}, signal?: AbortSignal) =>
    api.get<DashboardCharts>("/admin/dashboard/charts/", { query: params, signal }),
  /** The refund queue: what customers are owed and how far along each request is. */
  refunds: {
    list: (params: ListParams = {}, signal?: AbortSignal) =>
      api.get<Paginated<AdminRefund>>("/admin/refunds/", { query: params, signal }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<AdminRefund>(`/admin/refunds/${id}/`, { signal }),
    setStatus: (id: string, payload: RefundStatusPayload) =>
      api.post<AdminRefund>(`/admin/refunds/${id}/status/`, payload),
  },
};

export type AdminResource =
  | "operators"
  | "buses"
  | "seat-layouts"
  | "routes"
  | "stops"
  | "trips"
  | "trip-schedules"
  | "payments"
  | "refunds"
  | "bookings"
  | "passengers"
  | "reports";
