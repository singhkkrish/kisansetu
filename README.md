# KisanSetu

Offline-first procurement and payment management for a farmer producer company.
Collection centres weigh produce, record it on a phone with or without network,
and farmers get a Marathi slip. The office sees every centre's purchases and
prepares bank payment files without retyping.

Built for a Farmer Producer Company in Latur, Maharashtra: about 6,200 members,
140 villages, 22 collection centres, soybean and tur.

## Status

This repository holds **Parts 1 to 3**: the foundation, sign-in with roles and
the farmer registry, and the offline-first procurement entry engine. See
[What is done](#what-is-done) and [What comes next](#what-comes-next).

## Stack

| Area | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), TypeScript |
| UI | Tailwind CSS 4, shadcn/ui-style components, Lucide icons |
| Database and auth | Supabase PostgreSQL and Supabase Auth |
| Offline storage | Dexie.js over IndexedDB |
| Validation | Zod |
| Money and weights | decimal.js (never floating point) |
| Tests | Vitest |

## Getting started

Requirements: Node.js 20.19 or newer (22 recommended), npm, and a Supabase project.

```bash
npm install
cp .env.example .env.local     # then fill in the values below
npm run dev                    # http://localhost:3000
```

### Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | only for `staff:create` | Server-only admin key used by `npm run staff:create` on a trusted machine. Never put it in the app's hosting environment or expose it to the browser. |
| `NEXT_PUBLIC_APP_URL` | no | Public base URL, defaults to `http://localhost:3000` |
| `SYNC_MAX_FUTURE_SKEW_MINUTES` | no | How far ahead of the server a phone clock may be before an entry is held for review. Default `10`. |

No secrets belong in the repository. `.env.local` is git-ignored.

### Database

Migrations live in `supabase/migrations`, applied in filename order (there are six):

```bash
supabase link --project-ref <your-project-ref>
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql              # centres, 37 sample farmers, today's prices
```

Or paste each migration file, in order, into the Supabase SQL editor.

In Supabase, go to Authentication and **turn off public sign-ups**. Staff
accounts are created by an administrator.

### Creating staff logins

Run this on a trusted machine, with `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`:

```bash
npm run staff:create -- --email manager@yourcompany.example --name "Office Manager" --role office_manager
npm run staff:create -- --email op07@yourcompany.example --name "Ganjur Operator" --role centre_operator --centre C07
npm run staff:create -- --email op12@yourcompany.example --name "Murud Operator" --role centre_operator --centre C12
```

A random password is printed once (or set `STAFF_PASSWORD`).

### Sample procurement slips (optional)

After `seed.sql` and after creating operators for centres C07 and C12, load the
three sample slips from the brief:

```bash
psql "$DATABASE_URL" -f supabase/seed_procurement.sql
```

It is safe to run twice. A slip is skipped, with a notice, when its centre has no
operator yet. The slips carry valid hash chains, so they look like entries that
arrived from a phone.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (the service worker is off in development) |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit and database tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run staff:create` | Create a staff login (see above) |

## Project structure

```
src/
  app/
    (auth)/login/          Sign-in page
    (dashboard)/           Dashboard, collect (wizard), procurement list and detail, members
    api/sync/              Receives queued entries, replies with the server clock
    api/slip-block/        Hands a phone a block of slip numbers
    api/offline/bootstrap/ Farmers (no bank data) and recent rates for offline use
    api/procurement/[id]/review/   Manager approve / hold / reject
    api/members/           Farmer registry API
  components/
    offline/               OfflineProvider (download, slips, auto-sync, backoff), sync status
    procurement/           Wizard, number field, local entries list, review form
    members/               Registry table, filters, form
    ui/, layout/           Shared pieces
  lib/
    calculations/          Net weight and amount rules, formatting
    validation/            Zod schemas
    offline/               Queue, sync client, hash chain, clock offset, cached reference data
    procurement/           Wizard input rules
    db/                    Dexie (IndexedDB) schema
    services/              Sync service, Supabase repositories, entry views
    auth/                  Permission matrix, API and page guards
    i18n/                  Marathi and English strings
  tests/                   Vitest suites (including database tests in an in-memory Postgres)
public/sw.js               Service worker: the app opens with no network
supabase/
  migrations/              Schema, constraints, row level security, procurement rules
  seed.sql                 Sample centres, farmers and prices
  seed_procurement.sql     The three sample slips
```

## How it works

### Calculations

Net weight is gross minus tare, reduced by 1% for every moisture point above
12% (fractions count pro rata). Net weight rounds half up to one decimal; the
amount is net weight times the rate per quintal, rounded half up to the paisa.
All arithmetic uses decimals and results travel as strings.

| Slip | Gross | Tare | Moisture | Net | Rate | Amount |
| --- | --- | --- | --- | --- | --- | --- |
| C07-24518 | 1250.0 | 18.0 | 11.5% | 1232.0 | 4850 | 59,752.00 |
| C07-24519 | 860.0 | 12.0 | 14.0% | 831.0 | 4850 | 40,303.50 |
| C12-08876 | 640.0 | 10.0 | 10.0% | 630.0 | 7200 | 45,360.00 |

The same rule is a `CHECK` constraint in PostgreSQL, so the database refuses a
row whose net weight or amount does not follow it.

### Offline entries

- While online, the app downloads the active farmers (no bank details) and the
  recent daily rates into IndexedDB (Dexie), and a block of slip numbers for
  the operator's centre. It refreshes these when they are older than 6 hours.
- With no network the operator can still open the app, search the downloaded
  farmers, see the cached rate, and save entries. Each entry gets a unique slip
  number and an idempotency key (`clientId`) made when the wizard starts, so
  tapping Save twice, or a reload, can only ever store one purchase.
- Entries are `pending` until the **server's reply** says otherwise. Nothing is
  shown as synced because a request was sent or the browser reports "online".
- Sync sends the queue oldest first, one tab at a time (a Web Lock). A failure
  keeps the entry pending with the reason, and the next automatic try waits
  longer each time (2 s, 4 s, 8 s ... up to 5 minutes). Entries the server
  rejects show as failed, with a **Retry failed entries** button.
- If the server stores an entry but the reply is lost, the retry is recognised
  by its `clientId` and answered as a duplicate. One purchase, never two.

### The phone's clock is not trusted

- `deviceRecordedAt` is kept exactly as the phone reported it and is labelled
  "unverified" everywhere it is shown.
- Every time the server answers, the phone records how far its clock was from
  the server's. That offset travels with the entry (inside its hash) and is used
  to pick the right day's rate. A large offset, or a clock running ahead, holds
  the entry for review.
- `server_received_at` is set by a database trigger when the row is inserted.
  A client cannot supply it, and a later update cannot change it.
- The same trigger decides approval status and flags (`rate_mismatch`,
  `no_price_for_day`, `clock_ahead`, `clock_skew`, `chain_gap`), so even a direct
  API call cannot insert an entry as already approved.

### Audit trail and approvals

- Every entry has an audit log: who created it, which centre, the phone's time,
  the server's time, its sync status, and every later change to approval or
  payment state (who, when, from what, to what, and why).
- Purchase facts (weights, rate, amount, slip, farmer, both timestamps) are
  immutable in the database. Operators cannot update entries at all.
- Only office managers can change approval, through `review_entry`, which needs a
  written reason to hold or reject and refuses once an entry is in a payment run.

### Tamper evidence

Each entry's SHA-256 hash covers its purchase facts and the previous entry's
hash from the same device, forming a chain. The server recomputes every hash,
rejects entries that do not match, and flags broken chains, rates that differ
from the published price board, and phone clocks running ahead of the server.
Flagged entries are held for manager review. They are never cancelled.

This makes tampering detectable. It does not stop someone who controls a whole
device from rewriting an entire chain, which is why the server also records its
own receive time and why saved purchase facts are immutable in the database.

### Data protection

- No Aadhaar numbers are stored anywhere.
- Bank details are in a separate table readable only by office managers.
- Members have a recorded consent timestamp, in line with the DPDP Act 2023.
- Row level security limits operators to their own centre.

## Testing the offline workflow in Chrome DevTools

Use a **production build**, because the service worker (which lets the app open
with no network) is only registered in production:

```bash
npm run build && npm start        # http://localhost:3000
```

1. Sign in as a **centre operator** (for example the C07 login). Open the
   Dashboard and wait a few seconds. Under **Sync status**, *Farmers on this
   phone* should become a number above zero. Visit **Collect** and **Entries**
   once as well.
2. Open DevTools (F12). Application, Service workers: `sw.js` should be
   *activated and running*. Application, IndexedDB, `kisansetu`: you will see
   `members`, `prices`, `entries` and `meta`. Application, Cache storage has
   `ks-static-v1` and `ks-pages-v1`.
3. Go offline: Network tab, change *No throttling* to **Offline**. The status
   bar changes to **Offline**.
4. Reload the page. It still opens (served from the saved copy).
5. Open **Collect** and record an entry: search a farmer by name or ID, choose
   Soybean, gross `1250`, tare `18`, moisture `11.5`, grade A. The preview shows
   `1,232.0 kg` and `₹59,752.00`. Save. The screen shows the slip number and
   **Waiting to send**. Press **New entry** and record another.
6. In IndexedDB, `entries`, each row has `syncStatus: "pending"`, its
   `clientId` (the idempotency key) and `deviceRecordedAt`. Reload the page: the
   entries are still there.
7. Go back online (Network, *No throttling*). Within about 30 seconds (or press
   **Sync now**) the entries change to **Synced**, each with a *Received by
   server* time that differs from the phone's time. In `entries`, rows now have
   `serverReceivedAt`. Entries tab shows the same.
8. **Lost reply (duplicate check).** Record an entry while online and, in the
   Network tab, block the request URL `*/api/sync` the moment you tap Save, then
   switch to Offline while the request is still pending. The server may store
   the entry but the phone never hears back, so it keeps showing **Waiting to
   send**. Go online and sync: the server answers "duplicate", the entry turns
   **Synced**, and the server still holds exactly one row.
9. **Failure and retry.** Block `/api/sync` (right-click the request, *Block
   request URL*) and press **Sync now**. The entry stays pending and the panel
   says the last attempt failed and will retry. Unblock it and sync. A server
   rejection shows under **Failed** with a **Retry failed entries** button.
10. **Wrong phone date.** Set the computer's clock a day ahead and open Collect.
    The wizard finds no published rate for that date and refuses to save
    ("No rate for today"), so a wrong date cannot silently price a purchase. An
    entry whose recorded time is ahead of the server's clock arrives *held for
    review*, and the server's own receive time is always the true one.

Sign-out removes the downloaded farmer list and cached pages from the phone but
keeps any entries that have not synced yet.

## Part 4: price board, slips and SMS

Apply `supabase/migrations/20261104000007_price_board_and_sms.sql` after the earlier
migrations. Optional environment variables for the mock SMS service:
`SMS_MOCK_RECEIPT_DELAY_MS` (default 2000) and `SMS_ALLOW_SIMULATION`
(allows the "simulate failed delivery" testing option).

Manual testing:

1. Sign in as an office manager and open **Prices**. Choose a date from today to
   14 days ahead, type rates for Soybean and Tur grades, press **Save drafts**.
   Drafts are invisible to operators.
2. Press **Review and publish**, tick the confirmation box and publish. The slot
   shows a locked "Published" state with version, who and when.
3. Type a different rate for a published slot. A reason is required; publishing it
   creates version 2 and marks version 1 superseded. Open **Price history** to see
   both versions and the audit trail.
4. As a centre operator, open the dashboard: the price card shows the effective
   date and sync state. Go offline (DevTools, Network, Offline) and record an entry;
   it uses the cached price and stores a snapshot of it.
5. Publish a new price as the manager, sync the operator phone, then start another
   entry: a "new price available" notice appears but an entry already in progress
   keeps its snapshot until the operator chooses to use the new price.
6. After saving an entry, check the slip (Marathi and English), print it, then
   preview and send the SMS. Offline it is queued and shows "not sent yet";
   after sync it moves to Sent, then Delivered only when the mock confirms it.
   Tick "simulate failed delivery" to see a failure and use **Send again**.
7. As the manager, open an entry under **Procurement** to see the slip and the
   recorded SMS (masked number, message, status, time).

## What is done

- Project setup and tooling
- Database schema, constraints, triggers and row level security
- Decimal-safe procurement calculations with tests
- Sign-in, two roles (centre operator, office manager) and a permission matrix
  enforced in pages, API routes and the database
- Farmer registry: search, filters, add, edit, details, masked bank accounts
- Offline procurement wizard (seven steps, large numeric inputs, Marathi and English)
- Dexie store of farmers and rates, offline search, slip-number blocks, hash-chained queue
- Idempotent sync with retry and backoff, server timestamps, clock-offset handling
- Sync status panel: online, pending, synced, failed, last successful sync, retry
- Audit trail, immutable purchase facts, manager review of held entries
- Service worker so the app opens with no network
- Marathi SMS slip text
- Daily price board: versioned prices, publish confirmation, history with audit trail
- Rate snapshot stored on every procurement entry; later prices never change it
- Bilingual (Marathi + English) digital slip, printable
- Mock SMS service with preview, offline queue and honest delivery status

## What comes next

- Payment run: grouping, bank bulk file, status per farmer
- Scale and moisture meter photo reading, anomaly review queue
- Stock, dispatch and weight-loss tracking
