-- Sample procurement for the payment run and stock dashboard demos: about three
-- days of soybean and tur purchases at centres C07 and C12, using the same
-- hash chain as the app. Run AFTER seed.sql and seed_procurement.sql, and after
-- creating centre operator logins for C07 and C12 (npm run staff:create).
-- Dates are relative to today (India time), so the demo never goes stale.
-- Safe to run more than once: slips that already exist are skipped.
--
-- What it sets up for the workflow:
--   * most entries are approved and unpaid, so a payment run has something to group;
--   * one entry carries a rate different from the published one, so it is held
--     for review (flagged, never cancelled);
--   * FM00104 has an unverified bank account, so that farmer shows up as "cannot
--     be paid yet" in the payment preview.

insert into public.daily_prices (price_date, crop, grade, rate_per_quintal)
select public.ist_today() - d, c.crop::public.crop_type, 'A', c.rate
  from generate_series(0, 3) d
 cross join (values ('soybean', 4850.00), ('tur', 7200.00)) as c (crop, rate)
on conflict (price_date, crop, grade) do nothing;

insert into public.slip_counters (centre_id, last_no)
select id, case code when 'C07' then 24560 else 8920 end
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
  v_prev_at timestamptz;
  v_hash text;
  v_when text;
  v_at timestamptz;
  v_net numeric;
  v_amount numeric;
begin
  for rec in
    select * from (values
      -- slip, member, crop, gross, tare, moisture, days ago, IST time, rate
      ('C07-24521', 'FM00101', 'soybean', 1420.0, 20.0, 11.0, 3, '06:05', 4850.00),
      ('C07-24522', 'FM00102', 'soybean',  910.0, 12.0, 13.0, 3, '06:30', 4850.00),
      ('C07-24523', 'FM00103', 'soybean',  640.0, 10.0, 12.0, 3, '07:10', 4850.00),
      ('C07-24524', 'FM00105', 'tur',      780.0, 11.0, 10.0, 3, '07:45', 7200.00),
      ('C07-24525', 'FM00101', 'soybean', 1100.0, 15.0, 12.5, 2, '06:00', 4850.00),
      ('C07-24526', 'FM00104', 'tur',      420.0,  8.0,  9.5, 2, '06:40', 7200.00),
      ('C07-24527', 'FM00105', 'soybean', 1680.0, 22.0, 14.0, 2, '07:20', 4850.00),
      ('C07-24528', 'FM00102', 'soybean',  530.0,  9.0, 11.0, 2, '08:05', 4900.00),
      ('C07-24529', 'FM00103', 'soybean',  760.0, 10.0, 12.0, 1, '06:15', 4850.00),
      ('C07-24530', 'FM00101', 'tur',      610.0, 10.0, 10.0, 1, '07:00', 7200.00),
      ('C07-24531', 'FM00105', 'soybean',  980.0, 14.0, 13.0, 1, '07:35', 4850.00),
      ('C12-08891', 'FM00118', 'soybean', 1330.0, 18.0, 11.5, 3, '06:20', 4850.00),
      ('C12-08892', 'FM00119', 'soybean',  720.0, 10.0, 12.0, 3, '06:55', 4850.00),
      ('C12-08893', 'FM00121', 'tur',      900.0, 12.0, 10.0, 3, '07:30', 7200.00),
      ('C12-08894', 'FM00203', 'tur',      540.0,  9.0,  9.0, 2, '06:10', 7200.00),
      ('C12-08895', 'FM00118', 'soybean', 1210.0, 16.0, 12.0, 2, '06:50', 4850.00),
      ('C12-08896', 'FM00121', 'soybean', 1520.0, 20.0, 13.5, 2, '07:25', 4850.00),
      ('C12-08897', 'FM00119', 'soybean',  690.0, 10.0, 11.0, 1, '06:05', 4850.00),
      ('C12-08898', 'FM00203', 'tur',      480.0,  8.0, 10.0, 1, '06:45', 7200.00),
      ('C12-08899', 'FM00121', 'tur',      830.0, 11.0, 10.5, 1, '07:15', 7200.00),
      ('C12-08900', 'FM00118', 'soybean',  940.0, 13.0, 12.0, 0, '05:10', 4850.00)
    ) as t (slip, member, crop, gross, tare, moisture, ago, hhmm, rate)
    order by ago desc, hhmm
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
    v_client := md5('kisansetu-stock-sample-' || rec.slip)::uuid;
    v_at := ((public.ist_today() - rec.ago)::text || ' ' || rec.hhmm || ':00+05:30')::timestamptz;

    -- Same device as the earlier samples, so the hash chain continues. An entry
    -- never sorts before the one it chains to.
    select payload_hash, device_recorded_at into v_prev, v_prev_at
      from public.procurement_entries
     where device_id = 'seed-device-' || lower(left(rec.slip, 3))
     order by device_recorded_at desc limit 1;
    if v_prev_at is not null then
      v_at := greatest(v_at, v_prev_at + interval '1 minute');
    end if;
    v_when := to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    v_net := round((rec.gross - rec.tare) * (1 - greatest(rec.moisture - 12, 0) / 100), 1);
    v_amount := round(v_net * rec.rate / 100, 2);
    v_hash := encode(sha256(convert_to(format(
      '{"clientId":"%s","slipNo":"%s","farmerId":"%s","centreId":"%s","operatorId":"%s",'
      '"crop":"%s","grade":"%s","grossKg":"%s","tareKg":"%s","moisturePct":"%s","netKg":"%s",'
      '"ratePerQuintal":"%s","amount":"%s","deviceId":"%s","deviceRecordedAt":"%s",'
      '"prevHash":%s,"clockOffsetMs":null}',
      v_client, rec.slip, v_farmer, v_centre, v_operator,
      rec.crop, 'A', to_char(rec.gross, 'FM9999990.0'), to_char(rec.tare, 'FM9999990.0'),
      to_char(rec.moisture, 'FM990.0'), to_char(v_net, 'FM9999990.0'),
      to_char(rec.rate, 'FM9999990.00'), to_char(v_amount, 'FM99999999990.00'),
      'seed-device-' || lower(left(rec.slip, 3)), v_when,
      case when v_prev is null then 'null' else '"' || v_prev || '"' end
    ), 'UTF8')), 'hex');

    insert into public.procurement_entries
      (client_id, slip_no, farmer_id, centre_id, operator_id, crop, grade,
       gross_kg, tare_kg, moisture_pct, net_kg, rate_per_quintal, amount,
       device_id, device_recorded_at, payload_hash, prev_hash, rate_price_date, rate_version)
    values
      (v_client, rec.slip, v_farmer, v_centre, v_operator, rec.crop::public.crop_type, 'A',
       rec.gross, rec.tare, rec.moisture, v_net, rec.rate, v_amount,
       'seed-device-' || lower(left(rec.slip, 3)), v_at, v_hash, v_prev,
       null, null);
  end loop;
end;
$$;
