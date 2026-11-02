-- Member registry: centre, crop eligibility, bank verification status, audit
-- trail, and write functions that keep a member and their bank account
-- consistent. Still no Aadhaar number anywhere.

alter table public.farmer_members
  add column centre_id uuid references public.centres (id),
  add column crops public.crop_type[] not null
    default array['soybean', 'tur']::public.crop_type[],
  -- Mirrors farmer_bank_accounts.verified so centre operators can see the
  -- status without ever being able to read the bank details themselves.
  add column bank_verified boolean not null default false,
  add constraint farmer_has_crops check (cardinality(crops) > 0);

create index farmer_members_centre_idx on public.farmer_members (centre_id);

-- Existing rows: attach the centre that sits in the member's own village.
update public.farmer_members m
   set centre_id = c.id
  from public.centres c
 where m.centre_id is null and lower(c.village) = lower(m.village);

alter table public.farmer_bank_accounts
  add column updated_by uuid references public.profiles (id);

update public.farmer_members m
   set bank_verified = b.verified
  from public.farmer_bank_accounts b
 where b.member_id = m.id;

-- Keep farmer_members.bank_verified in step with the bank table.
create or replace function public.sync_member_bank_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update farmer_members set bank_verified = false where id = old.member_id;
    return old;
  end if;
  update farmer_members set bank_verified = new.verified where id = new.member_id;
  return new;
end;
$$;

create trigger farmer_bank_accounts_sync_status
  after insert or update or delete on public.farmer_bank_accounts
  for each row execute function public.sync_member_bank_status();

-- Changing the account, IFSC or holder invalidates an earlier verification, no
-- matter which code path made the change.
create or replace function public.reset_bank_verification()
returns trigger
language plpgsql
as $$
begin
  if (new.account_number, new.ifsc, new.holder_name)
       is distinct from (old.account_number, old.ifsc, old.holder_name)
     and new.verified is not distinct from old.verified then
    new.verified := false;
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;

create trigger farmer_bank_accounts_reset_verification
  before update on public.farmer_bank_accounts
  for each row execute function public.reset_bank_verification();

-- Distinct villages for the registry filter. Runs with the caller's rights.
create view public.farmer_villages with (security_invoker = true) as
  select distinct village from public.farmer_members;

-- Audit trail. Field names only: bank values are never copied here.
create table public.member_audit_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.farmer_members (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  action text not null
    check (action in ('registered', 'updated', 'bank_changed', 'bank_verified')),
  changed_fields text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index member_audit_logs_member_idx
  on public.member_audit_logs (member_id, created_at desc);

alter table public.member_audit_logs enable row level security;

-- Written only by the functions below; managers can read.
create policy member_audit_manager_read on public.member_audit_logs
  for select to authenticated using (app_role() = 'office_manager');

-- Write functions -------------------------------------------------------------
-- SECURITY DEFINER with an explicit role check, so the member row, bank row and
-- audit entry are written together and only by an office manager.

create or replace function public.register_farmer(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text;
  v_bank jsonb := p -> 'bank';
begin
  if app_role() is distinct from 'office_manager' then
    raise exception 'only office managers can register farmers' using errcode = '42501';
  end if;

  -- Serialise code allocation so two managers cannot receive the same ID.
  perform pg_advisory_xact_lock(hashtext('farmer_member_code'));
  select 'FM' || lpad((coalesce(max(substr(member_code, 3)::int), 0) + 1)::text, 5, '0')
    into v_code
    from farmer_members;

  insert into farmer_members
    (member_code, full_name, village, centre_id, phone, land_acres, crops, active,
     consent_recorded_at)
  values
    (v_code, p ->> 'full_name', p ->> 'village', (p ->> 'centre_id')::uuid,
     nullif(p ->> 'phone', ''), (p ->> 'land_acres')::numeric,
     array(select jsonb_array_elements_text(p -> 'crops'))::public.crop_type[],
     coalesce((p ->> 'active')::boolean, true), now())
  returning id into v_id;

  if jsonb_typeof(v_bank) = 'object' then
    insert into farmer_bank_accounts (member_id, holder_name, account_number, ifsc, updated_by)
    values (v_id, v_bank ->> 'holder_name', v_bank ->> 'account_number',
            upper(v_bank ->> 'ifsc'), auth.uid());
  end if;

  insert into member_audit_logs (member_id, actor_id, action)
  values (v_id, auth.uid(), 'registered');

  return jsonb_build_object('id', v_id, 'member_code', v_code);
end;
$$;

create or replace function public.update_farmer(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old farmer_members%rowtype;
  v_old_bank farmer_bank_accounts%rowtype;
  v_bank jsonb := p -> 'bank';
  v_new_crops public.crop_type[] :=
    array(select jsonb_array_elements_text(p -> 'crops'))::public.crop_type[];
  v_changed text[] := '{}';
  v_bank_changed boolean := false;
  v_new_number text;
begin
  if app_role() is distinct from 'office_manager' then
    raise exception 'only office managers can edit farmers' using errcode = '42501';
  end if;

  select * into v_old from farmer_members where id = p_id for update;
  if not found then
    raise exception 'farmer not found' using errcode = 'P0002';
  end if;

  if v_old.full_name is distinct from p ->> 'full_name' then v_changed := array_append(v_changed, 'full_name'); end if;
  if v_old.village is distinct from p ->> 'village' then v_changed := array_append(v_changed, 'village'); end if;
  if v_old.centre_id is distinct from (p ->> 'centre_id')::uuid then v_changed := array_append(v_changed, 'centre'); end if;
  if v_old.phone is distinct from nullif(p ->> 'phone', '') then v_changed := array_append(v_changed, 'phone'); end if;
  if v_old.land_acres is distinct from (p ->> 'land_acres')::numeric then v_changed := array_append(v_changed, 'land_acres'); end if;
  if v_old.crops is distinct from v_new_crops then v_changed := array_append(v_changed, 'crops'); end if;
  if v_old.active is distinct from (p ->> 'active')::boolean then v_changed := array_append(v_changed, 'active'); end if;

  update farmer_members
     set full_name = p ->> 'full_name',
         village = p ->> 'village',
         centre_id = (p ->> 'centre_id')::uuid,
         phone = nullif(p ->> 'phone', ''),
         land_acres = (p ->> 'land_acres')::numeric,
         crops = v_new_crops,
         active = (p ->> 'active')::boolean
   where id = p_id;

  if jsonb_typeof(v_bank) = 'object' then
    select * into v_old_bank from farmer_bank_accounts where member_id = p_id;
    v_new_number := nullif(v_bank ->> 'account_number', '');

    if v_new_number is not null then
      insert into farmer_bank_accounts (member_id, holder_name, account_number, ifsc, updated_by)
      values (p_id, v_bank ->> 'holder_name', v_new_number, upper(v_bank ->> 'ifsc'), auth.uid())
      on conflict (member_id) do update
        set holder_name = excluded.holder_name,
            account_number = excluded.account_number,
            ifsc = excluded.ifsc,
            updated_by = excluded.updated_by;
    else
      -- No new number supplied: keep the stored one, update the rest.
      update farmer_bank_accounts
         set holder_name = v_bank ->> 'holder_name',
             ifsc = upper(v_bank ->> 'ifsc'),
             updated_by = auth.uid()
       where member_id = p_id;
      if not found then
        raise exception 'account number is required when adding bank details'
          using errcode = '22023';
      end if;
    end if;

    v_bank_changed := v_old_bank.member_id is null
      or v_old_bank.holder_name is distinct from v_bank ->> 'holder_name'
      or v_old_bank.ifsc is distinct from upper(v_bank ->> 'ifsc')
      or (v_new_number is not null and v_old_bank.account_number is distinct from v_new_number);
  end if;

  if cardinality(v_changed) > 0 then
    insert into member_audit_logs (member_id, actor_id, action, changed_fields)
    values (p_id, auth.uid(), 'updated', v_changed);
  end if;
  if v_bank_changed then
    insert into member_audit_logs (member_id, actor_id, action, changed_fields)
    values (p_id, auth.uid(), 'bank_changed', array['bank_account']);
  end if;
end;
$$;

create or replace function public.verify_farmer_bank(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_role() is distinct from 'office_manager' then
    raise exception 'only office managers can verify bank accounts' using errcode = '42501';
  end if;

  update farmer_bank_accounts
     set verified = true, verified_at = now(), verified_by = auth.uid()
   where member_id = p_id;
  if not found then
    raise exception 'no bank account to verify' using errcode = 'P0002';
  end if;

  insert into member_audit_logs (member_id, actor_id, action)
  values (p_id, auth.uid(), 'bank_verified');
end;
$$;

revoke all on function public.register_farmer(jsonb) from public, anon;
revoke all on function public.update_farmer(uuid, jsonb) from public, anon;
revoke all on function public.verify_farmer_bank(uuid) from public, anon;
grant execute on function public.register_farmer(jsonb) to authenticated;
grant execute on function public.update_farmer(uuid, jsonb) to authenticated;
grant execute on function public.verify_farmer_bank(uuid) to authenticated;
