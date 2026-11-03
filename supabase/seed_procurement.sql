-- Sample procurement entries from the client brief. Run this AFTER seed.sql and
-- AFTER creating a centre operator login for centres C07 and C12 (see the README:
-- npm run staff:create). An entry needs a real operator to belong to, so a centre
-- without one is skipped with a notice. Safe to run more than once.
--
-- Each entry carries a SHA-256 hash built the same way the app builds it, so the
-- sample slips look exactly like entries that arrived from a phone.

insert into public.daily_prices (price_date, crop, grade, rate_per_quintal) values
  ('2026-11-02', 'soybean', 'A', 4850.00),
  ('2026-11-02', 'tur',     'A', 7200.00)
on conflict (price_date, crop, grade) do nothing;

-- New slip blocks must start after the sample slips.
insert into public.slip_counters (centre_id, last_no)
select id, case code when 'C07' then 24520 else 8880 end
  from public.centres where code in ('C07', 'C12')
on conflict (centre_id) do update set last_no = greatest(slip_counters.last_no, excluded.last_no);

do $$
declare
  rec record;
  v_operator uuid;
  v_centre uuid;
  v_farmer uuid;
  v_client uuid;
  v_prev text;
  v_hash text;
  v_when text;
begin
  for rec in
    select * from (values
      ('C07-24518', 'FM00101', 'soybean', 'A', '1250.0', '18.0', '11.5', '1232.0', '4850.00', '59752.00',
       'seed-device-c07', '2026-11-02 06:10:00+05:30'::timestamptz),
      ('C07-24519', 'FM00102', 'soybean', 'A', '860.0', '12.0', '14.0', '831.0', '4850.00', '40303.50',
       'seed-device-c07', '2026-11-02 06:25:00+05:30'::timestamptz),
      ('C12-08876', 'FM00203', 'tur', 'A', '640.0', '10.0', '10.0', '630.0', '7200.00', '45360.00',
       'seed-device-c12', '2026-11-02 06:40:00+05:30'::timestamptz)
    ) as t (slip, member, crop, grade, gross, tare, moisture, net, rate, amount, device, at_time)
    order by at_time
  loop
    continue when exists (select 1 from public.procurement_entries where slip_no = rec.slip);

    select c.id into v_centre from public.centres c where c.code = left(rec.slip, 3);
    select p.id into v_operator
      from public.profiles p
     where p.centre_id = v_centre and p.role = 'centre_operator' and p.active
     order by p.created_at limit 1;
    if v_operator is null then
      raise notice 'No centre operator for % yet; skipped %', left(rec.slip, 3), rec.slip;
      continue;
    end if;

    select id into v_farmer from public.farmer_members where member_code = rec.member;
    v_client := md5('kisansetu-sample-' || rec.slip)::uuid;
    v_when := to_char(rec.at_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    select payload_hash into v_prev
      from public.procurement_entries
     where device_id = rec.device
     order by device_recorded_at desc limit 1;

    v_hash := encode(sha256(convert_to(format(
      '{"clientId":"%s","slipNo":"%s","farmerId":"%s","centreId":"%s","operatorId":"%s",'
      '"crop":"%s","grade":"%s","grossKg":"%s","tareKg":"%s","moisturePct":"%s","netKg":"%s",'
      '"ratePerQuintal":"%s","amount":"%s","deviceId":"%s","deviceRecordedAt":"%s",'
      '"prevHash":%s,"clockOffsetMs":null}',
      v_client, rec.slip, v_farmer, v_centre, v_operator,
      rec.crop, rec.grade, rec.gross, rec.tare, rec.moisture, rec.net,
      rec.rate, rec.amount, rec.device, v_when,
      case when v_prev is null then 'null' else '"' || v_prev || '"' end
    ), 'UTF8')), 'hex');

    insert into public.procurement_entries
      (client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade,
       gross_kg, tare_kg, moisture_pct, net_kg, rate_per_quintal, amount,
       device_id, device_recorded_at, payload_hash, prev_hash)
    values
      (v_client, rec.slip, v_farmer, v_centre, v_operator, rec.crop::public.crop_type, rec.grade::public.grade_type,
       rec.gross::numeric, rec.tare::numeric, rec.moisture::numeric, rec.net::numeric,
       rec.rate::numeric, rec.amount::numeric,
       rec.device, rec.at_time, v_hash, v_prev);
  end loop;
end;
$$;
