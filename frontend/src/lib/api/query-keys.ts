import type { AdminResource, ListParams } from "./admin";

/** Central TanStack Query keys, so invalidation never depends on string typos. */
export const queryKeys = {
  stops: ["stops"] as const,
  routes: (params: Record<string, unknown> = {}) => ["routes", params] as const,
  myBookings: (params: Record<string, unknown> = {}) => ["bookings", "mine", params] as const,
  tripSearch: (params: Record<string, unknown>) => ["trips", "search", params] as const,
  trip: (id: string) => ["trips", "detail", id] as const,
  tripStops: (id: string) => ["trips", "detail", id, "stops"] as const,
  /** Includes the viewer, because the response carries their own seat hold. */
  tripSeats: (id: string, viewer = "guest") => ["trips", "detail", id, "seats", viewer] as const,
  tripSeatsAll: (id: string) => ["trips", "detail", id, "seats"] as const,
  booking: (id: string) => ["bookings", "detail", id] as const,
  ticket: (bookingId: string) => ["bookings", "detail", bookingId, "ticket"] as const,
  cancellation: (bookingId: string) => ["bookings", "detail", bookingId, "cancellation"] as const,
  allMyBookings: ["bookings", "mine"] as const,
  bookingSummary: ["bookings", "summary"] as const,
  myRefunds: (params: Record<string, unknown> = {}) => ["refunds", "mine", params] as const,
  paymentProviders: ["payments", "providers"] as const,
  payment: (id: string) => ["payments", "detail", id] as const,
  operatorProfile: ["operator", "profile"] as const,
  sharedTicket: (code: string) => ["tickets", "shared", code] as const,
  operator: {
    all: ["operator"] as const,
    dashboard: ["operator", "dashboard"] as const,
    trips: (params: Record<string, unknown> = {}) => ["operator", "trips", "list", params] as const,
    trip: (id: string) => ["operator", "trips", "detail", id] as const,
    manifest: (id: string) => ["operator", "trips", "detail", id, "manifest"] as const,
    bookings: (params: Record<string, unknown> = {}) =>
      ["operator", "bookings", "list", params] as const,
    booking: (id: string) => ["operator", "bookings", "detail", id] as const,
    report: (key: string, params: Record<string, unknown> = {}) =>
      ["operator", "reports", key, params] as const,
  },
  admin: {
    all: ["admin"] as const,
    dashboard: ["admin", "dashboard"] as const,
    activity: (params: ListParams = {}) => ["admin", "activity", params] as const,
    resource: (resource: AdminResource) => ["admin", resource] as const,
    list: (resource: AdminResource, params: ListParams = {}) =>
      ["admin", resource, "list", params] as const,
    detail: (resource: AdminResource, id: string) => ["admin", resource, "detail", id] as const,
    cities: ["admin", "stops", "cities"] as const,
    paymentSummary: ["admin", "payments", "summary"] as const,
    bookingCancellation: (id: string) => ["admin", "bookings", "detail", id, "cancellation"] as const,
    manifest: (tripId: string) => ["admin", "trips", "detail", tripId, "manifest"] as const,
    reportCatalogue: ["admin", "reports", "catalogue"] as const,
    report: (key: string, params: ListParams = {}) => ["admin", "reports", key, params] as const,
    charts: (params: ListParams = {}) => ["admin", "dashboard", "charts", params] as const,
  },
};
