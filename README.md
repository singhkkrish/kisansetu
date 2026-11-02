# KisanSetu

Offline-first procurement and payment management for a farmer producer company.
Collection centres weigh produce, record it on a phone with or without network,
and farmers get a Marathi slip. The office sees every centre's purchases and
prepares bank payment files without retyping.

Built for a Farmer Producer Company in Latur, Maharashtra: about 6,200 members,
140 villages, 22 collection centres, soybean and tur.

## Status

This repository holds **Part 1: foundation**. See [What is done](#what-is-done)
and [What comes next](#what-comes-next).

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
| `SUPABASE_SERVICE_ROLE_KEY` | reserved | Server-only admin key. Not used yet; needed for user management and payment jobs in Part 2. Never expose it to the browser. |
| `NEXT_PUBLIC_APP_URL` | no | Public base URL, defaults to `http://localhost:3000` |
| `SYNC_MAX_FUTURE_SKEW_MINUTES` | no | How far ahead of the server a phone clock may be before an entry is held for review. Default `10`. |

No secrets belong in the repository. `.env.local` is git-ignored.

### Database

Migrations live in `supabase/migrations`, applied in filename order. With the
Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql   # optional sample data
```

Or paste each migration file, in order, into the Supabase SQL editor.

In Supabase, go to Authentication and **turn off public sign-ups**. Staff
accounts are created by an administrator.

### Creating the first users

1. In Supabase, Authentication, Users, add a user (email and password).
2. Give that user a profile. For an office manager:

   ```sql
   insert into public.profiles (id, full_name, role)
   values ('<auth user id>', 'Office Manager', 'office_manager');
   ```

3. For a centre operator, attach a centre:

   ```sql
   insert into public.profiles (id, full_name, role, centre_id)
   select '<auth user id>', 'Centre Operator', 'centre_operator', id
   from public.centres where code = 'C07';
   ```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |

## Project structure

```
src/
  app/
    (auth)/login/          Sign-in page
    (dashboard)/           Authenticated shell, dashboard, members
    api/sync/              Receives queued entries from phones
    api/slip-block/        Hands a phone a block of slip numbers
  components/
    ui/                    Button, Input, Label, Card, Notice
    layout/                Header, navigation, sign-out
    procurement/           Sync panel
    members/               Member table
  lib/
    calculations/          Net weight and amount rules, formatting
    validation/            Zod schemas
    offline/               Hash chain, queue, sync client
    db/                    Dexie (IndexedDB) schema
    services/              Sync service, Supabase repository, slip SMS
    supabase/              Browser, server and proxy clients
    i18n/                  Marathi and English strings
  hooks/                   Online status, live IndexedDB queries
  types/                   Shared domain types
  tests/                   Vitest suites
supabase/
  migrations/              Schema, constraints, row level security
  seed.sql                 Sample centres, members and prices
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

- A phone gets a block of slip numbers while online (`/api/slip-block`) and
  keeps issuing unique slips from it with no network.
- Each entry is saved to IndexedDB with a client-generated id, then queued.
- When the network returns, the queue is sent oldest first (`/api/sync`).
- The server treats a repeated client id as a duplicate, so a lost response can
  never create a second purchase.

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

## What is done

- Project setup and tooling
- Database schema, constraints, triggers and row level security
- Decimal-safe procurement calculations with tests
- Zod validation
- Offline store, slip number blocks, hash-chained queue and sync client
- Server sync service with duplicate prevention and anomaly flags
- Marathi SMS slip text
- Sign-in, dashboard (today's prices, sync status) and member list

## What comes next

- Member registry: add and edit members, bank verification
- Operator collection screens: one step per screen, large numerals, slip summary
- Daily price board: set and publish prices
- Payment run: grouping, bank bulk file, status per farmer
- Scale and moisture meter photo reading, anomaly review queue
- Service worker so the app shell itself loads with no network
- Stock, dispatch and weight-loss tracking
