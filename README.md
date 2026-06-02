# LeadPay — Building Management Payment Tracker

> ניהול תשלומים לבניינים — דיירים, תשלומים, הוצאות ותזכורות תשלום

LeadPay automates the most painful parts of building management: matching bank-statement
transactions to tenants, tracking who paid and who didn't, splitting expenses and special
charges, generating reports, and sending payment reminders by WhatsApp, SMS, and email —
all in Hebrew with RTL support.

> **Public showcase snapshot.** This is a curated, read-only copy of the application
> for portfolio purposes. Some parts are **intentionally omitted** because this is a
> public repository and the app runs a real production deployment with customer data:
>
> - **Secrets & credentials** — no `.env` files; all config (`backend/.env.example`)
>   uses placeholders. Database/Supabase project identifiers are redacted
>   (`your-prod-project-ref`, `your-project-ref`).
> - **Internal operations** — production runbooks, data-baseline captures, and
>   migration cutover records are not included.
> - **Internal design docs & agent guides** (`docs/plans/`, `CLAUDE.md`) are omitted.
>
> The code itself is complete and runnable against your own database and environment.
> It remains proprietary — see [LICENSE](LICENSE).

---

## Features

| Feature | Description |
|---------|-------------|
| Buildings | Create and manage multiple buildings and their apartments |
| Tenants | Import from Excel, track ownership type (owner / landlord / renter), standing orders, move-in dates |
| Bank Statements | Upload Excel statements, auto-parse and de-duplicate transactions |
| Smart Matching | Fuzzy Hebrew name matching (5 strategies, 70% threshold) with learned matches |
| Manual Review | Match / unmatch / ignore transactions, and split one transaction across multiple tenants (allocations) |
| Payment Dashboard | Real-time payment status per period, per building |
| Debt Tracking | Per-period apartment and tenant debt, debt aging |
| Expenses | Per-building expense categories, automatic vendor classification, categorize and bulk-categorize transactions |
| Special Charges | One-off charges split across apartments (by weight / evenly) |
| Reminders | Multi-channel — WhatsApp (wa.me links), SMS (with opt-out), and HTML email — with customizable per-channel templates |
| Reports | Export building and tenant reports as PDF and DOCX (Hebrew RTL) |
| Portfolio & Analytics | Cross-building collection view, KPI strip, and charts (collection trend, debt aging, expenses breakdown, worst payers) |
| Imports | Import expected monthly amounts from the building's tenants Excel file |
| Auth + Roles | JWT auth with 4 roles (Manager, Worker, Viewer, Tenant) |
| Accessibility | Public accessibility statement page (Israeli IS 5568 / WCAG) |
| Bilingual | Hebrew RTL default, English optional |

---

## Screenshots

> Building names, addresses, and tenant/payer details are **blurred** — this is a public showcase of a live product with real customer data.

### Login
![Login](docs/screenshots/01-login.png)

### Buildings dashboard — portfolio KPIs, per-building collection status, risk filters
![Buildings dashboard](docs/screenshots/02-buildings.png)

### Bank-statement review — fuzzy Hebrew name matching with confidence scores
![Statement review and matching](docs/screenshots/05-review.png)

### Multi-channel reminders — select buildings, ownership type, and debt filters
![Send reminders](docs/screenshots/04-reminders.png)

### Report export — building / tenant report with PDF + DOCX export
![Report export](docs/screenshots/03-report.png)

---

## User Roles

| Role | Can Do |
|------|--------|
| Manager | Full CRUD, manage users, approve tenants |
| Worker | View + edit everything, upload statements, send reminders |
| Viewer | Read-only access to all data |
| Tenant | Read-only access to their own building |

### Account Flows
- Manager / Worker / Viewer: Manager sends an email invite → user sets password → account active
- Tenant: Self-registers at `/register` → status = `pending` → Manager approves

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL (Supabase recommended)

### 1 — Clone & Set Up Backend

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate         # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy env template and fill in your values
cp .env.example .env
# Edit .env — set DATABASE_URL and APP_SECRET_KEY

# Run migrations
alembic upgrade head

# Create the first manager account
python3 scripts/create_manager.py --email admin@example.com --name "Admin" --password "yourpassword"

# Start server
uvicorn app.main:app --reload
```

Backend runs at **http://localhost:8000** — API docs at **/docs**

### 2 — Set Up Frontend

```bash
cd frontend

# Install dependencies
npm install

# Set backend URL
echo "VITE_API_URL=http://localhost:8000" > .env.local

# Start dev server
npm run dev
```

Frontend runs at **http://localhost:5173**

---

## Project Structure

```
leadpay/
├── backend/
│   ├── app/
│   │   ├── models/            # SQLAlchemy models (one file per entity)
│   │   ├── routers/           # FastAPI endpoints (auth, buildings, tenants,
│   │   │                      #   statements, payments, expenses, special_charges,
│   │   │                      #   collecting, transactions, messages, imports,
│   │   │                      #   settings, users)
│   │   ├── schemas/           # Pydantic request/response schemas
│   │   ├── services/          # Business logic — matching_engine, excel_parser,
│   │   │                      #   allocation_service, apartment_debt, vendor_classifier,
│   │   │                      #   report_pdf / report_docx, whatsapp / sms / email,
│   │   │                      #   special_charge_split, monthly_amount_import, …
│   │   ├── dependencies/      # JWT guards + RBAC helpers
│   │   ├── utils/             # Shared utilities
│   │   ├── database.py        # SQLAlchemy engine + session
│   │   └── main.py            # App factory, CORS, security headers
│   ├── alembic/               # Database migrations
│   ├── scripts/               # One-off scripts (create_manager, backfills, preflight)
│   ├── tests/                 # pytest suite
│   ├── Procfile               # Railway deployment
│   ├── runtime.txt            # Python 3.11
│   └── requirements.txt
│
└── frontend/
    ├── src/
    │   ├── pages/             # Route-level pages
    │   ├── components/        # layout/, modals/, building/, transactions/, ui/, charts/
    │   ├── context/           # AuthContext, ConfigContext
    │   ├── hooks/             # Custom hooks
    │   ├── services/          # api.ts — central typed fetch client
    │   ├── types/             # Shared TypeScript interfaces
    │   ├── lib/               # cn(), buildingStatus, helpers
    │   └── i18n/              # he/en translations
    └── vercel.json            # SPA routing for Vercel
```

---

## Workflow

```
1. Create Building        → Buildings page
2. Import Tenants         → Tenants page → Excel import
3. Import Monthly Amounts → from the building's tenants Excel (expected payments)
4. Upload Bank Statement  → Statements page → drag-and-drop Excel
5. Review Matches         → Auto-matched by fuzzy engine; manual match / split / ignore
6. Track Expenses         → Categorize non-payment transactions; add special charges
7. View Dashboard         → Payment status, debts, and analytics per period
8. Send Reminders         → WhatsApp / SMS / email to unpaid tenants
9. Export Reports         → Building or tenant report as PDF / DOCX
10. Manage Users          → /users (Manager only) — invite, approve, change roles
```

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `users` | Auth: email, hashed_password, role, status, building_id |
| `buildings` | Building info (name, address, bank account, expected monthly payment) |
| `apartments` | Units within a building (weight, expected payment, standing order) |
| `tenants` | Tenant details, ownership type, phone, bank fields, move-in dates |
| `bank_statements` | Uploaded statement files (period, building) |
| `transactions` | Individual rows parsed from statements |
| `transaction_allocations` | Splits of a transaction to tenants (payments) or expense labels |
| `name_mappings` | Learned match memory (payer name → tenant) |
| `apartment_period_debt` | Per-apartment, per-period expected/paid debt records |
| `expense_categories` | Per-building user-defined expense categories |
| `vendor_mappings` | Learned vendor → category classification |
| `special_charges` | One-off charges split across apartments |
| `messages` | Reminder history + delivery status (WhatsApp / SMS / email) |
| `app_config` | App-wide configuration (e.g. risk thresholds) |

---

## Fuzzy Matching Engine

The engine uses 5 strategies to match Hebrew bank-statement names to tenants:

1. Exact match — direct string comparison after normalization
2. Reversed name — handles "first last" vs "last first"
3. Fuzzy match — Levenshtein distance via RapidFuzz
4. Token match — word-level matching for abbreviations (e.g. "גיא מ" → "גיא מן")
5. Amount match — cross-validates with expected monthly payment

Hebrew normalization: final letters are collapsed (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ).

Auto-confirm at ≥90% confidence. Below 70% → unmatched (manual review).

---

## Reminders & Messaging

Three delivery channels, each with customizable per-language templates (Settings → WhatsApp Templates):

- WhatsApp — `wa.me` links, no API key required
- SMS — short message with opt-out line
- Email — branded HTML with RTL support

Template types: Payment Reminder, Payment Received, Partial Payment, Overpayment.

Available variables: `{tenant_name}`, `{building_name}`, `{apartment_number}`, `{amount}`, `{period}`.

---

## Reports

- Building report and per-tenant report
- Export as PDF or DOCX, formatted for Hebrew RTL
- Available from the building view (export dialog) and the tenant report panel

---

## Security

- JWT access tokens (30 min) + refresh tokens (30-day sliding window)
- bcrypt password hashing
- RBAC on every endpoint
- CORS restricted to `FRONTEND_URL` env var
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
- File upload validation: Excel only, max 10 MB
- Rate limiting on login + upload endpoints
- API docs disabled in production (`APP_ENV=production`)

---

## Environment Variables

### Backend `backend/.env`

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
APP_SECRET_KEY=<run: openssl rand -hex 32>
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30
FRONTEND_URL=https://your-app.vercel.app
APP_ENV=production           # disables /docs in prod
```

### Frontend `frontend/.env`

```env
VITE_API_URL=https://your-backend.railway.app
```

---

## Production Deployment

### Frontend → Vercel

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → import repo
3. Set **Root Directory** to `frontend`
4. Add env var: `VITE_API_URL=https://your-backend.railway.app`
5. Deploy — Vercel auto-builds on every push to `master`

> `frontend/vercel.json` handles SPA routing (all paths → `/index.html`)

### Backend → Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Set **Root Directory** to `backend`
3. Add environment variables (see above)
4. Railway reads `Procfile` → `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Seed first manager: open Railway shell → `python3 scripts/create_manager.py --email ... --password ...`

### Making Changes After Deploy

```bash
# 1. Make changes locally, test them
npm run build          # check TypeScript
pytest                 # check backend

# 2. Commit
git add .
git commit -m "feat: describe what you changed"

# 3. Push → Vercel + Railway redeploy automatically
git push origin master
```

---

## Testing

```bash
# Backend
cd backend
pytest

# Frontend type-check
cd frontend
npm run build
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.11, FastAPI 0.115, SQLAlchemy 2.0 (sync), Alembic |
| Auth | python-jose (JWT), passlib (bcrypt) |
| Matching | RapidFuzz, Pandas |
| Reports | WeasyPrint (PDF), python-docx (DOCX) |
| Database | PostgreSQL via Supabase |
| Frontend | React 19, TypeScript 5, Vite 7 |
| State | TanStack Query v5 |
| Routing | React Router v7 |
| Styling | Tailwind CSS v3 |
| Charts | Recharts |
| i18n | i18next |

---

## GitHub Repo

[https://github.com/itayfre/LeadPay---Public](https://github.com/itayfre/LeadPay---Public)

---

## License

Proprietary — © 2026 Itay Frenkel. All rights reserved. See [LICENSE](LICENSE).
This software may not be used, copied, or distributed without express written permission.

---

*Built with [Claude Code](https://claude.ai/claude-code) — Anthropic*
