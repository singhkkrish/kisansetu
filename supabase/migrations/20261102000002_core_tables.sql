-- Reference data: centres, staff profiles, farmer members, daily prices.
-- No Aadhaar number is stored anywhere in this schema.

create table public.centres (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^C[0-9]{2}$'),
  name text not null,
  village text not null,
  district text not null default 'Latur',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.user_role not null,
  centre_id uuid references public.centres (id),
  phone text,
  preferred_lang text not null default 'mr' check (preferred_lang in ('mr', 'en')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Operators always belong to a centre; office staff do not.
  constraint operator_has_centre check (role <> 'centre_operator' or centre_id is not null)
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create table public.farmer_members (
  id uuid primary key default gen_random_uuid(),
  member_code text not null unique check (member_code ~ '^FM[0-9]{5}$'),
  full_name text not null,
  village text not null,
  phone text check (phone is null or phone ~ '^[6-9][0-9]{9}$'),
  land_acres numeric(8, 2) not null default 0 check (land_acres >= 0),
  active boolean not null default true,
  -- DPDP Act 2023: record when the member consented to data processing.
  consent_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index farmer_members_village_idx on public.farmer_members (village);
create index farmer_members_name_idx on public.farmer_members (lower(full_name));

create trigger farmer_members_touch_updated_at
  before update on public.farmer_members
  for each row execute function public.touch_updated_at();

-- Bank details live in their own table so that centre operators never
-- receive them. Only office managers can read this table.
create table public.farmer_bank_accounts (
  member_id uuid primary key references public.farmer_members (id) on delete cascade,
  holder_name text not null,
  account_number text not null check (account_number ~ '^[0-9]{9,18}$'),
  ifsc text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  constraint verified_has_timestamp check (not verified or verified_at is not null)
);

create trigger farmer_bank_accounts_touch_updated_at
  before update on public.farmer_bank_accounts
  for each row execute function public.touch_updated_at();

create table public.daily_prices (
  id uuid primary key default gen_random_uuid(),
  price_date date not null,
  crop public.crop_type not null,
  grade public.grade_type not null,
  rate_per_quintal numeric(10, 2) not null check (rate_per_quintal > 0),
  set_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (price_date, crop, grade)
);

create index daily_prices_lookup_idx on public.daily_prices (price_date desc, crop, grade);
