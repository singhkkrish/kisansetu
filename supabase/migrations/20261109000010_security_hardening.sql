-- Security hardening found in the final review.
--
-- 1. Bank details: managers could write farmer_bank_accounts directly through the
--    API with their own login, skipping register_farmer / update_farmer (which
--    validate the account, reset verification and write the audit trail). The
--    application never needs that, so managers keep read access only and every
--    change goes through those SECURITY DEFINER functions.
drop policy if exists bank_manager_only on public.farmer_bank_accounts;
create policy bank_manager_read on public.farmer_bank_accounts
  for select to authenticated
  using (app_role() = 'office_manager');

-- 2. Functions created without an explicit revoke were executable by everyone,
--    including signed-out callers. The ones that act for a person already
--    refuse the wrong caller, but there is no reason to leave them callable.
revoke all on function public.allocate_slip_block(uuid, text, integer) from public, anon;
grant execute on function public.allocate_slip_block(uuid, text, integer) to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.log_price_change() from public, anon, authenticated;
revoke all on function public.log_procurement_change() from public, anon, authenticated;
revoke all on function public.mirror_live_price() from public, anon, authenticated;
revoke all on function public.sync_member_bank_status() from public, anon, authenticated;
revoke all on function public.flag_entry_anomalies() from public, anon, authenticated;
revoke all on function public.record_entry_anomalies() from public, anon, authenticated;
