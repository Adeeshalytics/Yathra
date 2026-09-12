# Setup

Everything you need to run Yathra on your own machine. Two routes: **Docker Compose** (the whole
stack in one command) or **native** (Postgres and Redis in Docker, Django and Next.js on your
machine — faster to iterate on).

Requirements: Docker Desktop, Python 3.12+, Node.js 20+.

---

## 1. Configure

```bash
cp .env.example .env                      # Docker Compose
cp backend/.env.example backend/.env      # native backend
cp frontend/.env.example frontend/.env.local
```

Generate a real secret key and put it in both `.env` files:

```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

`.env`, `.env.local` and `backend/.env` are git-ignored. Never commit a real key, database
password or gateway credential — see [environment.md](environment.md).

---

## 2a. Run everything in Docker

```bash
docker compose up --build
```

- API: http://localhost:8000 (health check at `/api/v1/health/`)
- App: http://localhost:3000
- API docs: http://localhost:8000/api/docs/ (when `API_DOCS_ENABLED=true`)

Migrations run automatically when the backend container starts. To seed demo data:

```bash
docker compose exec backend python manage.py seed_dev_data
```

## 2b. Run natively

Start the data stores, then each service in its own terminal:

```bash
docker compose up -d db redis
```

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate      # Windows
# python3 -m venv .venv && source .venv/bin/activate  # macOS / Linux
pip install -r requirements/development.txt
python manage.py migrate
python manage.py seed_dev_data
python manage.py runserver 8000
```

```bash
cd frontend
npm install
npm run dev
```

---

## 3. Sign in

`seed_dev_data` creates one account per role. The password is printed when the command finishes
(`Yathra@Dev2026` unless you pass `--password`):

| Role | Email |
|------|-------|
| Administrator | `admin@yathra.test` |
| Operator | `operator@yathra.test` |
| Customer | `customer@yathra.test` |

The seed also builds eight routes, a fleet, two weeks of trips, and a handful of bookings,
payments and refunds so every screen has something in it.

To create your own administrator instead:

```bash
python manage.py createsuperuser        # Django admin + platform admin role
```

---

## 4. Day-to-day commands

Backend (from `backend/`):

| Command | What it does |
|---------|--------------|
| `pytest` | The whole test suite |
| `pytest apps/bookings -q` | One app |
| `ruff check . && ruff format .` | Lint and format |
| `python manage.py makemigrations --check --dry-run` | Fail if a model change has no migration |
| `python manage.py expire_seat_holds` | Release holds that ran out (scheduled job) |
| `python manage.py reconcile_payments` | Ask gateways about attempts they never reported (scheduled job) |
| `python manage.py seed_dev_data` | Rebuild the demo data (idempotent) |

Frontend (from `frontend/`):

| Command | What it does |
|---------|--------------|
| `npm run dev` | Development server |
| `npm run check` | Types, lint and tests — run this before pushing |
| `npm run build` | Production build |
| `npx vitest run src/components/booking` | One folder of tests |

---

## 5. When something is wrong

**`connection timeout expired` / tests suddenly take minutes.** Postgres is not running. Start
Docker Desktop, wait for `docker info` to succeed, then `docker compose up -d db redis`.

**`ImproperlyConfigured: PAYMENT_PROVIDERS includes the test gateway 'mock'`.** You are running
production settings with the test gateway enabled. Set `PAYMENT_PROVIDERS=payhere`, or use
`config.settings.staging` if you meant to.

**The app loads but every request fails with a CORS error.** `CORS_ALLOWED_ORIGINS` must contain
the exact origin the browser is on, including the port.

**Payments never confirm.** The gateway posts its notification to `PUBLIC_API_URL`. On a laptop
that address has to be reachable from the gateway — use the built-in `mock` gateway locally, or a
tunnel if you are testing PayHere sandbox.

**Seats look stuck as "locked".** Holds expire on their own, and `expire_seat_holds` sweeps them;
any GET of the seat map also releases the ones that ran out.
