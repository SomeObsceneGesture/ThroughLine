# ThroughLine

Operations platform for boutique hotels. Shift handovers, guest requests, VIP tracking — tuned for a GM who needs to walk in and see what matters in ten seconds.

## Repo layout

```
throughline/
├── throughline-backend/    # Express + Prisma + SQLite (dev) / Postgres (prod)
├── throughline-frontend/   # Vite + React 18 + Tailwind
├── docs/                   # Original build brief (SCHEMA.md, TWILIO_WEBHOOK.md, etc.)
└── .claude/                # launch.json for dev-server orchestration
```

## Running locally

Backend:

```
cd throughline-backend
npm install
npm run dev          # starts on :3000 (or auto-picks if busy)
```

Frontend:

```
cd throughline-frontend
npm install
cp .env.example .env.local   # then edit VITE_API_URL if backend on a non-default port
npm run dev                   # starts on :5173
```

The Vite dev server proxies `/api/*` to the backend URL in `VITE_API_URL`.

## Demo credentials (seeded)

```
gm@grandmetropolitan.com / throughline123
```

## Stack

- **Backend**: Node 20 + TypeScript + Express + Prisma, JWT auth, multi-tenant scoped by `propertyId`.
- **Frontend**: React 18 + Vite 5 + Tailwind 3.4 + Zod + react-router-dom 6.
- **Design system**: Inter, near-black `#0A0A0B` surface, `#6AA3FF` accent, flat 1px borders, tabular-nums by default.

## Key UX surfaces

- **Today** — current-shift dashboard with open requests sorted by SLA urgency, foresight rail, VIP rail.
- **Handover** — AM/PM/NIGHT shift pick; compose pre-populates carry-forward items from previous shift.
- **Requests** — two-pane list+detail, SLA ring, notes, assign menu, filter by status/category/priority.
- **Guests** — debounced search, VIP badge, per-guest profile with preferences.
- **Arrivals** — derived from VIP guests + handover VIP_ARRIVAL items (deduped).
- **⌘K palette** — scoped search across guests and requests with keyboard nav.

## Multi-tenant safety

Every backend route filters on `req.user.propertyId`. There's a regression test proving cross-property reads return 404.

## Environment

Backend reads `.env` for `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PORT`. Frontend reads `.env.local` for `VITE_API_URL`.

See `docs/` for the original build brief (Twilio SMS concierge, LLM routing) — that scope is not yet wired to this ops dashboard but the schema reserves room for it.
