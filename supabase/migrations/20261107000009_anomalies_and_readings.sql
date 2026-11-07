-- Part 6: deterministic anomaly detection with human review, and metadata about
-- AI-assisted display readings.
--
-- Rules in this file:
--   * An anomaly only ever holds an entry for review. Nothing here rejects,
--     cancels or approves a purchase; a person decides.
--   * Thresholds live in a table a manager can change. Every default is a DEMO
--     ASSUMPTION chosen to show the rules working. None is an official or
--     agronomic standard, and each should be set by the company.
--   * AI readings are suggestions the operator confirms. The server keeps only a
--     small record of what the operator accepted (reading_meta), never an image.

-- ---------------------------------------------------------------------------
-- 1. Configurable thresholds
-- ---------------------------------------------------------------------------
create table public.anomaly_settings (
  key text primary key,
  value numeric not null,
  min_value numeric not null,
  max_value numeric not null,
  -- True until the company has confirmed the figure for its own use.
  is_assumption boolean not null default true,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  constraint anomaly_setting_in_bounds check (value between min_value and max_value)
);

insert into public.anomaly_settings (key, value, min_value, max_value) values
  ('weight_vs_land_enabled',          1,    0,    1),
  ('land_max_kg_per_acre_soybean',    1000, 1,    20000),
  ('land_max_kg_per_acre_tur',        800,  1,    20000),
  ('land_season_days',                150,  1,    730),
  ('repeat_enabled',                  1,    0,    1),
  ('repeat_window_minutes',           60,   1,    1440),
  ('repeat_min_other_entries',        1,    1,    20),
  ('uniform_moisture_enabled',        1,    0,    1),
  ('uniform_window_entries',          10,   3,    100),
  ('uniform_max_range_pct',           0.2,  0,    5),
  ('weight_pattern_enabled',          1,    0,    1),
  ('weight_pattern_ratio',            3,    1.1,  50),
  ('moisture_pattern_enabled',        1,    0,    1),
  ('moisture_shift_pct',              5,    0.5,  40),
  ('pattern_history_entries',         10,   3,    100),
  ('pattern_min_history',             3,    2,    50);

create table public.anomaly_setting_logs (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  old_value numeric not null,
  new_value numeric not null,
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.anomaly_settings enable row level security;
alter table public.anomaly_setting_logs enable row level security;
create policy anomaly_settings_manager_read on public.anomaly_settings
  for select to authenticated using (app_role() = 'office_manager');
create policy anomaly_setting_logs_manager_read on public.anomaly_setting_logs
  for select to authenticated using (app_role() = 'office_manager');

create or replace function public.anomaly_setting(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$ select value from anomaly_settings where key = p_key $$;

create or replace function public.update_anomaly_setting(p_key text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v anomaly_settings%rowtype;
begin
  perform require_office_manager();
  select * into v from anomaly_settings where key = p_key for update;
  if not found then
    raise exception 'ks:not_found' using errcode = 'P0002';
  end if;
  if p_value is null or p_value < v.min_value or p_value > v.max_value then
    raise exception 'ks:setting_out_of_range' using errcode = '22023';
  end if;
  if p_value = v.value then
    return;
  end if;
  update anomaly_settings
     set value = p_value, is_assumption = false, updated_by = auth.uid(), updated_at = now()
   where key = p_key;
  insert into anomaly_setting_logs (key, old_value, new_value, actor_id)
  values (p_key, v.value, p_value, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Anomaly flags: one per entry and rule, with the numbers behind it
-- ---------------------------------------------------------------------------
create table public.anomaly_flags (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.procurement_entries (id),
  rule text not null check (rule in
    ('weight_vs_land', 'repeat_within_hour', 'uniform_moisture', 'weight_pattern_change', 'moisture_pattern_change')),
  -- The values and thresholds the rule used, so the reason can always be explained.
  details jsonb not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'confirmed', 'false_positive')),
  review_note text check (review_note is null or char_length(review_note) <= 500),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (entry_id, rule),
  constraint anomaly_review_has_reviewer check (status = 'open' or (reviewed_by is not null and reviewed_at is not null))
);

create index anomaly_flags_status_idx on public.anomaly_flags (status, created_at desc);

create or replace function public.guard_anomaly_flag()
returns trigger
language plpgsql
as $$
begin
  if (new.entry_id, new.rule, new.details, new.created_at)
     is distinct from (old.entry_id, old.rule, old.details, old.created_at) then
    raise exception 'an anomaly record keeps the values it was raised with';
  end if;
  return new;
end;
$$;
create trigger anomaly_flags_guard before update on public.anomaly_flags
  for each row execute function public.guard_anomaly_flag();
create trigger anomaly_flags_no_delete before delete on public.anomaly_flags
  for each row execute function public.refuse_change();

alter table public.anomaly_flags enable row level security;
-- Read only for managers. Rows are created by the trigger below and reviewed
-- through review_anomaly(); there is deliberately no write policy.
create policy anomaly_flags_manager_read on public.anomaly_flags
  for select to authenticated using (app_role() = 'office_manager');

-- Operators may read the audit trail of their own centre's entries (Part 3);
-- manager review work stays out of it.
drop policy if exists audit_operator_read on public.procurement_audit_logs;
create policy audit_operator_read on public.procurement_audit_logs
  for select to authenticated
  using (
    app_role() = 'centre_operator'
    and action not like 'anomaly\_%'
    and exists (
      select 1 from public.procurement_entries e
       where e.id = entry_id and e.centre_id = app_centre_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. The rules. Pure functions of the entry and the stored history, so the same
--    data always gives the same answer. SECURITY DEFINER because a farmer's
--    history spans centres and an operator's session only sees its own.
-- ---------------------------------------------------------------------------
create or replace function public.anomaly_findings(p public.procurement_entries)
returns table (rule text, details jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_land numeric;
  v_cap numeric;
  v_days integer;
  v_total numeric;
  v_n integer;
  v_other integer;
  v_slips text[];
  v_nearest numeric;
  v_window integer;
  v_range numeric;
  v_min numeric;
  v_max numeric;
  v_hist integer;
  v_median numeric;
  v_mean numeric;
  v_ratio numeric;
  v_shift numeric;
begin
  -- 1. Total weight bought from this farmer for this crop in the season window,
  --    against land area times an assumed ceiling per acre.
  if anomaly_setting('weight_vs_land_enabled') = 1 then
    select land_acres into v_land from farmer_members where id = p.farmer_id;
    v_cap := case p.crop
               when 'soybean' then anomaly_setting('land_max_kg_per_acre_soybean')
               when 'tur' then anomaly_setting('land_max_kg_per_acre_tur') end;
    v_days := anomaly_setting('land_season_days')::integer;
    select coalesce(sum(e.net_kg), 0) + p.net_kg into v_total
      from procurement_entries e
     where e.farmer_id = p.farmer_id and e.crop = p.crop and e.id <> p.id
       and e.approval_status <> 'rejected'
       and e.device_recorded_at <= p.device_recorded_at
       and e.device_recorded_at > p.device_recorded_at - make_interval(days => v_days);
    -- A farmer with no land recorded cannot be judged by this rule.
    if coalesce(v_land, 0) > 0 and coalesce(v_cap, 0) > 0 and v_total > v_land * v_cap then
      return query select 'weight_vs_land'::text, jsonb_build_object(
        'total_kg', v_total, 'this_kg', p.net_kg, 'land_acres', v_land,
        'max_kg_per_acre', v_cap, 'limit_kg', v_land * v_cap, 'window_days', v_days);
    end if;
  end if;

  -- 2. Several entries for the same farmer close together in time.
  if anomaly_setting('repeat_enabled') = 1 then
    v_window := anomaly_setting('repeat_window_minutes')::integer;
    select count(*), array_agg(e.slip_no order by e.device_recorded_at),
           min(abs(extract(epoch from (e.device_recorded_at - p.device_recorded_at))) / 60)
      into v_other, v_slips, v_nearest
      from procurement_entries e
     where e.farmer_id = p.farmer_id and e.id <> p.id and e.approval_status <> 'rejected'
       and abs(extract(epoch from (e.device_recorded_at - p.device_recorded_at))) <= v_window * 60;
    if v_other >= anomaly_setting('repeat_min_other_entries') then
      return query select 'repeat_within_hour'::text, jsonb_build_object(
        'other_entries', v_other, 'other_slips', to_jsonb(v_slips),
        'nearest_minutes', round(v_nearest, 1), 'window_minutes', v_window);
    end if;
  end if;

  -- 3. The last N moisture readings at the centre (this one included) all
  --    within a very narrow range.
  if anomaly_setting('uniform_moisture_enabled') = 1 then
    v_window := anomaly_setting('uniform_window_entries')::integer;
    select count(*), min(m.moisture_pct), max(m.moisture_pct) into v_n, v_min, v_max from (
      select e.moisture_pct from procurement_entries e
       where e.centre_id = p.centre_id and e.id <> p.id and e.approval_status <> 'rejected'
         and e.device_recorded_at <= p.device_recorded_at
       order by e.device_recorded_at desc, e.id
       limit v_window - 1) m;
    if v_n = v_window - 1 then
      v_min := least(v_min, p.moisture_pct);
      v_max := greatest(v_max, p.moisture_pct);
      v_range := v_max - v_min;
      if v_range <= anomaly_setting('uniform_max_range_pct') then
        return query select 'uniform_moisture'::text, jsonb_build_object(
          'readings', v_window, 'min_pct', v_min, 'max_pct', v_max,
          'range_pct', v_range, 'max_range_pct', anomaly_setting('uniform_max_range_pct'));
      end if;
    end if;
  end if;

  -- 4 and 5. This entry against the same farmer's recent entries for the crop.
  if anomaly_setting('weight_pattern_enabled') = 1 or anomaly_setting('moisture_pattern_enabled') = 1 then
    select count(*), percentile_cont(0.5) within group (order by h.net_kg), avg(h.moisture_pct)
      into v_hist, v_median, v_mean from (
      select e.net_kg, e.moisture_pct from procurement_entries e
       where e.farmer_id = p.farmer_id and e.crop = p.crop and e.id <> p.id
         and e.approval_status <> 'rejected' and e.device_recorded_at <= p.device_recorded_at
       order by e.device_recorded_at desc, e.id
       limit anomaly_setting('pattern_history_entries')::integer) h;

    if v_hist >= anomaly_setting('pattern_min_history') then
      v_ratio := anomaly_setting('weight_pattern_ratio');
      if anomaly_setting('weight_pattern_enabled') = 1 and v_median > 0 and p.net_kg > v_median * v_ratio then
        return query select 'weight_pattern_change'::text, jsonb_build_object(
          'this_kg', p.net_kg, 'median_kg', round(v_median, 1), 'ratio', v_ratio, 'history_entries', v_hist);
      end if;
      v_shift := anomaly_setting('moisture_shift_pct');
      if anomaly_setting('moisture_pattern_enabled') = 1 and abs(p.moisture_pct - v_mean) >= v_shift then
        return query select 'moisture_pattern_change'::text, jsonb_build_object(
          'this_pct', p.moisture_pct, 'mean_pct', round(v_mean, 1), 'shift_pct', v_shift, 'history_entries', v_hist);
      end if;
    end if;
  end if;
end;
$$;

-- Runs after the server's own checks (triggers fire in name order): adds the
-- anomaly reasons to the entry's flags and holds it. It never rejects.
create or replace function public.flag_entry_anomalies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules text[];
begin
  select coalesce(array_agg(f.rule order by f.rule), '{}') into v_rules from anomaly_findings(new) f;
  if cardinality(v_rules) > 0 then
    new.flag_reasons := (select array_agg(distinct x order by x) from unnest(new.flag_reasons || v_rules) x);
    new.approval_status := 'held';
  end if;
  return new;
end;
$$;

create trigger procurement_entries_flag_anomalies
  before insert on public.procurement_entries
  for each row execute function public.flag_entry_anomalies();

-- Once the entry exists, writes one review flag per rule with its explanation
-- values, and an audit line for each.
create or replace function public.record_entry_anomalies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  for f in select * from anomaly_findings(new) loop
    insert into anomaly_flags (entry_id, rule, details) values (new.id, f.rule, f.details);
    insert into procurement_audit_logs (entry_id, actor_id, action, new_values, created_at)
    values (new.id, null, 'anomaly_flagged',
            jsonb_build_object('rule', f.rule, 'details', f.details), clock_timestamp());
  end loop;
  return new;
end;
$$;

create trigger procurement_entries_record_anomalies
  after insert on public.procurement_entries
  for each row execute function public.record_entry_anomalies();

-- ---------------------------------------------------------------------------
-- 4. Review of one anomaly. Managers only; every action is audited.
-- ---------------------------------------------------------------------------
create or replace function public.review_anomaly(p_flag_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v anomaly_flags%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_status text;
begin
  perform require_office_manager();
  if p_action not in ('reviewed', 'confirmed', 'false_positive', 'note') then
    raise exception 'ks:bad_action' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'ks:reason_required' using errcode = '22023';
  end if;
  -- Calling an anomaly real, or dismissing it, needs a reason a colleague can read later.
  if p_action in ('confirmed', 'false_positive', 'note') and (v_note is null or char_length(v_note) < 5) then
    raise exception 'ks:reason_required' using errcode = '22023';
  end if;

  select * into v from anomaly_flags where id = p_flag_id for update;
  if not found then
    raise exception 'ks:not_found' using errcode = 'P0002';
  end if;

  v_status := case p_action when 'note' then v.status else p_action end;
  update anomaly_flags
     set status = v_status,
         review_note = coalesce(v_note, review_note),
         reviewed_by = case when p_action = 'note' then reviewed_by else auth.uid() end,
         reviewed_at = case when p_action = 'note' then reviewed_at else now() end
   where id = p_flag_id;

  insert into procurement_audit_logs (entry_id, actor_id, action, old_values, new_values, created_at)
  values (v.entry_id, auth.uid(), 'anomaly_' || p_action,
          jsonb_build_object('rule', v.rule, 'status', v.status, 'note', v.review_note),
          jsonb_build_object('rule', v.rule, 'status', v_status, 'note', coalesce(v_note, v.review_note)),
          clock_timestamp());
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Approval and payment respect open anomalies (see the comments inside)
-- ---------------------------------------------------------------------------
create or replace function public.review_entry(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry procurement_entries%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if app_role() is distinct from 'office_manager' then
    raise exception 'only office managers can review entries' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'hold', 'reject') then
    raise exception 'decision must be approve, hold or reject' using errcode = '22023';
  end if;
  if p_decision <> 'approve' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'a reason of at least 5 characters is required' using errcode = '22023';
  end if;

  select * into v_entry from procurement_entries where id = p_id for update;
  if not found then
    raise exception 'entry not found' using errcode = 'P0002';
  end if;
  if v_entry.payment_status in ('in_run', 'paid') then
    raise exception 'entry is already in a payment run' using errcode = '23514';
  end if;

  -- Approving means a person has looked at every anomaly on the entry. An
  -- anomaly still open keeps the payment on hold; one the manager confirmed
  -- needs a written reason before the purchase is paid anyway.
  if p_decision = 'approve' then
    if exists (select 1 from anomaly_flags f where f.entry_id = p_id and f.status = 'open') then
      raise exception 'ks:anomaly_open' using errcode = '23514';
    end if;
    if exists (select 1 from anomaly_flags f where f.entry_id = p_id and f.status = 'confirmed')
       and (v_note is null or char_length(v_note) < 5) then
      raise exception 'ks:note_required_confirmed' using errcode = '22023';
    end if;
  end if;

  update procurement_entries
     set approval_status = case p_decision
           when 'approve' then 'approved'::approval_status
           when 'hold' then 'held'::approval_status
           else 'rejected'::approval_status end,
         flag_reasons = case
           when p_decision = 'hold' and not ('manual_hold' = any (flag_reasons))
             then array_append(flag_reasons, 'manual_hold')
           else flag_reasons end,
         review_note = v_note
   where id = p_id;
end;
$$;

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
       -- An anomaly nobody has looked at yet keeps the payment on hold, even if
       -- the entry was approved before the anomaly was recorded.
       and not exists (select 1 from anomaly_flags f where f.entry_id = e.id and f.status = 'open')
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

-- ---------------------------------------------------------------------------
-- 6. What the operator accepted from an AI reading. No image is stored.
-- ---------------------------------------------------------------------------
alter table public.procurement_entries
  add column reading_meta jsonb
    check (reading_meta is null or (jsonb_typeof(reading_meta) = 'object' and pg_column_size(reading_meta) < 2000));

create or replace function public.guard_reading_meta()
returns trigger
language plpgsql
as $$
begin
  if new.reading_meta is distinct from old.reading_meta then
    raise exception 'how a reading was taken cannot change after the entry is recorded';
  end if;
  return new;
end;
$$;
create trigger procurement_entries_guard_reading_meta
  before update on public.procurement_entries
  for each row execute function public.guard_reading_meta();

-- ---------------------------------------------------------------------------
-- 7. Permissions
-- ---------------------------------------------------------------------------
revoke all on function public.review_anomaly(uuid, text, text) from public, anon;
revoke all on function public.update_anomaly_setting(text, numeric) from public, anon;
revoke all on function public.anomaly_findings(public.procurement_entries) from public, anon, authenticated;
revoke all on function public.anomaly_setting(text) from public, anon, authenticated;
revoke all on function public.review_entry(uuid, text, text) from public, anon;
revoke all on function public.create_payment_run(date, date, uuid[]) from public, anon;
grant execute on function public.review_anomaly(uuid, text, text) to authenticated;
grant execute on function public.update_anomaly_setting(text, numeric) to authenticated;
grant execute on function public.review_entry(uuid, text, text) to authenticated;
grant execute on function public.create_payment_run(date, date, uuid[]) to authenticated;
