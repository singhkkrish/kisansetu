-- Helper functions, integrity triggers and row level security.

create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.app_centre_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select centre_id from public.profiles where id = auth.uid() and active
$$;

-- Profiles are created by an office manager through the admin API. Only
-- app_metadata is read (users cannot edit it), never user_metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
begin
  if meta ? 'role' then
    insert into public.profiles (id, full_name, role, centre_id, phone)
    values (
      new.id,
      coalesce(meta ->> 'full_name', new.email, 'Unnamed'),
      (meta ->> 'role')::public.user_role,
      nullif(meta ->> 'centre_id', '')::uuid,
      meta ->> 'phone'
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Hand a block of slip numbers to a device. Atomic per centre.
create or replace function public.allocate_slip_block(
  p_centre_id uuid,
  p_device_id text,
  p_size integer default 200
)
returns table (start_no integer, end_no integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start integer;
  v_end integer;
begin
  if p_size < 1 or p_size > 1000 then
    raise exception 'block size must be between 1 and 1000';
  end if;
  if app_role() is distinct from 'centre_operator' or app_centre_id() is distinct from p_centre_id then
    raise exception 'not allowed to allocate slip numbers for this centre';
  end if;

  insert into slip_counters (centre_id, last_no) values (p_centre_id, 0)
  on conflict (centre_id) do nothing;

  update slip_counters
     set last_no = last_no + p_size
   where centre_id = p_centre_id
  returning last_no - p_size + 1, last_no into v_start, v_end;

  insert into slip_blocks (centre_id, device_id, start_no, end_no, allocated_by)
  values (p_centre_id, p_device_id, v_start, v_end, auth.uid());

  return query select v_start, v_end;
end;
$$;

-- Once saved, the purchase facts cannot change. Managers may only move the
-- approval and payment state, which keeps the record tamper-evident.
create or replace function public.guard_procurement_update()
returns trigger
language plpgsql
as $$
begin
  if (new.client_id, new.slip_no, new.farmer_id, new.centre_id, new.operator_id,
      new.crop, new.grade, new.gross_kg, new.tare_kg, new.moisture_pct,
      new.net_kg, new.rate_per_quintal, new.amount, new.device_id,
      new.device_recorded_at, new.payload_hash, new.prev_hash)
     is distinct from
     (old.client_id, old.slip_no, old.farmer_id, old.centre_id, old.operator_id,
      old.crop, old.grade, old.gross_kg, old.tare_kg, old.moisture_pct,
      old.net_kg, old.rate_per_quintal, old.amount, old.device_id,
      old.device_recorded_at, old.payload_hash, old.prev_hash)
  then
    raise exception 'procurement facts are immutable once recorded';
  end if;
  return new;
end;
$$;

create trigger procurement_entries_guard_update
  before update on public.procurement_entries
  for each row execute function public.guard_procurement_update();

create or replace function public.log_procurement_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into procurement_audit_logs (entry_id, actor_id, action, new_values)
    values (new.id, auth.uid(), 'created',
            jsonb_build_object('approval_status', new.approval_status,
                               'flag_reasons', new.flag_reasons));
  elsif (new.approval_status, new.payment_status, new.flag_reasons)
        is distinct from (old.approval_status, old.payment_status, old.flag_reasons) then
    insert into procurement_audit_logs (entry_id, actor_id, action, old_values, new_values)
    values (new.id, auth.uid(), 'status_changed',
            jsonb_build_object('approval_status', old.approval_status,
                               'payment_status', old.payment_status,
                               'flag_reasons', old.flag_reasons),
            jsonb_build_object('approval_status', new.approval_status,
                               'payment_status', new.payment_status,
                               'flag_reasons', new.flag_reasons));
  end if;
  return new;
end;
$$;

create trigger procurement_entries_audit
  after insert or update on public.procurement_entries
  for each row execute function public.log_procurement_change();

-- Row level security ---------------------------------------------------------

alter table public.centres enable row level security;
alter table public.profiles enable row level security;
alter table public.farmer_members enable row level security;
alter table public.farmer_bank_accounts enable row level security;
alter table public.daily_prices enable row level security;
alter table public.slip_counters enable row level security;
alter table public.slip_blocks enable row level security;
alter table public.procurement_entries enable row level security;
alter table public.procurement_audit_logs enable row level security;
alter table public.payment_runs enable row level security;
alter table public.payment_items enable row level security;
alter table public.sync_events enable row level security;

-- centres
create policy centres_read on public.centres
  for select to authenticated using (true);
create policy centres_manage on public.centres
  for all to authenticated
  using (app_role() = 'office_manager') with check (app_role() = 'office_manager');

-- profiles
create policy profiles_read_own_or_manager on public.profiles
  for select to authenticated
  using (id = auth.uid() or app_role() = 'office_manager');
create policy profiles_manage on public.profiles
  for all to authenticated
  using (app_role() = 'office_manager') with check (app_role() = 'office_manager');

-- farmer members: everyone signed in can look members up, managers edit.
create policy members_read on public.farmer_members
  for select to authenticated using (app_role() is not null);
create policy members_manage on public.farmer_members
  for all to authenticated
  using (app_role() = 'office_manager') with check (app_role() = 'office_manager');

-- bank details: managers only.
create policy bank_manager_only on public.farmer_bank_accounts
  for all to authenticated
  using (app_role() = 'office_manager') with check (app_role() = 'office_manager');

-- daily prices: read by all staff, set centrally by managers.
create policy prices_read on public.daily_prices
  for select to authenticated using (app_role() is not null);
create policy prices_manage on public.daily_prices
  for all to authenticated
  using (app_role() = 'office_manager') with check (app_role() = 'office_manager');

-- slip allocation is done through allocate_slip_block(); managers can inspect.
create policy slip_counters_manager_read on public.slip_counters
  for select to authenticated using (app_role() = 'office_manager');
create policy slip_blocks_manager_read on public.slip_blocks
  for select to authenticated using (app_role() = 'office_manager');

-- procurement entries
create policy entries_read on public.procurement_entries
  for select to authenticated
  using (
    app_role() = 'office_manager'
    or (app_role() = 'centre_operator' and centre_id = app_centre_id())
  );
create policy entries_operator_insert on public.procurement_entries
  for insert to authenticated
  with check (
    app_role() = 'centre_operator'
    and operator_id = auth.uid()
    and centre_id = app_centre_id()
  );
create policy entries_manager_update on public.procurement_entries
  for update to authenticated
  using (app_role() = 'office_manager') with check (app_role() = 'office_manager');

-- audit log: written only by trigger, readable by managers, never edited.
create policy audit_manager_read on public.procurement_audit_logs
  for select to authenticated using (app_role() = 'office_manager');

-- payments: managers only.
create policy payment_runs_manager on public.payment_runs
  for all to authenticated
  using (app_role() = 'office_manager') with check (app_role() = 'office_manager');
create policy payment_items_manager on public.payment_items
  for all to authenticated
  using (app_role() = 'office_manager') with check (app_role() = 'office_manager');

-- sync log
create policy sync_events_read on public.sync_events
  for select to authenticated
  using (app_role() = 'office_manager' or operator_id = auth.uid());
create policy sync_events_insert on public.sync_events
  for insert to authenticated
  with check (operator_id = auth.uid());
