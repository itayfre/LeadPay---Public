# LeadPay Frontend

React + TypeScript frontend for LeadPay — the building-management payment tracker.
Hebrew (RTL) by default, English optional.

> Full product docs: [`../README.md`](../README.md) · Contributor/agent guide: [`CLAUDE.md`](./CLAUDE.md)

## Tech Stack

- **React 19** + **TypeScript** (strict mode)
- **Vite 7** — dev server + build
- **Tailwind CSS v3** — styling (unified `ink`/`primary`/`accent`/`warn`/`danger` token palette)
- **TanStack Query v5** — server state
- **React Router v7** — routing
- **i18next** — Hebrew/English
- **Recharts** — charts

UI primitives are hand-rolled in `src/components/ui/` (`Button`, `Badge`, `Modal`) — not shadcn.
See [`CLAUDE.md`](./CLAUDE.md) for the design-system rules.

## Development

```bash
npm install
echo "VITE_API_URL=http://localhost:8000" > .env.local   # point at local backend
npm run dev       # dev server on http://localhost:5173
npm run build     # tsc -b + vite build (run before pushing — catches type errors)
npm run lint      # eslint
npm run preview   # serve the production build
```

## Environment

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Backend base URL (must include `https://` in prod; baked at build time). |

## Routes

| Path | Page | Access |
|------|------|--------|
| `/login`, `/register`, `/setup`, `/invite/:token` | Auth flows | Public |
| `/accessibility-statement` | IS 5568 statement | Public |
| `/buildings` | Buildings list | Authenticated |
| `/building/:buildingId` | Building dashboard (tabs) | Authenticated |
| `/building/:buildingId/upload` | Upload bank statement | Authenticated |
| `/building/:buildingId/tenants` | Building tenants | Authenticated |
| `/statements` | Statements | Authenticated |
| `/transactions` | Global transactions | Authenticated |
| `/tenants` | All tenants | Authenticated |
| `/settings`, `/whatsapp-templates` | Settings | Authenticated |
| `/users` | User management | Manager only |

## Project Layout

```
src/
  pages/        # Route-level pages
  components/   # Reusable UI (layout/, modals/, building/, ui/, …)
  context/      # AuthContext, ConfigContext
  hooks/        # Custom hooks
  services/     # api.ts — central typed fetch client
  types/        # Shared TypeScript interfaces (keep in sync with backend)
  i18n/         # he/en translations
  lib/          # cn(), buildingStatus, helpers
```

## Conventions

- All API calls go through `src/services/api.ts`; **list endpoints need a trailing slash**.
- Server state → TanStack Query; invalidate queries after mutations.
- All shared response shapes live in `src/types/index.ts` — keep them matching the backend.
- Hebrew/RTL is default; user-facing strings belong in `src/i18n/` (`he` + `en` together).
