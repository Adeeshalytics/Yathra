/** Types mirroring the Django REST API (/api/v1). Money values arrive as decimal strings. */

export type UserRole = "customer" | "operator" | "admin";

export interface User {
  id: string;
  name: string;
  /** Null for customers who booked with just a phone number. */
  email: string | null;
  phone: string;
  /** The phone number was proven with a texted code. */
  phone_verified: boolean;
  /** False for customers who sign in with codes texted to their phone. */
  has_password: boolean;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  access: string;
  user: User;
}

export interface PhoneCodeSent {
  phone: string;
  masked_phone: string;
  code_length: number;
  /** Seconds until the code stops working. */
  expires_in: number;
  /** Seconds before another code may be sent. */
  resend_in: number;
}

export interface PhoneSignInResponse extends AuthResponse {
  /** A new account was made for this number. */
  created: boolean;
}

export interface Paginated<T> {
  count: number;
  page: number;
  total_pages: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
    request_id: string;
  };
}

export interface Stop {
  id: string;
  name: string;
  city: string;
  latitude: string | null;
  longitude: string | null;
}

export interface Route {
  id: string;
  name: string;
  route_number: string;
  origin: Stop;
  destination: Stop;
  description: string;
  duration_minutes: number | null;
  stop_count: number;
  starting_fare: string | null;
}

export type TripStatus = "scheduled" | "boarding" | "departed" | "completed" | "cancelled";

export type OperatorStatus = "pending" | "active" | "suspended";

export interface Operator {
  id: string;
  company_name: string;
  registration_number: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  status: OperatorStatus;
  created_at: string;
  updated_at: string;
}

export interface OperatorProfile {
  role: "owner" | "manager" | "staff";
  operator: Operator;
}
