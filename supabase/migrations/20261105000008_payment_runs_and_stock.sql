-- Payment runs, simulated bank responses, stock dispatch and stock reporting.
--
-- Design rules in this file:
--   * Nobody writes payment tables directly. Managers read them; every change goes
--     through a SECURITY DEFINER function that checks the role and the state.
--   * An entry can be in at most one active payment run. This is enforced three ways:
--     the function only picks 'unpaid' entries under a row lock, a trigger refuses
--     payment_status changes made outside these functions, and a partial unique
--     index refuses a second active link for the same entry.
--   * Bank details are copied into the payment item when the run is generated, so
--     editing a farmer's bank account later cannot redirect an approved run.

-- ---------------------------------------------------------------------------
-- 1. Payment status of an entry only changes through the payment functions.
-- ---------------------------------------------------------------------------
create or replace function public.guard_payment_status()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('kisansetu.payment_write', true), '') <> 'on'
     and (
       new.payment_status is distinct from old.payment_status
       or (new.approval_status is distinct from old.approval_status
           and old.payment_status in ('in_run', 'paid'))
     )
  then
    raise exception 'payment status only changes through the payment run workflow'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger procurement_entries_guard_payment
  before update on public.procurement_entries
  for each row execute function public.guard_payment_status();

create or replace function public.require_office_manager()
returns void
language plpgsql
stable
as $$
begin
  if app_role() is distinct from 'office_manager' then
    raise exception 'only office managers can do this' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Payment tables. The Part 1 placeholders were never written to, so they are
--    rebuilt with the shape the workflow needs (one item per farmer per run).
-- ---------------------------------------------------------------------------
drop table if exists public.payment_items;
drop table if exists public.payment_runs;
drop type if exists public.payment_item_status;
drop type if exists public.payment_run_status;

create type public.payment_run_status as enum ('draft', 'approved', 'file_generated', 'completed', 'cancelled');
create type public.payment_item_status as enum ('pending', 'processing', 'paid', 'failed');

create table public.payment_runs (
  id uuid primary key default gen_random_uuid(),
  run_no text not null unique check (run_no ~ '^PR-[0-9]{8}-[0-9]{3,}$'),
  status public.payment_run_status not null default 'draft',
  date_from date not null,
  date_to date not null,
  centre_ids uuid[] not null,
  item_count integer not null default 0,
  entry_count integer not null default 0,
  total_amount numeric(14, 2) not null default 0,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  bank_file_name text,
  file_generated_by uuid references public.profiles (id),
  file_generated_at timestamptz,
  cancelled_reason text,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint run_range_ok check (date_to >= date_from),
  constraint run_has_centres check (cardinality(centre_ids) > 0),
  constraint run_totals_ok check (item_count >= 0 and entry_count >= 0 and total_amount >= 0)
);

create trigger payment_runs_touch_updated_at
  before update on public.payment_runs
  for each row execute function public.touch_updated_at();

create table public.payment_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payment_runs (id),
  farmer_id uuid not null references public.farmer_members (id),
  -- Copied from the farmer registry when the run is generated.
  farmer_code text not null,
  farmer_name text not null,
  beneficiary_name text not null,
  account_number text not null check (account_number ~ '^[0-9]{9,18}$'),
  ifsc text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  entry_count integer not null check (entry_count > 0),
  amount numeric(14, 2) not null check (amount > 0),
  payment_ref text not null unique,
  status public.payment_item_status not null default 'pending',
  bank_reference text,
  failure_reason text,
  settled_at timestamptz,
  settled_by uuid references public.profiles (id),
  -- Set when the entries of a cancelled run, or of a failed payment, go back to unpaid.
  released_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, farmer_id),
  constraint paid_has_bank_reference check (status <> 'paid' or bank_reference is not null),
  constraint failed_has_reason check (status <> 'failed' or failure_reason is not null)
);

create index payment_items_run_idx on public.payment_items (run_id);

create table public.payment_run_entries (
  item_id uuid not null references public.payment_items (id),
  entry_id uuid not null references public.procurement_entries (id),
  amount numeric(14, 2) not null check (amount > 0),
  released_at timestamptz,
  primary key (item_id, entry_id)
);

-- The hard stop against paying an entry twice: one active link per entry.
create unique index payment_run_entries_one_active
  on public.payment_run_entries (entry_id) where released_at is null;

create table public.payment_audit_logs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payment_runs (id),
  item_id uuid references public.payment_items (id),
  actor_id uuid references public.profiles (id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index payment_audit_logs_run_idx on public.payment_audit_logs (run_id, created_at);

-- A settled item never changes its outcome; the bank details and amount never change.
create or replace function public.guard_payment_item()
returns trigger
language plpgsql
as $$
begin
  if (new.run_id, new.farmer_id, new.beneficiary_name, new.account_number, new.ifsc,
      new.entry_count, new.amount, new.payment_ref)
     is distinct from
     (old.run_id, old.farmer_id, old.beneficiary_name, old.account_number, old.ifsc,
      old.entry_count, old.amount, old.payment_ref)
  then
    raise exception 'payment item details are fixed once the run is generated';
  end if;
  if old.status in ('paid', 'failed') and new.status is distinct from old.status then
    raise exception 'a settled payment cannot change its outcome';
  end if;
  return new;
end;
$$;

create trigger payment_items_guard
  before update on public.payment_items
  for each row execute function public.guard_payment_item();

create or replace function public.refuse_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'this record cannot be changed or deleted';
end;
$$;

create trigger payment_items_no_delete before delete on public.payment_items
  for each row execute function public.refuse_change();
create trigger payment_runs_no_delete before delete on public.payment_runs
  for each row execute function public.refuse_change();
create trigger payment_run_entries_no_delete before delete on public.payment_run_entries
  for each row execute function public.refuse_change();

alter table public.payment_runs enable row level security;
alter table public.payment_items enable row level security;
alter table public.payment_run_entries enable row level security;
alter table public.payment_audit_logs enable row level security;

drop policy if exists payment_runs_manager on public.payment_runs;
drop policy if exists payment_items_manager on public.payment_items;

-- Read only. There is deliberately no insert/update/delete policy.
create policy payment_runs_manager_read on public.payment_runs
  for select to authenticated using (app_role() = 'office_manager');
create policy payment_items_manager_read on public.payment_items
  for select to authenticated using (app_role() = 'office_manager');
create policy payment_run_entries_manager_read on public.payment_run_entries
  for select to authenticated using (app_role() = 'office_manager');
create policy payment_audit_manager_read on public.payment_audit_logs
  for select to authenticated using (app_role() = 'office_manager');

-- ---------------------------------------------------------------------------
-- 3. Payment functions
-- ---------------------------------------------------------------------------

-- Generates a run from approved, unpaid entries in a date range and centres.
-- Everything is derived here from the database; the caller supplies only the
-- selection, never amounts. Farmers without a verified bank account are left
-- out and reported, and their entries stay unpaid.
create or replace function public.create_payment_run(p_from date, p_to date, p_centre_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_centres uuid[];
  v_ids uuid[];
  v_run_id uuid;
  v_run_no text;
  v_seq integer;
  v_day text := to_char(ist_today(), 'YYYYMMDD');
  v_items integer;
  v_entries integer;
  v_total numeric(14, 2);
  v_skipped_entries integer;
  v_skipped_amount numeric(14, 2);
begin
  perform require_office_manager();
  perform set_config('kisansetu.payment_write', 'on', true);

  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'ks:bad_range' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'ks:range_too_long' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct c), '{}') into v_centres from unnest(coalesce(p_centre_ids, '{}')) c;
  if cardinality(v_centres) = 0 then
    raise exception 'ks:no_centres' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_centres) c where not exists (select 1 from centres where id = c)) then
    raise exception 'ks:bad_centre' using errcode = '22023';
  end if;

  -- Lock every candidate row, in a fixed order. A concurrent run that already
  -- holds some of them makes this wait, then re-check the conditions: entries it
  -- took are no longer 'unpaid' and drop out.
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select e.id
      from procurement_entries e
     where e.centre_id = any (v_centres)
       and e.approval_status = 'approved'
       and e.payment_status = 'unpaid'
       and e.sync_status = 'synced'
       and (e.device_recorded_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     order by e.id
       for update of e
  ) x;

  perform pg_advisory_xact_lock(727001);
  select count(*) + 1 into v_seq from payment_runs where run_no like 'PR-' || v_day || '-%';
  v_run_no := 'PR-' || v_day || '-' || lpad(v_seq::text, 3, '0');

  insert into payment_runs (run_no, date_from, date_to, centre_ids, created_by)
  values (v_run_no, p_from, p_to, v_centres, auth.uid())
  returning id into v_run_id;

  insert into payment_items
    (run_id, farmer_id, farmer_code, farmer_name, beneficiary_name, account_number, ifsc,
     entry_count, amount, payment_ref)
  select v_run_id, m.id, m.member_code, m.full_name, b.holder_name, b.account_number, b.ifsc,
         count(*), sum(e.amount),
         v_run_no || '-' || lpad((row_number() over (order by m.member_code))::text, 3, '0')
    from procurement_entries e
    join farmer_members m on m.id = e.farmer_id
    join farmer_bank_accounts b on b.member_id = m.id and b.verified
   where e.id = any (v_ids)
   group by m.id, m.member_code, m.full_name, b.holder_name, b.account_number, b.ifsc;

  insert into payment_run_entries (item_id, entry_id, amount)
  select i.id, e.id, e.amount
    from payment_items i
    join procurement_entries e on e.farmer_id = i.farmer_id and e.id = any (v_ids)
   where i.run_id = v_run_id;

  update procurement_entries
     set payment_status = 'in_run'
   where id in (select r.entry_id from payment_run_entries r
                  join payment_items i on i.id = r.item_id where i.run_id = v_run_id);

  select count(*), coalesce(sum(entry_count), 0), coalesce(sum(amount), 0)
    into v_items, v_entries, v_total from payment_items where run_id = v_run_id;

  if v_items = 0 then
    raise exception 'ks:no_eligible_entries' using errcode = '23514';
  end if;

  update payment_runs set item_count = v_items, entry_count = v_entries, total_amount = v_total
   where id = v_run_id;

  select count(*), coalesce(sum(e.amount), 0) into v_skipped_entries, v_skipped_amount
    from procurement_entries e
   where e.id = any (v_ids) and e.payment_status = 'unpaid';

  insert into payment_audit_logs (run_id, actor_id, action, details)
  values (v_run_id, auth.uid(), 'created',
          jsonb_build_object('date_from', p_from, 'date_to', p_to, 'centre_ids', v_centres,
                             'items', v_items, 'entries', v_entries, 'total', v_total,
                             'skipped_entries', v_skipped_entries, 'skipped_amount', v_skipped_amount));

  perform set_config('kisansetu.payment_write', '', true);
  return jsonb_build_object('run_id', v_run_id, 'run_no', v_run_no, 'item_count', v_items,
                            'entry_count', v_entries, 'total_amount', v_total,
                            'skipped_entries', v_skipped_entries, 'skipped_amount', v_skipped_amount);
end;
$$;

create or replace function public.approve_payment_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run payment_runs%rowtype;
begin
  perform require_office_manager();
  select * into v_run from payment_runs where id = p_run_id for update;
  if not found then
    raise exception 'ks:not_found' using errcode = 'P0002';
  end if;
  if v_run.status <> 'draft' then
    raise exception 'ks:bad_state' using errcode = '23514';
  end if;
  update payment_runs set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_run_id;
  insert into payment_audit_logs (run_id, actor_id, action, details)
  values (p_run_id, auth.uid(), 'approved',
          jsonb_build_object('total', v_run.total_amount, 'items', v_run.item_count));
end;
$$;

-- Cancels a run before any file has gone to the bank. The entries return to unpaid.
create or replace function public.cancel_payment_run(p_run_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run payment_runs%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform require_office_manager();
  perform set_config('kisansetu.payment_write', 'on', true);
  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 300 then
    raise exception 'ks:reason_required' using errcode = '22023';
  end if;
  select * into v_run from payment_runs where id = p_run_id for update;
  if not found then
    raise exception 'ks:not_found' using errcode = 'P0002';
  end if;
  if v_run.status not in ('draft', 'approved') then
    raise exception 'ks:bad_state' using errcode = '23514';
  end if;

  update procurement_entries set payment_status = 'unpaid'
   where payment_status = 'in_run'
     and id in (select r.entry_id from payment_run_entries r
                  join payment_items i on i.id = r.item_id
                 where i.run_id = p_run_id and r.released_at is null);
  update payment_run_entries set released_at = now()
   where released_at is null and item_id in (select id from payment_items where run_id = p_run_id);
  update payment_items set released_at = now() where run_id = p_run_id and released_at is null;
  update payment_runs set status = 'cancelled', cancelled_reason = v_reason, cancelled_at = now()
   where id = p_run_id;

  insert into payment_audit_logs (run_id, actor_id, action, details)
  values (p_run_id, auth.uid(), 'cancelled', jsonb_build_object('reason', v_reason));
  perform set_config('kisansetu.payment_write', '', true);
end;
$$;

-- Marks the bank file as produced. The first call moves an approved run to
-- file_generated and its items to processing; later calls only log a re-download.
create or replace function public.start_bank_file(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run payment_runs%rowtype;
  v_name text;
  v_first boolean := false;
begin
  perform require_office_manager();
  select * into v_run from payment_runs where id = p_run_id for update;
  if not found then
    raise exception 'ks:not_found' using errcode = 'P0002';
  end if;
  if v_run.status = 'draft' then
    raise exception 'ks:not_approved' using errcode = '23514';
  end if;
  if v_run.status = 'cancelled' then
    raise exception 'ks:bad_state' using errcode = '23514';
  end if;

  if v_run.status = 'approved' then
    v_first := true;
    v_name := 'KISANSETU-MOCK-' || v_run.run_no || '.csv';
    update payment_runs
       set status = 'file_generated', bank_file_name = v_name,
           file_generated_by = auth.uid(), file_generated_at = now()
     where id = p_run_id;
    update payment_items set status = 'processing' where run_id = p_run_id and status = 'pending';
  else
    v_name := v_run.bank_file_name;
  end if;

  insert into payment_audit_logs (run_id, actor_id, action, details)
  values (p_run_id, auth.uid(), case when v_first then 'file_generated' else 'file_downloaded' end,
          jsonb_build_object('file', v_name));
  return jsonb_build_object('file_name', v_name, 'first', v_first);
end;
$$;

-- Simulated bank response. There is no real bank behind this: it lets a manager
-- exercise both outcomes. Only items that were sent (processing) can be settled,
-- and a settled item can never be flipped.
create or replace function public.simulate_bank_response(p_item_ids uuid[], p_outcome text, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item payment_items%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ref text;
  v_count integer := 0;
  v_run uuid;
begin
  perform require_office_manager();
  perform set_config('kisansetu.payment_write', 'on', true);
  if p_outcome not in ('paid', 'failed') then
    raise exception 'ks:bad_outcome' using errcode = '22023';
  end if;
  if p_outcome = 'failed' and (v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 200) then
    raise exception 'ks:reason_required' using errcode = '22023';
  end if;
  if p_item_ids is null or cardinality(p_item_ids) = 0 or cardinality(p_item_ids) > 500 then
    raise exception 'ks:bad_items' using errcode = '22023';
  end if;

  for v_item in
    select * from payment_items where id = any (p_item_ids) order by id for update
  loop
    if v_item.status <> 'processing' or v_item.released_at is not null then
      raise exception 'ks:item_not_processing' using errcode = '23514';
    end if;
    if p_outcome = 'paid' then
      v_ref := 'MOCKUTR' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD')
               || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      update payment_items
         set status = 'paid', bank_reference = v_ref, settled_at = now(), settled_by = auth.uid()
       where id = v_item.id;
      update procurement_entries set payment_status = 'paid'
       where id in (select entry_id from payment_run_entries where item_id = v_item.id and released_at is null);
    else
      update payment_items
         set status = 'failed', failure_reason = v_reason, settled_at = now(), settled_by = auth.uid()
       where id = v_item.id;
      update procurement_entries set payment_status = 'failed'
       where id in (select entry_id from payment_run_entries where item_id = v_item.id and released_at is null);
    end if;
    insert into payment_audit_logs (run_id, item_id, actor_id, action, details)
    values (v_item.run_id, v_item.id, auth.uid(), 'simulated_' || p_outcome,
            jsonb_build_object('amount', v_item.amount, 'reason', v_reason, 'simulated', true));
    v_run := v_item.run_id;
    v_count := v_count + 1;
  end loop;

  if v_count <> cardinality(p_item_ids) then
    raise exception 'ks:item_not_processing' using errcode = '23514';
  end if;

  -- The run is complete once nothing is waiting on the bank.
  for v_run in select distinct run_id from payment_items where id = any (p_item_ids) loop
    if not exists (select 1 from payment_items
                    where run_id = v_run and status in ('pending', 'processing') and released_at is null) then
      update payment_runs set status = 'completed' where id = v_run and status = 'file_generated';
      insert into payment_audit_logs (run_id, actor_id, action) values (v_run, auth.uid(), 'completed');
    end if;
  end loop;

  perform set_config('kisansetu.payment_write', '', true);
  return v_count;
end;
$$;

-- Returns the entries of a failed payment to unpaid so they can go into a new
-- run. The failed item stays on the old run as a permanent record.
create or replace function public.release_failed_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item payment_items%rowtype;
begin
  perform require_office_manager();
  perform set_config('kisansetu.payment_write', 'on', true);
  select * into v_item from payment_items where id = p_item_id for update;
  if not found then
    raise exception 'ks:not_found' using errcode = 'P0002';
  end if;
  if v_item.status <> 'failed' or v_item.released_at is not null then
    raise exception 'ks:bad_state' using errcode = '23514';
  end if;

  update procurement_entries set payment_status = 'unpaid'
   where payment_status = 'failed'
     and id in (select entry_id from payment_run_entries where item_id = p_item_id and released_at is null);
  update payment_run_entries set released_at = now() where item_id = p_item_id and released_at is null;
  update payment_items set released_at = now() where id = p_item_id;

  insert into payment_audit_logs (run_id, item_id, actor_id, action, details)
  values (v_item.run_id, p_item_id, auth.uid(), 'released', jsonb_build_object('amount', v_item.amount));
  perform set_config('kisansetu.payment_write', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Stock dispatch
-- ---------------------------------------------------------------------------
create table public.stock_dispatches (
  id uuid primary key default gen_random_uuid(),
  dispatch_no text not null unique check (dispatch_no ~ '^DS-[0-9]{8}-[0-9]{3,}$'),
  centre_id uuid not null references public.centres (id),
  crop public.crop_type not null,
  -- Weighed on the truck at dispatch.
  weight_kg numeric(12, 1) not null check (weight_kg > 0),
  -- What the centre's stock book was reduced by. The difference is weight loss.
  book_kg numeric(12, 1) not null check (book_kg > 0),
  stock_before_kg numeric(12, 1) not null check (stock_before_kg >= 0),
  stock_after_kg numeric(12, 1) not null check (stock_after_kg >= 0),
  destination text not null check (char_length(destination) between 2 and 120),
  truck_no text not null check (truck_no ~ '^[A-Z0-9]{6,12}$'),
  dispatched_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  constraint dispatch_after_matches check (stock_after_kg = stock_before_kg - book_kg),
  constraint dispatch_weight_within_book check (weight_kg <= book_kg)
);

create index stock_dispatches_centre_idx on public.stock_dispatches (centre_id, crop, dispatched_at desc);

create trigger stock_dispatches_immutable_update before update on public.stock_dispatches
  for each row execute function public.refuse_change();
create trigger stock_dispatches_immutable_delete before delete on public.stock_dispatches
  for each row execute function public.refuse_change();

alter table public.stock_dispatches enable row level security;
create policy dispatches_manager_read on public.stock_dispatches
  for select to authenticated using (app_role() = 'office_manager');

-- Stock book for one centre and crop: purchases that still stand (approved or
-- under review; a rejected purchase is not stock) minus what was dispatched.
create or replace function public.stock_balance_kg(p_centre uuid, p_crop public.crop_type)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(net_kg) from procurement_entries
                    where centre_id = p_centre and crop = p_crop and approval_status in ('approved', 'held')), 0)
       - coalesce((select sum(book_kg) from stock_dispatches
                    where centre_id = p_centre and crop = p_crop), 0);
$$;

create or replace function public.record_dispatch(
  p_centre uuid, p_crop public.crop_type, p_weight numeric, p_book numeric,
  p_destination text, p_truck text, p_dispatched_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric(12, 1);
  v_when timestamptz := coalesce(p_dispatched_at, now());
  v_dest text := btrim(coalesce(p_destination, ''));
  v_truck text := upper(regexp_replace(coalesce(p_truck, ''), '[\s-]', '', 'g'));
  v_day text := to_char(now() at time zone 'Asia/Kolkata', 'YYYYMMDD');
  v_seq integer;
  v_no text;
  v_id uuid;
begin
  perform require_office_manager();
  if not exists (select 1 from centres where id = p_centre) then
    raise exception 'ks:bad_centre' using errcode = '22023';
  end if;
  if p_weight is null or p_weight <= 0 or p_book is null or p_book <= 0 then
    raise exception 'ks:bad_weight' using errcode = '22023';
  end if;
  if p_weight > p_book then
    raise exception 'ks:weight_above_book' using errcode = '22023';
  end if;
  if char_length(v_dest) < 2 or char_length(v_dest) > 120 or v_truck !~ '^[A-Z0-9]{6,12}$' then
    raise exception 'ks:bad_details' using errcode = '22023';
  end if;
  if v_when > now() + interval '5 minutes' or v_when < now() - interval '48 hours' then
    raise exception 'ks:bad_time' using errcode = '22023';
  end if;

  -- One dispatch at a time per centre and crop, so stock can never go negative.
  perform pg_advisory_xact_lock(hashtext(p_centre::text || p_crop::text));
  v_before := stock_balance_kg(p_centre, p_crop);
  if p_book > v_before then
    raise exception 'ks:insufficient_stock' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(727002);
  select count(*) + 1 into v_seq from stock_dispatches where dispatch_no like 'DS-' || v_day || '-%';
  v_no := 'DS-' || v_day || '-' || lpad(v_seq::text, 3, '0');

  insert into stock_dispatches
    (dispatch_no, centre_id, crop, weight_kg, book_kg, stock_before_kg, stock_after_kg,
     destination, truck_no, dispatched_at, created_by)
  values (v_no, p_centre, p_crop, p_weight, p_book, v_before, v_before - p_book,
          v_dest, v_truck, v_when, auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'dispatch_no', v_no, 'stock_before_kg', v_before,
                            'stock_after_kg', v_before - p_book);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Stock dashboard figures, one row per centre and crop.
-- ---------------------------------------------------------------------------
create or replace function public.stock_summary(
  p_as_of date default null, p_centre uuid default null, p_crop public.crop_type default null)
returns table (
  centre_id uuid, crop public.crop_type,
  procured_kg numeric, day_kg numeric,
  dispatched_book_kg numeric, dispatched_weight_kg numeric,
  held_count integer, pending_pay_count integer, pending_pay_amount numeric,
  failed_count integer, failed_amount numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_as_of date := coalesce(p_as_of, ist_today());
begin
  perform require_office_manager();
  return query
  with grid as (
    select c.id as g_centre, k.k_crop as g_crop
      from centres c
     cross join (select unnest(enum_range(null::crop_type)) as k_crop) k
     where (p_centre is null or c.id = p_centre) and (p_crop is null or k.k_crop = p_crop)
  ),
  e as (
    select pe.centre_id as e_centre, pe.crop as e_crop,
           coalesce(sum(pe.net_kg) filter (where pe.approval_status <> 'rejected'), 0) as procured,
           coalesce(sum(pe.net_kg) filter (where pe.approval_status <> 'rejected'
             and (pe.device_recorded_at at time zone 'Asia/Kolkata')::date = v_as_of), 0) as on_day,
           count(*) filter (where pe.approval_status = 'held') as held,
           count(*) filter (where pe.approval_status = 'approved' and pe.payment_status in ('unpaid', 'in_run')) as pay_n,
           coalesce(sum(pe.amount) filter (where pe.approval_status = 'approved'
             and pe.payment_status in ('unpaid', 'in_run')), 0) as pay_amt,
           count(*) filter (where pe.payment_status = 'failed') as fail_n,
           coalesce(sum(pe.amount) filter (where pe.payment_status = 'failed'), 0) as fail_amt
      from procurement_entries pe
     where (pe.device_recorded_at at time zone 'Asia/Kolkata')::date <= v_as_of
     group by pe.centre_id, pe.crop
  ),
  d as (
    select sd.centre_id as d_centre, sd.crop as d_crop,
           sum(sd.book_kg) as book, sum(sd.weight_kg) as weighed
      from stock_dispatches sd
     where (sd.dispatched_at at time zone 'Asia/Kolkata')::date <= v_as_of
     group by sd.centre_id, sd.crop
  )
  select g.g_centre, g.g_crop,
         coalesce(e.procured, 0)::numeric, coalesce(e.on_day, 0)::numeric,
         coalesce(d.book, 0)::numeric, coalesce(d.weighed, 0)::numeric,
         coalesce(e.held, 0)::integer, coalesce(e.pay_n, 0)::integer, coalesce(e.pay_amt, 0)::numeric,
         coalesce(e.fail_n, 0)::integer, coalesce(e.fail_amt, 0)::numeric
    from grid g
    left join e on e.e_centre = g.g_centre and e.e_crop = g.g_crop
    left join d on d.d_centre = g.g_centre and d.d_crop = g.g_crop
   order by g.g_centre, g.g_crop;
end;
$$;

-- Records the server knows were not accepted: entries not marked synced, and
-- phone submissions the server refused that never arrived later. Entries still
-- waiting on a phone with no signal are visible only on that phone.
create or replace function public.unsynced_records(p_centre uuid default null)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entries integer;
  v_refused integer;
begin
  perform require_office_manager();
  select count(*) into v_entries from procurement_entries e
   where e.sync_status <> 'synced' and (p_centre is null or e.centre_id = p_centre);
  select count(distinct s.client_id) into v_refused
    from sync_events s
    left join profiles p on p.id = s.operator_id
   where s.outcome = 'rejected' and s.client_id is not null
     and not exists (select 1 from procurement_entries e where e.client_id = s.client_id)
     and (p_centre is null or p.centre_id = p_centre);
  return v_entries + v_refused;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Function permissions
-- ---------------------------------------------------------------------------
revoke all on function public.create_payment_run(date, date, uuid[]) from public, anon;
revoke all on function public.approve_payment_run(uuid) from public, anon;
revoke all on function public.cancel_payment_run(uuid, text) from public, anon;
revoke all on function public.start_bank_file(uuid) from public, anon;
revoke all on function public.simulate_bank_response(uuid[], text, text) from public, anon;
revoke all on function public.release_failed_item(uuid) from public, anon;
revoke all on function public.record_dispatch(uuid, public.crop_type, numeric, numeric, text, text, timestamptz) from public, anon;
revoke all on function public.stock_summary(date, uuid, public.crop_type) from public, anon;
revoke all on function public.unsynced_records(uuid) from public, anon;
revoke all on function public.stock_balance_kg(uuid, public.crop_type) from public, anon;
grant execute on function public.create_payment_run(date, date, uuid[]) to authenticated;
grant execute on function public.approve_payment_run(uuid) to authenticated;
grant execute on function public.cancel_payment_run(uuid, text) to authenticated;
grant execute on function public.start_bank_file(uuid) to authenticated;
grant execute on function public.simulate_bank_response(uuid[], text, text) to authenticated;
grant execute on function public.release_failed_item(uuid) to authenticated;
grant execute on function public.record_dispatch(uuid, public.crop_type, numeric, numeric, text, text, timestamptz) to authenticated;
grant execute on function public.stock_summary(date, uuid, public.crop_type) to authenticated;
grant execute on function public.unsynced_records(uuid) to authenticated;
