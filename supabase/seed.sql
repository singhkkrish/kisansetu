-- Development seed data based on the sample slips from the client brief.
-- Bank details below are placeholders for a mock payment flow only.

insert into public.centres (code, name, village, district) values
  ('C07', 'Ganjur Collection Centre', 'Ganjur', 'Latur'),
  ('C12', 'Murud Collection Centre', 'Murud', 'Latur')
on conflict (code) do nothing;

insert into public.farmer_members
  (member_code, full_name, village, phone, land_acres, consent_recorded_at)
values
  ('FM00101', 'Sunil Jadhav',  'Ganjur', '9000000101', 14.50, now()),
  ('FM00102', 'Kamal Shinde',  'Ganjur', '9000000102',  9.00, now()),
  ('FM00203', 'Mohan Biradar', 'Murud',  '9000000203', 11.25, now())
on conflict (member_code) do nothing;

insert into public.farmer_bank_accounts
  (member_id, holder_name, account_number, ifsc, verified, verified_at)
select m.id, m.full_name, b.acc, 'MOCK0000001', true, now()
from public.farmer_members m
join (values
  ('FM00101', '000000000101'),
  ('FM00102', '000000000102'),
  ('FM00203', '000000000203')
) as b (code, acc) on b.code = m.member_code
on conflict (member_id) do nothing;

insert into public.daily_prices (price_date, crop, grade, rate_per_quintal) values
  (current_date, 'soybean', 'A', 4850.00),
  (current_date, 'tur',     'A', 7200.00)
on conflict (price_date, crop, grade) do nothing;
