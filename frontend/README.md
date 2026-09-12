# Frontend (Next.js)

The customer site, admin console and operator portal for the bus booking platform.
See the [root README](../README.md) for architecture, environment variables and the full setup.

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
npm install
npm run dev                  # http://localhost:3000
npm run check                # typegen + tsc + eslint
npm run build                # production build (standalone output)
```

Key locations: `src/lib/api/` (HTTP client, endpoints, types), `src/lib/auth/session.ts`
(in-memory session), `src/hooks/use-auth.ts`, `src/components/ui/` (shadcn/ui primitives) and
`src/components/common/` (data table, dialogs, empty/error states).
