# KisanSetu testing guide

All figures below are from a real run on 9 November 2026 in the development sandbox
(Node 22, Vitest, in-memory PostgreSQL via PGlite, headless Chromium). Nothing here was run against
a live Supabase project or a deployed site, because neither exists yet; see "What was not tested".

## 1. Commands and last results

| Command | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | exit 0, no errors |
| `npm run lint` (`eslint`) | exit 0, no warnings |
| `npm test` (`vitest run`) | **32 files, 762 tests, 762 passed, 0 failed, 0 skipped** (three consecutive full runs, all green) |
| `npm run build` (`next build`) | compiled successfully, 28 pages/routes generated (`next build`) |

Per file (tests): ai-reading 50, authorization 31, calculations 23, db-anomalies 33, db-payments 23, db-rls 76, db-security 5, db-security-audit 5, db-seed 4, display-reader 14, e2e-workflow 11, farmer-validation 55, integrity 15, member-filters 9, offline-engine 33, offline-queue 14, part4-engine 19, part6 36, payments-lib 23, payments-routes 46, permissions 38, price-board 26, route-coverage 64, slip 14, slip-message 3, slip-render 2, sms 32, source-security 5, stock 13, sync-service 16, validation 10, wizard 14.

## 2. Unit tests (no database, no network)

Pure logic: `calculations` (net weight, moisture deduction, amount with exact decimals), `validation`,
`farmer-validation`, `wizard`, `integrity` (hash chain, tamper detection, clock skew), `slip`, `sms`, `price-board`,
`payments-lib` (grouping, bank CSV, masking), `stock`, `permissions`, `part6` (operator decision rules, anomaly
explanations). Run one file: `npx vitest run src/tests/calculations.test.ts`.

## 3. Integration tests

- **Database** (`db-*.test.ts`): every SQL migration is applied to an in-memory PostgreSQL and the tests act as each
  role (`set role authenticated` with a chosen `auth.uid()`), so row level security, triggers and SECURITY DEFINER
  functions are exercised for real. Covers centre isolation, immutable purchase facts, audit logs, approval rules,
  payment-run locking and duplicate prevention, anomaly rules and holds, and schema-wide checks (RLS on every public
  table, fixed `search_path` on definer functions, anonymous role has no access).
- **Routes** (`authorization`, `payments-routes`, `ai-reading`, `part6`): route handlers are called with a fake
  Supabase client; the tests assert both the HTTP status and that a refused request never reaches the database.
- **Structure** (`route-coverage`, `source-security`): every API route checks the caller, every route that reads a body
  validates it, every signed-in page enforces a permission, no secret appears in client code.
- **End to end** (`e2e-workflow.test.ts`): the 19-step workflow from the brief in one ordered file. It uses the real
  migrations, the real offline store (Dexie on fake-indexeddb), the real queue, sync service, slip builder, SMS text,
  payment-run functions and bank-file builder. Steps: manager signs in, creates and verifies a farmer, publishes
  prices; operator signs in, downloads reference data (no bank data reaches the phone), goes offline, records two
  purchases (one with an AI-confirmed weight), slip and queued SMS are produced offline; operator reconnects and syncs;
  a lost reply is replayed and produces no duplicate; the manager sees one clean and one held entry, resolves the
  anomaly, approves; a payment run is generated, a second run is refused, the CSV is available only after approval,
  bank success is simulated, entries become Paid and settling twice is refused; the other centre's operator sees nothing.

Not covered by this file: the browser UI, Supabase Auth and the HTTP layer (see section 7).

## 4. Manual testing (needs a real Supabase project)

Follow [deployment.md](../deployment.md) to create the project, apply migrations and seeds and create the demo users.
Then use the checklists in the README: *Testing the offline workflow in Chrome DevTools*, *Manual testing checklist*
(Part 5, payments and stock) and *Manual testing checklist (Part 6)*. These checklists have **not** been run against a
live project by the author of the code; automated tests stand in for them where noted above.

## 5. Offline testing

Automated: `offline-engine`, `offline-queue`, `integrity`, `sync-service` and the e2e file (queue, slip-number blocks,
hash chain, idempotent sync, lost reply, clock skew, no bank data on device).

Manual (Chrome, signed in as an operator): open the app online and wait for "Data updated"; DevTools, Network, set
*Offline* (the bar turns amber and says offline); record a purchase (it saves, shows a slip and "waiting to send");
set *No throttling*; the entry syncs and shows *Synced*. Repeat with the tab closed and reopened while offline.

A headless-Chromium run of the real wizard (farmer search, crop, AI-assisted weight, manual moisture, review, save)
with the network switched off was done with the server calls stubbed; it showed the offline bar, saved the entry
locally and showed it as "send pending". That run used stubbed responses, not a Supabase server.

## 6. AI testing

Automated (`ai-reading.test.ts`, `display-reader.test.tsx`, `part6.test.ts`): the Anthropic call is replaced by a fake,
so these tests prove our handling, not the model's accuracy. They cover valid extraction, unit conversion, invalid and
unsupported images, size limits, low confidence and uncertain results (value removed), malformed model output, missing
value, timeout, API error, rate limiting, key never sent to or readable by the browser, prompt-injection text treated as
data, no farmer or payment fields in the provider request, no image stored, operator confirm / correct / reject /
re-upload, the explicit tick when the value differs, and that the AI path never approves anything.

Manual with your own key and photos: see [docs/ai-reading.md](ai-reading.md). **Model accuracy on real displays has not
been measured.**

## 7. Authentication and authorization testing

Automated: `authorization`, `permissions`, `db-rls`, `route-coverage`: signed-out requests get 401, wrong role 403,
operators cannot read other centres, cannot see bank details, anomaly flags or payment data, cannot call manager
functions, and database errors never reach the browser as raw text.

Manual: sign in as manager, operator C07, operator C12 (see deployment.md); try opening `/payments`, `/stock`,
`/anomalies` as an operator (redirects to the dashboard with a notice); try a C12 entry URL as the C07 operator (not found).
Supabase Auth itself (password storage, session cookies, token refresh) is the platform's and was not tested here.

## 8. Payment testing

Automated: `db-payments`, `payments-lib`, `payments-routes`, e2e: grouping per farmer with exact decimal totals,
unverified bank accounts blocked, held and anomaly-flagged entries excluded, duplicate generation refused, approval
required before the file, first download marks the run sent, failures need a reason, settled items cannot change, failed
items can be returned to unpaid, cancellation releases entries. The bank file is a **mock** CSV; no real bank is contacted.

Manual: the Part 5 checklist in the README.

## 9. Visual and responsive checks

Headless Chromium at 390 px (phone) and 1280 px (desktop) was used on the real components with fixture data (the
operator wizard in Marathi and English, the slip, anomaly card, payment items table, members table). No horizontal page
overflow was found at either size. Two defects were found this way and fixed: the slip's amount was clipped or wrapped
on narrow screens, and Marathi content was not marked with a `lang` attribute. Not done: other browsers, real phones,
screen readers.

## 10. What was not tested

- A live Supabase project (Auth, PostgREST, real RLS policies as served), and the deployed site: neither exists.
- The server-rendered manager pages in a browser (review queue, payments, stock): they need a live Supabase session.
- The real Anthropic model on real photos.
- Load, penetration testing, and multi-instance behaviour (the AI rate limiter is per process).
