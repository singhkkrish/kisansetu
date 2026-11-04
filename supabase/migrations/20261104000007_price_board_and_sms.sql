-- Part 4: the central price board, rate snapshots on procurement entries, and
-- the SMS log.
--
-- Design: daily_prices stays exactly what the offline engine already reads, the
-- one live published rate for a date, crop and grade. price_versions is the full
-- history behind it (drafts, published, superseded). Nobody writes daily_prices
-- directly any more: managers go through the functions below, which keep both
-- tables and the audit trail in step.

create or replace function public.ist_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create type public.price_status as enum ('draft', 'published', 'superseded');

create table public.price_versions (
  id uuid primary key default gen_random_uuid(),
  price_date date not null,
  crop public.crop_type not null,
  grade public.grade_type not null,
  version integer not null check (version > 0),
  rate_per_quintal numeric(10, 2) not null check (rate_per_quintal > 0 and rate_per_quintal < 100000),
  status public.price_status not null default 'draft',
  -- Null only for prices that existed before the price board did.
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_by uuid references public.profiles (id),
  published_at timestamptz,
  supersedes_id uuid references public.price_versions (id),
  correction_reason text check (correction_reason is null or char_length(correction_reason) between 5 and 300),
  unique (price_date, crop, grade, version),
  constraint published_has_timestamp check (status = 'draft' or published_at is not null)
);

-- One working draft, and one live published version, per crop, grade and date.
create unique index price_versions_one_draft
  on public.price_versions (price_date, crop, grade) where status = 'draft';
create unique index price_versions_one_published
  on public.price_versions (price_date, crop, grade) where status = 'published';
create index price_versions_date_idx on public.price_versions (price_date desc, crop, grade, version desc);

create table public.price_audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- No foreign key: the record of a deleted draft must outlive the draft.
  price_version_id uuid not null,
  actor_id uuid,
  action text not null check (action in ('created', 'edited', 'draft_deleted', 'published', 'superseded')),
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index price_audit_logs_version_idx on public.price_audit_logs (price_version_id, created_at);

-- The live table gains the provenance of the rate it holds.
alter table public.daily_prices
  add column version integer not null default 1,
  add column published_at timestamptz,
  add column published_by uuid references public.profiles (id);

-- Prices that existed before the board become published version 1.
insert into public.price_versions
  (price_date, crop, grade, version, rate_per_quintal, status, created_by, published_by, published_at)
select price_date, crop, grade, version, rate_per_quintal, 'published', set_by, set_by, coalesce(published_at, created_at)
  from public.daily_prices
on conflict do nothing;

-- Rates inserted straight into daily_prices (the demo seed does this) still get a history row.
create or replace function public.mirror_live_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into price_versions
    (price_date, crop, grade, version, rate_per_quintal, status, created_by, published_by, published_at)
  values
    (new.price_date, new.crop, new.grade, new.version, new.rate_per_quintal, 'published',
     new.set_by, new.published_by, coalesce(new.published_at, new.created_at))
  on conflict (price_date, crop, grade, version) do nothing;
  return new;
end;
$$;

create trigger daily_prices_mirror
  after insert on public.daily_prices
  for each row execute function public.mirror_live_price();

-- A published price can never be edited or deleted. Its only permitted change
-- is being superseded by a newer published version.
create or replace function public.guard_price_version()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'a published price cannot be deleted' using errcode = '23514';
    end if;
    return old;
  end if;

  if (new.price_date, new.crop, new.grade, new.version, new.created_by, new.created_at, new.supersedes_id)
     is distinct from
     (old.price_date, old.crop, old.grade, old.version, old.created_by, old.created_at, old.supersedes_id) then
    raise exception 'price identity cannot be changed; create a new version instead' using errcode = '23514';
  end if;

  if old.status = 'draft' then
    return new;
  elsif old.status = 'published' then
    if new.status = 'superseded'
       and (new.rate_per_quintal, new.published_by, new.published_at, new.correction_reason)
           is not distinct from
           (old.rate_per_quintal, old.published_by, old.published_at, old.correction_reason) then
      return new;
    end if;
    raise exception 'a published price cannot be changed; publish a corrected version instead' using errcode = '23514';
  end if;
  raise exception 'a superseded price cannot be changed' using errcode = '23514';
end;
$$;

create trigger price_versions_guard
  before update or delete on public.price_versions
  for each row execute function public.guard_price_version();

create or replace function public.log_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into price_audit_logs (price_version_id, actor_id, action, new_values)
    values (new.id, coalesce(auth.uid(), new.created_by), 'created',
            jsonb_build_object('price_date', new.price_date, 'crop', new.crop, 'grade', new.grade,
                               'version', new.version, 'rate_per_quintal', new.rate_per_quintal,
                               'status', new.status, 'correction_reason', new.correction_reason));
  elsif tg_op = 'DELETE' then
    insert into price_audit_logs (price_version_id, actor_id, action, old_values)
    values (old.id, auth.uid(), 'draft_deleted',
            jsonb_build_object('price_date', old.price_date, 'crop', old.crop, 'grade', old.grade,
                               'version', old.version, 'rate_per_quintal', old.rate_per_quintal));
    return old;
  elsif old.status = 'draft' and new.status = 'published' then
    insert into price_audit_logs (price_version_id, actor_id, action, old_values, new_values)
    values (new.id, auth.uid(), 'published',
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status, 'rate_per_quintal', new.rate_per_quintal,
                               'version', new.version, 'published_by', new.published_by,
                               'published_at', new.published_at));
  elsif old.status = 'published' and new.status = 'superseded' then
    insert into price_audit_logs (price_version_id, actor_id, action, old_values, new_values)
    values (new.id, auth.uid(), 'superseded',
            jsonb_build_object('status', old.status, 'rate_per_quintal', old.rate_per_quintal),
            jsonb_build_object('status', new.status));
  elsif new.rate_per_quintal is distinct from old.rate_per_quintal then
    insert into price_audit_logs (price_version_id, actor_id, action, old_values, new_values)
    values (new.id, auth.uid(), 'edited',
            jsonb_build_object('rate_per_quintal', old.rate_per_quintal),
            jsonb_build_object('rate_per_quintal', new.rate_per_quintal));
  end if;
  return new;
end;
$$;

create trigger price_versions_audit
  after insert or update or delete on public.price_versions
  for each row execute function public.log_price_change();

-- Row level security: nobody writes these tables directly. Reads follow the role.
alter table public.price_versions enable row level security;
alter table public.price_audit_logs enable row level security;

create policy price_versions_manager_read on public.price_versions
  for select to authenticated using (app_role() = 'office_manager');
-- Operators see only what has been published, never a draft.
create policy price_versions_staff_read on public.price_versions
  for select to authenticated using (app_role() is not null and status in ('published', 'superseded'));
create policy price_audit_manager_read on public.price_audit_logs
  for select to authenticated using (app_role() = 'office_manager');

drop policy prices_manage on public.daily_prices;

-- Price board functions ------------------------------------------------------

create or replace function public.require_manager()
returns void
language plpgsql
stable
as $$
begin
  if app_role() is distinct from 'office_manager' then
    raise exception 'only office managers can manage prices' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_price_draft(
  p_date date, p_crop public.crop_type, p_grade public.grade_type,
  p_rate numeric, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live price_versions%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_version integer;
  v_id uuid;
begin
  perform require_manager();
  if p_date < ist_today() or p_date > ist_today() + 14 then
    raise exception 'effective date must be today or within the next 14 days' using errcode = '22023';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate >= 100000 or scale(p_rate) > 2 then
    raise exception 'rate must be more than zero, below 100000, with at most 2 decimals' using errcode = '22023';
  end if;
  if exists (select 1 from price_versions where price_date = p_date and crop = p_crop and grade = p_grade and status = 'draft') then
    raise exception 'a draft already exists for this crop, grade and date; edit it instead' using errcode = '23505';
  end if;

  select * into v_live from price_versions
   where price_date = p_date and crop = p_crop and grade = p_grade and status = 'published';
  if found then
    if v_reason is null or char_length(v_reason) < 5 then
      raise exception 'a correction needs a reason of at least 5 characters' using errcode = '22023';
    end if;
    if v_live.rate_per_quintal = p_rate then
      raise exception 'the corrected rate is the same as the published rate' using errcode = '22023';
    end if;
  else
    v_reason := null;
  end if;

  select coalesce(max(version), 0) + 1 into v_version from price_versions
   where price_date = p_date and crop = p_crop and grade = p_grade;

  insert into price_versions (price_date, crop, grade, version, rate_per_quintal, created_by, supersedes_id, correction_reason)
  values (p_date, p_crop, p_grade, v_version, p_rate, auth.uid(), v_live.id, v_reason)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_price_draft(p_id uuid, p_rate numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row price_versions%rowtype;
begin
  perform require_manager();
  if p_rate is null or p_rate <= 0 or p_rate >= 100000 or scale(p_rate) > 2 then
    raise exception 'rate must be more than zero, below 100000, with at most 2 decimals' using errcode = '22023';
  end if;
  select * into v_row from price_versions where id = p_id for update;
  if not found then raise exception 'price not found' using errcode = 'P0002'; end if;
  if v_row.status <> 'draft' then
    raise exception 'only an unpublished price can be edited' using errcode = '23514';
  end if;
  update price_versions set rate_per_quintal = p_rate, updated_at = now() where id = p_id;
end;
$$;

create or replace function public.delete_price_draft(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status price_status;
begin
  perform require_manager();
  select status into v_status from price_versions where id = p_id for update;
  if not found then raise exception 'price not found' using errcode = 'P0002'; end if;
  if v_status <> 'draft' then
    raise exception 'only an unpublished price can be deleted' using errcode = '23514';
  end if;
  delete from price_versions where id = p_id;
end;
$$;

-- Publishes several drafts at once, all or none. A correction supersedes the
-- version it replaces and updates the live rate that every centre downloads.
create or replace function public.publish_prices(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row price_versions%rowtype;
  v_count integer := 0;
begin
  perform require_manager();
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'choose at least one price to publish' using errcode = '22023';
  end if;

  for v_row in
    select * from price_versions where id = any (p_ids) order by price_date, crop, grade for update
  loop
    if v_row.status <> 'draft' then
      raise exception 'only an unpublished price can be published' using errcode = '23514';
    end if;
    if v_row.price_date < ist_today() then
      raise exception 'a price for a past date cannot be published' using errcode = '22023';
    end if;

    update price_versions set status = 'superseded'
     where price_date = v_row.price_date and crop = v_row.crop and grade = v_row.grade and status = 'published';

    update price_versions
       set status = 'published', published_by = auth.uid(), published_at = now(), updated_at = now()
     where id = v_row.id;

    insert into daily_prices (price_date, crop, grade, rate_per_quintal, set_by, version, published_at, published_by)
    values (v_row.price_date, v_row.crop, v_row.grade, v_row.rate_per_quintal, v_row.created_by, v_row.version, now(), auth.uid())
    on conflict (price_date, crop, grade) do update
      set rate_per_quintal = excluded.rate_per_quintal, set_by = excluded.set_by,
          version = excluded.version, published_at = excluded.published_at, published_by = excluded.published_by;
    v_count := v_count + 1;
  end loop;

  if v_count <> cardinality(p_ids) then
    raise exception 'one or more prices were not found' using errcode = 'P0002';
  end if;
  return v_count;
end;
$$;

revoke all on function public.create_price_draft(date, public.crop_type, public.grade_type, numeric, text) from public, anon;
revoke all on function public.update_price_draft(uuid, numeric) from public, anon;
revoke all on function public.delete_price_draft(uuid) from public, anon;
revoke all on function public.publish_prices(uuid[]) from public, anon;
grant execute on function public.create_price_draft(date, public.crop_type, public.grade_type, numeric, text) to authenticated;
grant execute on function public.update_price_draft(uuid, numeric) to authenticated;
grant execute on function public.delete_price_draft(uuid) to authenticated;
grant execute on function public.publish_prices(uuid[]) to authenticated;

-- Rate snapshot on every procurement entry -----------------------------------

alter table public.procurement_entries
  -- Which published price the operator's phone used: its effective date and version.
  add column rate_price_date date,
  add column rate_version integer check (rate_version is null or rate_version > 0);

create or replace function public.guard_procurement_update()
returns trigger
language plpgsql
as $$
begin
  if (new.client_id, new.slip_no, new.farmer_id, new.centre_id, new.operator_id,
      new.crop, new.grade, new.gross_kg, new.tare_kg, new.moisture_pct,
      new.net_kg, new.rate_per_quintal, new.amount, new.device_id,
      new.device_recorded_at, new.server_received_at, new.device_clock_offset_ms,
      new.rate_price_date, new.rate_version, new.payload_hash, new.prev_hash)
     is distinct from
     (old.client_id, old.slip_no, old.farmer_id, old.centre_id, old.operator_id,
      old.crop, old.grade, old.gross_kg, old.tare_kg, old.moisture_pct,
      old.net_kg, old.rate_per_quintal, old.amount, old.device_id,
      old.device_recorded_at, old.server_received_at, old.device_clock_offset_ms,
      old.rate_price_date, old.rate_version, old.payload_hash, old.prev_hash)
  then
    raise exception 'procurement facts are immutable once recorded';
  end if;
  return new;
end;
$$;

-- The stored rate is the snapshot the phone used and is never rewritten. It is
-- compared with the central price: a different rate holds payment for review,
-- and a rate that was valid but has since been corrected is called out as such.
create or replace function public.enforce_entry_integrity()
returns trigger
language plpgsql
as $$
declare
  v_flags text[] := '{}';
  v_rate numeric;
  v_day date;
begin
  new.server_received_at := now();
  new.sync_status := 'synced';
  new.payment_status := 'unpaid';

  v_day := ((new.device_recorded_at
             + make_interval(secs => coalesce(new.device_clock_offset_ms, 0) / 1000.0))
            at time zone 'Asia/Kolkata')::date;

  select rate_per_quintal into v_rate
    from daily_prices
   where price_date = v_day and crop = new.crop and grade = new.grade;

  if v_rate is null then
    v_flags := array_append(v_flags, 'no_price_for_day');
  elsif v_rate <> new.rate_per_quintal then
    if exists (select 1 from price_versions
                where price_date = v_day and crop = new.crop and grade = new.grade
                  and status = 'superseded' and rate_per_quintal = new.rate_per_quintal) then
      v_flags := array_append(v_flags, 'superseded_rate');
    else
      v_flags := array_append(v_flags, 'rate_mismatch');
    end if;
  end if;

  -- A claimed price version must really have carried this rate.
  if new.rate_version is not null and not exists (
       select 1 from price_versions
        where price_date = coalesce(new.rate_price_date, v_day) and crop = new.crop and grade = new.grade
          and version = new.rate_version and rate_per_quintal = new.rate_per_quintal
          and status in ('published', 'superseded')) then
    v_flags := array_append(v_flags, 'rate_mismatch');
  end if;

  if new.device_recorded_at > now() + interval '10 minutes' then
    v_flags := array_append(v_flags, 'clock_ahead');
  end if;
  if abs(coalesce(new.device_clock_offset_ms, 0)) > 900000 then
    v_flags := array_append(v_flags, 'clock_skew');
  end if;

  new.flag_reasons := coalesce(
    (select array_agg(distinct f order by f) from unnest(new.flag_reasons || v_flags) f), '{}');
  new.approval_status := case when cardinality(new.flag_reasons) > 0 then 'held' else 'approved' end;
  return new;
end;
$$;

create or replace function public.log_procurement_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into procurement_audit_logs (entry_id, actor_id, action, new_values)
    values (new.id, coalesce(auth.uid(), new.operator_id), 'created',
            jsonb_build_object(
              'created_by', new.operator_id,
              'centre_id', new.centre_id,
              'slip_no', new.slip_no,
              'device_id', new.device_id,
              'device_recorded_at', new.device_recorded_at,
              'device_clock_offset_ms', new.device_clock_offset_ms,
              'server_received_at', new.server_received_at,
              'rate_per_quintal', new.rate_per_quintal,
              'rate_price_date', new.rate_price_date,
              'rate_version', new.rate_version,
              'sync_status', new.sync_status,
              'approval_status', new.approval_status,
              'payment_status', new.payment_status,
              'flag_reasons', new.flag_reasons));
  elsif (new.approval_status, new.payment_status, new.flag_reasons, new.review_note)
        is distinct from (old.approval_status, old.payment_status, old.flag_reasons, old.review_note) then
    insert into procurement_audit_logs (entry_id, actor_id, action, old_values, new_values)
    values (new.id, auth.uid(), 'status_changed',
            jsonb_build_object('approval_status', old.approval_status,
                               'payment_status', old.payment_status,
                               'flag_reasons', old.flag_reasons,
                               'review_note', old.review_note),
            jsonb_build_object('approval_status', new.approval_status,
                               'payment_status', new.payment_status,
                               'flag_reasons', new.flag_reasons,
                               'review_note', new.review_note));
  end if;
  return new;
end;
$$;

-- SMS log --------------------------------------------------------------------

create type public.sms_status as enum ('sending', 'sent', 'delivered', 'failed');

create table public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.procurement_entries (id),
  farmer_id uuid not null references public.farmer_members (id),
  centre_id uuid not null references public.centres (id),
  kind text not null default 'procurement_slip' check (kind = 'procurement_slip'),
  language text not null default 'mr' check (language in ('mr', 'en')),
  -- Only ever the masked number. The full number stays in the farmer registry.
  recipient_masked text not null check (recipient_masked ~ '\*' and recipient_masked !~ '[0-9]{7,}'),
  body text not null check (char_length(body) between 1 and 1000),
  status public.sms_status not null default 'sending',
  failure_reason text,
  provider text not null default 'mock',
  provider_ref text,
  attempts integer not null default 0,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  -- When the gateway accepted the message.
  sent_at timestamptz,
  -- When the status last changed: the delivery confirmation time once delivered.
  status_at timestamptz not null default now(),
  unique (entry_id, kind),
  constraint failed_has_reason check (status <> 'failed' or failure_reason is not null)
);
create index sms_messages_centre_idx on public.sms_messages (centre_id, created_at desc);

create or replace function public.guard_sms_update()
returns trigger
language plpgsql
as $$
begin
  if (new.entry_id, new.farmer_id, new.centre_id, new.kind, new.language, new.recipient_masked,
      new.body, new.created_by, new.created_at)
     is distinct from
     (old.entry_id, old.farmer_id, old.centre_id, old.kind, old.language, old.recipient_masked,
      old.body, old.created_by, old.created_at) then
    raise exception 'a recorded SMS cannot be edited' using errcode = '23514';
  end if;
  if old.status = 'delivered' and new.status <> 'delivered' then
    raise exception 'a delivered SMS cannot change status' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger sms_messages_guard
  before update on public.sms_messages
  for each row execute function public.guard_sms_update();

alter table public.sms_messages enable row level security;

create policy sms_read on public.sms_messages
  for select to authenticated
  using (app_role() = 'office_manager' or (app_role() = 'centre_operator' and centre_id = app_centre_id()));
create policy sms_operator_insert on public.sms_messages
  for insert to authenticated
  with check (app_role() = 'centre_operator' and centre_id = app_centre_id() and created_by = auth.uid());
create policy sms_operator_update on public.sms_messages
  for update to authenticated
  using (app_role() = 'centre_operator' and centre_id = app_centre_id())
  with check (app_role() = 'centre_operator' and centre_id = app_centre_id());
