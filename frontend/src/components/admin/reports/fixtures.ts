/** Sample API data for the admin bookings, passengers, manifest, report and chart tests. */
import type {
  AdminBookingRow,
  AdminPassengerRow,
  DashboardCharts,
  ReportCatalogue,
  ReportResponse,
  TripManifest,
} from "@/lib/api/report-types";

export const BOOKING_ROW: AdminBookingRow = {
  id: "booking-1",
  booking_reference: "YTABC23456",
  status: "confirmed",
  status_label: "Confirmed",
  customer: { id: "user-1", name: "Kasuni Fernando", phone: "+94771234567", email: "kasuni@example.com" },
  route_name: "Colombo – Batticaloa",
  trip_code: "TR7KQ2M9",
  trip: "trip-1",
  departure: "2030-09-15T20:30:00+05:30",
  seats: 2,
  total_amount: "5150.00",
  paid_amount: "5150.00",
  currency: "LKR",
  payment_status: "successful",
  created_at: "2030-09-10T10:00:00+05:30",
};

export const PASSENGER_ROW: AdminPassengerRow = {
  id: "passenger-1",
  name: "Kasuni Fernando",
  phone: "+94771234567",
  seat_number: "15",
  booking: "booking-1",
  booking_reference: "YTABC23456",
  booking_status: "confirmed",
  payment_status: "successful",
  boarding_status: "expected",
  boarded_at: null,
  boarding_point: "Colombo Fort",
  dropoff_point: "Batticaloa",
  trip: "trip-1",
  trip_code: "TR7KQ2M9",
  route_name: "Colombo – Batticaloa",
  bus_registration: "WP NC-4521",
  departure: "2030-09-15T20:30:00+05:30",
};

export const MANIFEST: TripManifest = {
  trip: {
    id: "trip-1",
    code: "TR7KQ2M9",
    route_name: "Colombo – Batticaloa",
    origin: "Colombo",
    destination: "Batticaloa",
    departure_datetime: "2030-09-15T20:30:00+05:30",
    departure_date: "15 Sep 2030",
    departure_time: "8:30 PM",
    bus_registration: "WP NC-4521",
    bus_name: "Batticaloa Night Express",
    operator_name: "Ceylon Coach Services",
    status: "scheduled",
  },
  counts: { capacity: 41, passengers: 2, boarded: 1, empty_seats: 39, occupancy: 4.9 },
  columns: [
    { key: "seat_number", header: "Seat" },
    { key: "name", header: "Passenger" },
    { key: "boarding_point", header: "Boarding" },
    { key: "dropoff_point", header: "Drop-off" },
    { key: "boarding_state", header: "Boarded" },
  ],
  passengers: [
    {
      id: "passenger-1",
      seat_number: "15",
      name: "Kasuni Fernando",
      boarding_point: "Colombo Fort",
      dropoff_point: "Batticaloa",
      boarding_state: "boarded",
    },
    {
      id: "passenger-2",
      seat_number: "16",
      name: "Dilan Fernando",
      boarding_point: "Colombo Fort",
      dropoff_point: "Batticaloa",
      boarding_state: "expected",
    },
  ],
  printed_at: "2030-09-15T09:00:00+05:30",
};

export const CATALOGUE: ReportCatalogue = {
  reports: [
    { key: "bookings", title: "Booking report", description: "Every booking made or travelling." },
    { key: "passengers", title: "Passenger report", description: "Who is travelling." },
    { key: "revenue", title: "Revenue report", description: "Gross, refunds and net takings." },
    { key: "routes", title: "Route performance report", description: "How each route performed." },
    { key: "occupancy", title: "Bus occupancy report", description: "Seats sold against capacity." },
    { key: "cancellations", title: "Cancellation report", description: "What was cancelled." },
    { key: "payments", title: "Payment report", description: "Every payment attempt." },
  ],
  ranges: [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "week", label: "This week" },
    { key: "month", label: "This month" },
    { key: "custom", label: "Custom range" },
    { key: "all", label: "All time" },
  ],
  formats: ["csv", "xlsx", "pdf"],
  occupancy_groups: ["trip", "route", "bus", "date"],
};

export const BOOKING_REPORT: ReportResponse = {
  key: "bookings",
  title: "Booking report",
  range: { key: "month", label: "This month", from_date: "2030-09-01", to_date: "2030-09-30" },
  columns: [
    { key: "booking_reference", header: "Reference" },
    { key: "customer_name", header: "Customer" },
    { key: "route_name", header: "Route" },
    { key: "seats", header: "Seats" },
    { key: "total_amount", header: "Amount" },
    { key: "status", header: "Booking status" },
  ],
  summary: { bookings: 3, seats: 4, value: "8700.00", cancelled: 1, average_value: "2900.00" },
  count: 3,
  page: 1,
  total_pages: 1,
  next: null,
  previous: null,
  results: [
    {
      id: "booking-1",
      booking_reference: "YTABC23456",
      customer_name: "Kasuni Fernando",
      route_name: "Colombo – Batticaloa",
      seats: 2,
      total_amount: "5000.00",
      status: "confirmed",
    },
    {
      id: "booking-2",
      booking_reference: "YTDEF78901",
      customer_name: "Bob Silva",
      route_name: "Colombo – Kandy",
      seats: 1,
      total_amount: "1200.00",
      status: "confirmed",
    },
  ],
};

export const CHARTS: DashboardCharts = {
  range: { key: "month", label: "This month", from_date: "2030-09-01", to_date: "2030-09-02" },
  bookings: [
    { date: "2030-09-01", bookings: 2, seats: 3 },
    { date: "2030-09-02", bookings: 1, seats: 1 },
  ],
  revenue: [
    { date: "2030-09-01", gross: "6200.00", refunds: "0.00", net: "6200.00" },
    { date: "2030-09-02", gross: "2500.00", refunds: "2500.00", net: "0.00" },
  ],
  cancellations: [
    { date: "2030-09-01", cancellations: 0 },
    { date: "2030-09-02", cancellations: 1 },
  ],
  occupancy: {
    summary: { trips: 2, capacity: 82, seats_sold: 3, occupancy: 3.7 },
    by_date: [
      { date: "2030-09-01", occupancy: 4.9, seats_sold: 2, capacity: 41 },
      { date: "2030-09-02", occupancy: 2.4, seats_sold: 1, capacity: 41 },
    ],
  },
  top_routes: [
    {
      route_id: "route-1",
      route_name: "Colombo – Batticaloa",
      bookings: 2,
      seats_sold: 2,
      occupancy: 4.9,
      net: "5000.00",
    },
    {
      route_id: "route-2",
      route_name: "Colombo – Kandy",
      bookings: 1,
      seats_sold: 1,
      occupancy: 2.4,
      net: "1200.00",
    },
  ],
  totals: {
    bookings: 3,
    booking_value: "8700.00",
    gross_revenue: "8700.00",
    net_revenue: "6200.00",
    cancellations: 1,
    occupancy: 3.7,
    seats_sold: 3,
    capacity: 82,
  },
};
