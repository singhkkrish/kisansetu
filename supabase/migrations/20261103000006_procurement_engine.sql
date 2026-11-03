-- Offline procurement engine: server-authoritative timestamps and flags, a fuller
-- audit trail, controlled review of entries, and a guard against silent edits.

alter table public.procurement_entries
  -- The phone's estimate of (server time - device time) from its last contact
  -- with the server. Advisory, and covered by the entry's hash.
  add column device_clock_offset_ms integer
    check (device_clock_offset_ms is null or abs(device_clock_offset_ms) <= 86400000),
  add column review_note text
    check (review_note is null or char_length(review_note) <= 500);

-- On every insert the server decides what the phone cannot be trusted to say:
-- when the entry arrived, its sync state, its payment state, and whether it
-- needs review. This holds even if someone calls the API directly instead of
-- using the app, so a client cannot insert an entry as already approved.
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

  -- Rate of the day, judged on the day the produce was weighed. The phone's
  -- clock is only an unverified claim, so it is corrected by the offset the
  -- phone measured against the server. A large offset is flagged below.
  v_day := ((new.device_recorded_at
             + make_interval(secs => coalesce(new.device_clock_offset_ms, 0) / 1000.0))
            at time zone 'Asia/Kolkata')::date;

  select rate_per_quintal into v_rate
    from daily_prices
   where price_date = v_day and crop = new.crop and grade = new.grade;

  if v_rate is null then
    v_flags := array_append(v_flags, 'no_price_for_day');
  elsif v_rate <> new.rate_per_quintal then
    v_flags := array_append(v_flags, 'rate_mismatch');
  end if;

  if new.device_recorded_at > now() + interval '10 minutes' then
    v_flags := array_append(v_flags, 'clock_ahead');
  end if;
  if abs(coalesce(new.device_clock_offset_ms, 0)) > 900000 then
    v_flags := array_append(v_flags, 'clock_skew');
  end if;

  -- Keep any flag the application already found (for example chain_gap).
  new.flag_reasons := coalesce(
    (select array_agg(distinct f order by f) from unnest(new.flag_reasons || v_flags) f), '{}');

  -- Flagged entries are held for review. The purchase itself stays valid.
  new.approval_status := case when cardinality(new.flag_reasons) > 0 then 'held' else 'approved' end;
  return new;
end;
$$;

create trigger procurement_entries_enforce_integrity
  before insert on public.procurement_entries
  for each row execute function public.enforce_entry_integrity();

-- Purchase facts, including the server timestamp, can never change after the fact.
create or replace function public.guard_procurement_update()
returns trigger
language plpgsql
as $$
begin
  if (new.client_id, new.slip_no, new.farmer_id, new.centre_id, new.operator_id,
      new.crop, new.grade, new.gross_kg, new.tare_kg, new.moisture_pct,
      new.net_kg, new.rate_per_quintal, new.amount, new.device_id,
      new.device_recorded_at, new.server_received_at, new.device_clock_offset_ms,
      new.payload_hash, new.prev_hash)
     is distinct from
     (old.client_id, old.slip_no, old.farmer_id, old.centre_id, old.operator_id,
      old.crop, old.grade, old.gross_kg, old.tare_kg, old.moisture_pct,
      old.net_kg, old.rate_per_quintal, old.amount, old.device_id,
      old.device_recorded_at, old.server_received_at, old.device_clock_offset_ms,
      old.payload_hash, old.prev_hash)
  then
    raise exception 'procurement facts are immutable once recorded';
  end if;
  return new;
end;
$$;

-- Audit trail: who created the entry, where, the phone's claimed time, the
-- server's time, and every later change to its review or payment state.
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

-- Operators may read the audit trail of their own centre's entries.
create policy audit_operator_read on public.procurement_audit_logs
  for select to authenticated
  using (
    app_role() = 'centre_operator'
    and exists (
      select 1 from public.procurement_entries e
       where e.id = entry_id and e.centre_id = app_centre_id()
    )
  );

-- The only way an entry's approval changes. Managers only, with a written
-- reason for anything other than approval, and never once payment has begun.
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

revoke all on function public.review_entry(uuid, text, text) from public, anon;
grant execute on function public.review_entry(uuid, text, text) to authenticated;
