import type {
  BookingScope,
  BookingSummary,
  CancellationQuote,
  CreateBookingPayload,
  CustomerBooking,
  PassengerInput,
} from "./booking-types";
import { api } from "./client";
import type {
  CustomerPayment,
  CustomerRefund,
  CustomerTicket,
  PaymentProvidersResponse,
  StartPaymentResponse,
} from "./payment-types";
import type {
  PublicTrip,
  SeatHold,
  TripSeatMap,
  TripSearchResponse,
  TripStopsResponse,
} from "./trip-types";
import type {
  OperatorBookingDetail,
  OperatorBookingRow,
  OperatorDashboard,
  OperatorReportKey,
  OperatorTripDetail,
  OperatorTripRow,
  SharedTicket,
} from "./portal-types";
import type { ExportFormat, ReportResponse, TripManifest } from "./report-types";
import type {
  AuthResponse,
  OperatorProfile,
  Paginated,
  PhoneCodeSent,
  PhoneSignInResponse,
  Route,
  Stop,
  User,
} from "./types";

export interface LoginPayload {
  email: string;
  password: string;
  /** Sent after a texted code met an account with a password: signing in links the phone. */
  phone_proof?: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface ProfilePayload {
  name?: string;
  phone?: string;
  email?: string;
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

export const authApi = {
  login: (payload: LoginPayload) =>
    api.post<AuthResponse>("/auth/login/", payload, { auth: false }),
  register: (payload: RegisterPayload) =>
    api.post<AuthResponse>("/auth/register/", payload, { auth: false }),
  logout: () => api.post<void>("/auth/logout/", undefined, { auth: false }),
  /** Text a six-digit sign-in code (customers). */
  requestPhoneCode: (phone: string) =>
    api.post<PhoneCodeSent>("/auth/phone/code/", { phone }, { auth: false }),
  /** Sign in with the texted code; a number we haven't seen becomes a new account. */
  verifyPhoneCode: (phone: string, code: string) =>
    api.post<PhoneSignInResponse>("/auth/phone/verify/", { phone, code }, { auth: false }),
  me: () => api.get<User>("/auth/me/"),
  updateProfile: (payload: ProfilePayload) => api.patch<User>("/auth/me/", payload),
  /** Answers with a fresh session: changing the password retires the old tokens. */
  changePassword: (payload: ChangePasswordPayload) =>
    api.post<AuthResponse>("/auth/password/", payload),
};

export const catalogApi = {
  stops: (signal?: AbortSignal) =>
    api.get<Paginated<Stop>>("/stops/", { auth: false, query: { page_size: 100 }, signal }),
  routes: (params: { page_size?: number; search?: string } = {}, signal?: AbortSignal) =>
    api.get<Paginated<Route>>("/routes/", { auth: false, query: params, signal }),
};

export type TripSearchParams = Record<string, string | number | undefined>;

export const tripsApi = {
  search: (params: TripSearchParams, signal?: AbortSignal) =>
    api.get<TripSearchResponse>("/trips/search/", { auth: false, query: params, signal }),
  get: (id: string, signal?: AbortSignal) =>
    api.get<PublicTrip>(`/trips/${id}/`, { auth: false, signal }),
  stops: (id: string, signal?: AbortSignal) =>
    api.get<TripStopsResponse>(`/trips/${id}/stops/`, { auth: false, signal }),
  /** Sent with the session when signed in, so the response includes your own hold. */
  seats: (id: string, signal?: AbortSignal) =>
    api.get<TripSeatMap>(`/trips/${id}/seats/`, { signal }),
};

export const seatLocksApi = {
  hold: (tripId: string, signal?: AbortSignal) =>
    api.get<SeatHold>("/seat-locks/", { query: { trip: tripId }, signal }),
  lock: (tripId: string, seats: string[]) =>
    api.post<SeatHold>("/seat-locks/", { trip: tripId, seats }),
  release: (lockId: string) => api.delete<SeatHold>(`/seat-locks/${lockId}/`),
  releaseAll: (tripId: string) => api.post<SeatHold>("/seat-locks/release/", { trip: tripId }),
};

export type MyBookingsParams = {
  page?: number;
  /** The dashboard tab: upcoming, past or cancelled. */
  scope?: BookingScope;
  search?: string;
  status?: string;
};

export const bookingsApi = {
  mine: (params: MyBookingsParams = {}, signal?: AbortSignal) =>
    api.get<Paginated<CustomerBooking>>("/bookings/", { query: params, signal }),
  summary: (signal?: AbortSignal) =>
    api.get<BookingSummary>("/bookings/summary/", { signal }),
  /** The server's cancellation policy for this booking, in full. */
  cancellation: (id: string, signal?: AbortSignal) =>
    api.get<CancellationQuote>(`/bookings/${id}/cancellation/`, { signal }),
  get: (id: string, signal?: AbortSignal) =>
    api.get<CustomerBooking>(`/bookings/${id}/`, { signal }),
  create: (payload: CreateBookingPayload) => api.post<CustomerBooking>("/bookings/", payload),
  updatePassengers: (id: string, passengers: PassengerInput[]) =>
    api.patch<CustomerBooking>(`/bookings/${id}/`, { passengers }),
  checkout: (id: string) => api.post<CustomerBooking>(`/bookings/${id}/checkout/`),
  cancel: (id: string, reason = "") =>
    api.post<CustomerBooking>(`/bookings/${id}/cancel/`, { reason }),
  ticket: (id: string, signal?: AbortSignal) =>
    api.get<CustomerTicket>(`/bookings/${id}/ticket/`, { signal }),
  ticketPdf: (id: string) => api.blob(`/bookings/${id}/ticket/pdf/`),
};

export const paymentsApi = {
  providers: (signal?: AbortSignal) =>
    api.get<PaymentProvidersResponse>("/payments/providers/", { signal }),
  /** Pay Now: opens (or resumes) a payment attempt and returns the gateway checkout. */
  start: (bookingId: string, provider: string) =>
    api.post<StartPaymentResponse>("/payments/", { booking: bookingId, provider }),
  get: (id: string, signal?: AbortSignal) =>
    api.get<CustomerPayment>(`/payments/${id}/`, { signal }),
  /** Ask the server to check with the gateway now (it never trusts the browser's word). */
  verify: (id: string) => api.post<CustomerPayment>(`/payments/${id}/verify/`),
  cancel: (id: string) => api.post<CustomerPayment>(`/payments/${id}/cancel/`),
};

export const refundsApi = {
  mine: (params: { page?: number; status?: string } = {}, signal?: AbortSignal) =>
    api.get<Paginated<CustomerRefund>>("/refunds/", { query: params, signal }),
};

export const ticketsApi = {
  /** The ticket behind a shared link — no session needed, the link is the credential. */
  shared: (code: string, signal?: AbortSignal) =>
    api.get<SharedTicket>(`/tickets/shared/${encodeURIComponent(code)}/`, { auth: false, signal }),
  sharedPdf: (code: string) =>
    api.blob(`/tickets/shared/${encodeURIComponent(code)}/pdf/`, { auth: false }),
  /** "Find my booking": texts the ticket to a phone already on the booking. */
  find: (reference: string, phone: string) =>
    api.post<{ detail: string }>("/tickets/find/", { reference, phone }, { auth: false }),
};

type Params = Record<string, string | number | boolean | undefined>;

/** The operator portal: always the signed-in operator's own company. */
export const operatorApi = {
  profile: (signal?: AbortSignal) => api.get<OperatorProfile>("/operator/profile/", { signal }),
  dashboard: (signal?: AbortSignal) =>
    api.get<OperatorDashboard>("/operator/dashboard/", { signal }),
  trips: {
    list: (params: Params = {}, signal?: AbortSignal) =>
      api.get<Paginated<OperatorTripRow>>("/operator/trips/", { query: params, signal }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<OperatorTripDetail>(`/operator/trips/${id}/`, { signal }),
    manifest: (id: string, signal?: AbortSignal) =>
      api.get<TripManifest>(`/operator/trips/${id}/manifest/`, { signal }),
    manifestPdf: (id: string, code: string) =>
      api.download(`/operator/trips/${id}/manifest/pdf/`, `yathra-manifest-${code}.pdf`),
  },
  bookings: {
    list: (params: Params = {}, signal?: AbortSignal) =>
      api.get<Paginated<OperatorBookingRow>>("/operator/bookings/", { query: params, signal }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<OperatorBookingDetail>(`/operator/bookings/${id}/`, { signal }),
  },
  reports: {
    run: (key: OperatorReportKey, params: Params = {}, signal?: AbortSignal) =>
      api.get<ReportResponse>(`/operator/reports/${key}/`, { query: params, signal }),
    download: (key: OperatorReportKey, format: ExportFormat, params: Params = {}) =>
      api.download(`/operator/reports/${key}/export/`, `yathra-${key}.${format}`, {
        query: { ...params, format },
      }),
  },
};
