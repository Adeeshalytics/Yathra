// Load test: the customer's browsing journey — the hot path of a bus-booking site.
//
//   search a route for a date → open a trip → load its seat map
//
// Run it against the local cluster (deploy/Makefile: `make load-test`), or any environment with
// BASE_URL=https://staging.example.com. See docs/devops/06-reliability.md.
//
// The thresholds are the service-level objectives: the run fails if more than 1% of requests
// fail, or if the slowest 5% take longer than 500 ms.
import http from "k6/http";
import { check, group, sleep } from "k6";

const BASE = (__ENV.BASE_URL || "http://yathra.localhost").replace(/\/$/, "");
const API = `${BASE}/api/v1`;

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Number(__ENV.VUS || 20) }, // ramp up
        { duration: __ENV.HOLD || "2m", target: Number(__ENV.VUS || 20) }, // steady load
        { duration: "15s", target: 0 }, // ramp down
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    "http_req_duration{name:search}": ["p(95)<500"],
    "http_req_duration{name:seats}": ["p(95)<500"],
  },
};

// Once, before the test: the stops, and the city pairs to search between.
export function setup() {
  const res = http.get(`${API}/stops/?page_size=100`);
  const stops = res.json().results ?? res.json();
  const find = (word) => stops.find((s) => s.name.toLowerCase().includes(word));
  const pairs = [
    ["colombo", "kandy"],
    ["colombo", "galle"],
    ["colombo", "jaffna"],
    ["kandy", "nuwara"],
  ]
    .map(([a, b]) => [find(a), find(b)])
    .filter(([a, b]) => a && b)
    .map(([a, b]) => ({ from: a.id, to: b.id }));
  if (!pairs.length) throw new Error("No seeded routes found — run `make seed` first.");
  return { pairs };
}

export default function ({ pairs }) {
  const pair = pairs[Math.floor(Math.random() * pairs.length)];
  const day = new Date(Date.now() + (1 + Math.floor(Math.random() * 3)) * 864e5);
  const date = day.toISOString().slice(0, 10);

  group("search", () => {
    const res = http.get(`${API}/trips/search/?from=${pair.from}&to=${pair.to}&date=${date}`, {
      tags: { name: "search" },
    });
    check(res, { "search 200": (r) => r.status === 200 });
    const trips = res.status === 200 ? (res.json().results ?? res.json()) : [];
    if (!trips.length) return;
    const trip = trips[Math.floor(Math.random() * trips.length)];
    sleep(Math.random() * 2); // reading the results

    const detail = http.get(`${API}/trips/${trip.id}/`, { tags: { name: "trip" } });
    check(detail, { "trip 200": (r) => r.status === 200 });
    const seats = http.get(`${API}/trips/${trip.id}/seats/`, { tags: { name: "seats" } });
    check(seats, { "seats 200": (r) => r.status === 200 });
  });
  sleep(1 + Math.random() * 2); // choosing seats
}
