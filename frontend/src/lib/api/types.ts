/** Types mirroring the Django REST API (/api/v1). Money values arrive as decimal strings. */

export type UserRole = "customer" | "operator" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  access: string;
  user: User;
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
