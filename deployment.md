# KisanSetu — deployment and setup guide

**Status of deployment.** KisanSetu has **not been deployed anywhere**. There is no live URL and no shared demo
server, so there are no hosted demo credentials. This guide shows how to run it locally and how to deploy your own copy.
No API keys or secrets are included in this file or in the repository.

## 1. Project overview

KisanSetu is an offline-first farmer procurement and payment platform for a Farmer Producer Company (Latur,
Maharashtra). Centre operators record purchases on a phone, with or without network. The app calculates net weight
and amount, produces a bilingual (Marathi/English) slip and queues an SMS. Entries synchronise when the phone is
online. An office manager publishes daily prices, reviews and approves purchases, generates payment runs, downloads a
**mock** bank CSV and **simulates** bank responses. Part 6 adds optional AI reading of scale and moisture-meter photos
(always confirmed by a person) and rule-based anomaly flags that hold payment until a manager reviews them.

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Supabase (PostgreSQL, Auth, row level security),
Dexie (browser IndexedDB), Zod, decimal.js, Vitest. See `README.md` for the architecture notes and
`docs/testing.md` for the testing guide.

## 2. Prerequisites

- Node.js 22 and npm.
- A free Supabase account and a new, empty Supabase project.
- Optional: the Supabase CLI (`npm i -g supabase` or see Supabase docs) and `psql`. You can use the dashboard SQL editor instead.
- Optional, for AI reading: an Anthropic API key from the Anthropic Console (billing applies to your account).
- Chrome or Edge on a phone or desktop for the operator screens.

## 3. Installation

```bash
git clone <your repository URL> kisansetu
cd kisansetu
npm install
cp .env.example .env.local     # then fill in the values, see section 6
```

## 4. Supabase setup

1. Create a project at supabase.com. Note the project URL, the `anon` public key and the `service_role` key
   (Project Settings → API). Keep the service-role key private.
2. Authentication → Providers → Email: keep enabled; **turn off "Allow new users to sign up"**. Staff accounts are
   created by an administrator only.
3. Apply the database migrations and the seed data (section 5).

## 5. Database migrations

The ten files in `supabase/migrations` must be applied in filename order. Either:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

or paste each file, in order, into the Supabase SQL editor
(`20261102000001_…` through `20261109000010_…`).

Seed data (all fictional — centres, 37 sample farmers with synthetic phone numbers, today's prices):

```bash
psql "$DATABASE_URL" -f supabase/seed.sql
```

Optional extra demo data, **after** the demo users exist (section 7):

```bash
psql "$DATABASE_URL" -f supabase/seed_procurement.sql   # three sample slips
psql "$DATABASE_URL" -f supabase/seed_stock.sql         # ~20 purchases for payment and stock demos
```

`DATABASE_URL` is the connection string from Supabase (Project Settings → Database). Never commit it.

## 6. Environment variables

Set these in `.env.local` for local work, and in your hosting provider's settings for a deployment. Names only:

| Name | Required | Where it may be used |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | browser and server (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | browser and server (public, protected by row level security) |
| `SUPABASE_SERVICE_ROLE_KEY` | only to create users | **your own machine only**; never in hosting settings, never in the browser |
| `NEXT_PUBLIC_APP_URL` | recommended | public base URL of the app |
| `SYNC_MAX_FUTURE_SKEW_MINUTES` | no (default 10) | server |
| `ANTHROPIC_API_KEY` | no (feature off without it) | **server only**; never prefix with `NEXT_PUBLIC_` |
| `ANTHROPIC_MODEL` | no (default `claude-sonnet-5-5`) | server |
| `ANTHROPIC_TIMEOUT_MS` | no (default 20000) | server |
| `BANK_FILE_COLUMNS`, `BANK_FILE_DELIMITER`, `BANK_FILE_HEADER` | no | server (mock bank file layout) |
| `DEMO_PASSWORD` | only for `npm run demo:users` | a one-off shell variable, not stored |

## 7. Local development and demo logins

```bash
npm run dev          # http://localhost:3000
npm run typecheck && npm run lint && npm test
```

**Demo logins.** They are created in *your* Supabase project by a script, with a password you choose at that moment.
No password is stored in the repository and none is shared.

```bash
DEMO_PASSWORD='pick-a-password-of-10-or-more-characters' npm run demo:users
```

| Role | Email | Centre |
| --- | --- | --- |
| Office manager | `manager@kisansetu.demo` | none |
| Centre operator | `operator.c07@kisansetu.demo` | C07 Ganjur |
| Centre operator | `operator.c12@kisansetu.demo` | C12 Murud |

The password is the `DEMO_PASSWORD` you typed. Delete these users (Supabase → Authentication) before any real use.
For real staff use `npm run staff:create` (see `README.md`). Use only fictional farmer data in a demo.

## 8. Deploying your own copy

Any Node host that runs Next.js works. For Vercel (example):

1. Push the repository to your own GitHub account and import it in Vercel.
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` and, if wanted,
   `ANTHROPIC_API_KEY` as environment variables. **Do not** add `SUPABASE_SERVICE_ROLE_KEY`.
3. Build command `npm run build`, start `npm start`. The app must be served over HTTPS (service worker, camera and
   secure cookies need it).
4. In Supabase, Authentication → URL configuration, add your site URL.
5. Sign in on the deployed site with a demo user and run section 9 checks.

Known gaps before real use: no Content-Security-Policy header, an in-memory AI rate limiter (per server process), a
mock SMS provider and a mock bank file. See the Technical Design Document, "Limitations".

## 9. How to test

### Offline mode
1. Sign in as `operator.c07@kisansetu.demo` in Chrome. Wait until the bar says data is updated.
2. DevTools → Network → set **Offline**. The bar turns amber and says offline.
3. Open *Collect*, search a farmer, choose crop, enter gross, tare and moisture, choose grade, save.
   You get the net weight, amount and a slip number, a bilingual slip and a queued SMS; the status reads "send pending".
4. Set the network back to **No throttling**. The entry syncs and shows *Synced*.
5. Sign in as the manager: the entry appears under *Entries* with the operator's centre.

### AI functionality
1. Put `ANTHROPIC_API_KEY` in `.env.local`, restart `npm run dev`.
2. As an operator, in the weight or moisture step press *Read from a photo* and choose a photo of a display.
3. The photo appears beside the AI value; the field stays empty until you press *Use this value*. Try
   *type the value myself* (a different number needs a ticked box), *Reject*, *Upload another photo*.
4. Try a blurry photo, a non-display photo, a PDF and a very large file: each gives a message and fills nothing.
5. Remove the key to see "not switched on here". More cases and a `curl` example: `docs/ai-reading.md`.

### Mock payments
1. As the manager, *Prices*: publish today's prices (changing an existing rate asks for a reason).
2. *Entries*: approve or review held entries. An entry with an open anomaly cannot be approved until its anomaly is
   reviewed under *Flagged entries*.
3. *Payments → New payment run*: pick dates and centres, preview (one row per farmer, account masked to the last four
   digits), generate. Generating the same selection again produces nothing.
4. Open the run, tick the confirmation, **Approve**; then **Download bank file (mock CSV)**.
5. Use *Simulated bank response* to mark payments paid or failed (failure needs a reason). Paid entries show *Paid* on
   the slip; a failed payment stays listed until returned to unpaid. No real bank or money is involved.
