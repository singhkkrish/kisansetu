-- Procurement entries, audit trail, payment runs and sync log.

-- Slip numbers are allocated to each device in blocks while it is online, so
-- that an offline phone can keep issuing unique slip numbers.
create table public.slip_counters (
  centre_id uuid primary key references public.centres (id),
  last_no integer not null default 0
);

create table public.slip_blocks (
  id uuid primary key default gen_random_uuid(),
  centre_id uuid not null references public.centres (id),
  device_id text not null,
  start_no integer not null,
  end_no integer not null check (end_no >= start_no),
  allocated_by uuid references public.profiles (id),
  allocated_at timestamptz not null default now()
);

create table public.procurement_entries (
  id uuid primary key default gen_random_uuid(),
  -- Generated on the phone. The unique constraint makes retried syncs safe.
  client_id uuid not null unique,
  slip_no text not null unique check (slip_no ~ '^C[0-9]{2}-[0-9]{5,}$'),
  farmer_id uuid not null references public.farmer_members (id),
  centre_id uuid not null references public.centres (id),
  operator_id uuid not null references public.profiles (id),
  crop public.crop_type not null,
  grade public.grade_type not null,

  gross_kg numeric(10, 1) not null check (gross_kg > 0),
  tare_kg numeric(10, 1) not null check (tare_kg >= 0),
  moisture_pct numeric(4, 1) not null check (moisture_pct >= 0 and moisture_pct <= 40),
  net_kg numeric(10, 1) not null check (net_kg > 0),
  rate_per_quintal numeric(10, 2) not null check (rate_per_quintal > 0),
  amount numeric(14, 2) not null check (amount > 0),

  device_id text not null,
  device_recorded_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  -- Hash chain: payload_hash covers this entry, prev_hash points at the
  -- previous entry from the same device. Gaps or edits break the chain.
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  prev_hash text check (prev_hash is null or prev_hash ~ '^[0-9a-f]{64}$'),

  sync_status public.sync_status not null default 'synced',
  approval_status public.approval_status not null default 'approved',
  payment_status public.payment_status not null default 'unpaid',
  flag_reasons text[] not null default '{}',

  scale_photo_path text,
  meter_photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tare_below_gross check (tare_kg < gross_kg),
  -- The same rule table the app uses: net weight drops 1% per moisture point
  -- above 12. Enforced here so that no client can store a mismatched amount.
  constraint net_matches_rule check (
    net_kg = round((gross_kg - tare_kg) * (1 - greatest(moisture_pct - 12, 0) / 100), 1)
  ),
  constraint amount_matches_rate check (
    amount = round(net_kg * rate_per_quintal / 100, 2)
  ),
  constraint held_has_reason check (approval_status <> 'held' or cardinality(flag_reasons) > 0)
);

create index procurement_entries_centre_date_idx
  on public.procurement_entries (centre_id, device_recorded_at desc);
create index procurement_entries_farmer_idx
  on public.procurement_entries (farmer_id, device_recorded_at desc);
create index procurement_entries_payable_idx
  on public.procurement_entries (payment_status, approval_status);

create trigger procurement_entries_touch_updated_at
  before update on public.procurement_entries
  for each row execute function public.touch_updated_at();

create table public.procurement_audit_logs (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.procurement_entries (id),
  actor_id uuid references public.profiles (id),
  action text not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create index procurement_audit_logs_entry_idx
  on public.procurement_audit_logs (entry_id, created_at);

create table public.payment_runs (
  id uuid primary key default gen_random_uuid(),
  run_no text not null unique,
  status public.payment_run_status not null default 'draft',
  created_by uuid not null references public.profiles (id),
  item_count integer not null default 0,
  total_amount numeric(14, 2) not null default 0,
  bank_file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payment_runs_touch_updated_at
  before update on public.payment_runs
  for each row execute function public.touch_updated_at();

create table public.payment_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payment_runs (id) on delete cascade,
  -- One entry can be paid once, so it can appear in at most one run.
  entry_id uuid not null unique references public.procurement_entries (id),
  farmer_id uuid not null references public.farmer_members (id),
  amount numeric(14, 2) not null check (amount > 0),
  status public.payment_item_status not null default 'queued',
  bank_reference text,
  failure_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index payment_items_run_idx on public.payment_items (run_id);

create table public.sync_events (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  operator_id uuid references public.profiles (id),
  client_id uuid,
  outcome public.sync_outcome not null,
  detail jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index sync_events_received_idx on public.sync_events (received_at desc);
create index sync_events_client_idx on public.sync_events (client_id);
