# LeadPay — Features

What the app does today, grouped by area. Last updated 2026-10-02.
For setup, architecture and deployment see [README.md](README.md).

---

## Buildings

- **Portfolio page** — KPI strip across all buildings, compact building cards, risk filters.
- **Statement freshness** — each card shows when its last bank statement was uploaded; a
  banner lists buildings whose statements are out of date.
- **Building view** — three tabs:
  - **סיכום (summary)** — debtors table, insights, recent transactions, category budgets.
  - **גבייה (collection)** — the month-by-month collection matrix with the yearly total.
  - **הוצאות (expenses)** — categorized expenses and special charges.
- Create, edit and delete buildings; building names are unique. Bank details per building
  feed the "payment details" WhatsApp reply.

## Tenants and apartments

- **Excel import** — handles blank floors and "בעל דירה" rows; creates missing apartments.
- **One active payer per apartment** — at import the app picks renter > owner > landlord and
  shows a review card when it has to choose; any tenant can be made the active payer.
- Ownership types: owner (בעלים), landlord (משכיר), renter (שוכר); an apartment can hold several.
- **Committee members (ועד בית)** — mark and filter; the committee report can be sent to them.
- Move-in dates, standing orders with their charge day, archive and restore.
- Phone numbers normalized to `+972`.
- All-tenants page across buildings, with no row cap.

## Bank statements and matching

- **Supported banks** — Leumi, Hapoalim, FIBI, Yahav (XLS) and Mizrahi-Tefahot (XLSX).
- **De-duplication** that never drops a real transaction (bank reference numbers are not unique).
- **Fuzzy Hebrew matching** — 5 strategies, learned payer-name memory, auto-confirm at ≥90%.
- **Statement review screen** — one table per statement with filters and stats, who settled
  each row, match / unmatch / ignore / un-ignore, and a "reviewed" stamp.
- Bank rows can be **deleted but never edited**. Free-text search covers tenant, allocations
  and building.
- Recent-uploads list.

## Debt ledger and payments

- **One per-apartment ledger** (`services/apartment_debt.py`) behind every debt number:
  screens, reminders, reports and the buildings page all read it.
- A month is owed from the **11th** (paying on the 10th is on time). Months not yet due are
  shown greyed with their fee, never as debt.
- Debt belongs to the **apartment** — payments from any of its tenant records count.
- **Credit (זכות)** is its own number; **paid ahead** is shown separately.
- Every debt number is **as of today**, whatever period a screen shows.
- **Split suggestions** — for a multi-month payment the app proposes a split over the oldest
  open months and due special charges. Nothing is written until you accept. "Split all" for a
  whole statement.
- **"פרוס" (spread)** — an excess month in payment history opens the allocation drawer pre-filled.
- **Darimpo lump transfers** — upload the deposits report (דוח הפקדות) to split one transfer
  per apartment; de-duplicated by payment confirmation id.
- **Standing orders** — reminders skip months the bank file cannot show yet.
- Payment history with a debt-vs-credit summary and a tenant contact card.
- Manual payments.

## Expenses

- Per-building expense categories with **monthly budgets**.
- Automatic vendor classification with learned vendor mappings.
- Categorize, bulk-categorize and split expense rows.
- **Record-only** one-time expenses that charge no tenant.
- **Special charges** — one-off charges split across apartments by weight or evenly.
- Non-tenant income is not counted as an expense.

## Messages (`/messages`)

Everything the app says to a tenant goes out from here, and everything they say back arrives
here: payment reminders, periodic reports, building welcome messages and announcements.

- **סקירה (overview)** — every channel over a send-date range; message and distinct-tenant
  counts; a delivery funnel for WhatsApp.
- **שיחות (conversations)** — threads with in-app replies, quick replies and image attachments.
- **תבניות (templates)** — template board and conversation tree, editable follow-up text,
  operator-written custom templates, submission to Meta, monthly quota counter.
- **חסומים (blocked)** — opted-out and paused tenants, error reports.
- **דוחות (reports)** — past report batches.
- **הגדרות (settings)** — representative phone, auto-reply on/off, escalation alerts, early-month
  reminders.

### Sending
- Send from the page header or from a building. Filter by building, ownership type and debt.
- Reminders go to the apartment's active payer; `{period}` names the months actually unpaid.
- Warning when one phone would receive the same message twice.
- **Welcome / announcement messages** for a building, including entering a missing Darimpo
  key without leaving the send window.
- No emoji in anything sent to a tenant.

### WhatsApp Cloud API
- Automated sends with Meta-approved templates; sends are blocked while a template is pending.
- **Escalating interactive reminders** with buttons — "payment details" (uses the building's
  bank details) and "talk to a representative".
- **Webhook** for delivery and read receipts and inbound messages, verified by Meta signature.
- **Auto-reply** waits until the sender stops typing for 60 seconds; button taps answer at once.
- A reply from the page takes the thread over from the bot for a day.
- **Opt-out keywords** (e.g. "הסר"), unknown-sender replies, emoji reactions counted as answers.

### Other channels
- WhatsApp link (`wa.me`) — manual send.
- Email (Resend) and SMS (Inforu) — clients built; stub mode until credentials are set.

## Reports

- Document kinds: **tenant**, **building**, **building — resident view** (never shows other
  residents' names) and **combined**.
- PDF and DOCX, Hebrew RTL, LEAD logo and palette.
- Reports read the ledger: "חוב נכון ל-DD/MM/YYYY", with any shortfall shown in red.
- **Report batches** — pick a quarter, freeze the data, review warnings, then send by WhatsApp
  (document or link) or download all as a zip. Batches are kept 180 days.
- **Public resident link** — no login, valid 30 days, revocable.

## Users, auth and legal

- JWT login with refresh tokens; roles Manager, Worker, Viewer, Tenant.
- Email invites, tenant self-registration with manager approval, `/setup` for the first manager.
- Edit controls hidden from Viewer and Tenant.
- Public accessibility statement (IS 5568) and privacy policy pages.

## Infrastructure

- Production on Vercel (frontend) + Railway (backend + Postgres); deploys from `master`.
- Production database moved from Supabase to Railway Postgres on 2026-07-30.
- Tests run on local Postgres, one throwaway database per run; ~1,200 backend tests in a few
  seconds. A guard refuses to run against production and strips messaging credentials.
- WeasyPrint system libraries installed on Railway via `nixpacks.toml`.

---

## Timeline (2026)

| When | What shipped |
|------|--------------|
| Jun | Active payer per apartment, upload de-dup fix, role-based UI hiding, LEAD-branded reports |
| Jul | Yahav + Mizrahi-Tefahot parsers, Darimpo split, record-only expenses, WhatsApp Cloud API, privacy page, Railway Postgres |
| Aug | Payments follow the apartment, interactive reminders, webhook + inbound replies, opt-out, auto-reply, local test database |
| Sep | Messages page, report batches + public links, committee members, statement review screen, expense splits, buildings page redesign, one debt ledger, split suggestions, building summary tab, category budgets |
| Oct | Standing-order charge day, delete-only bank rows |
