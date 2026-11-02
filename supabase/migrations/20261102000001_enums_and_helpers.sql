-- Enumerated types shared across the schema.

create type public.user_role as enum ('centre_operator', 'office_manager');
create type public.crop_type as enum ('soybean', 'tur');
create type public.grade_type as enum ('A', 'B', 'C');

-- Where an entry stands in the offline -> server pipeline.
create type public.sync_status as enum ('pending', 'synced', 'rejected');

-- 'held' means an anomaly flag is waiting for manager review. The purchase
-- itself stays valid; only payment is paused.
create type public.approval_status as enum ('approved', 'held', 'rejected');

create type public.payment_status as enum ('unpaid', 'in_run', 'paid', 'failed');
create type public.payment_run_status as enum ('draft', 'file_generated', 'submitted', 'completed');
create type public.payment_item_status as enum ('queued', 'paid', 'failed');
create type public.sync_outcome as enum ('accepted', 'duplicate', 'rejected', 'flagged');

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
