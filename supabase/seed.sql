-- Development seed data. Every name, phone number and account below is
-- fictional. Bank account numbers are random digits and do not belong to anyone.
-- Re-running this file is safe: existing rows are left as they are.

insert into public.centres (code, name, village, district) values
  ('C01', 'Harangul Collection Centre', 'Harangul', 'Latur'),
  ('C03', 'Tondar Collection Centre', 'Tondar', 'Latur'),
  ('C07', 'Ganjur Collection Centre', 'Ganjur', 'Latur'),
  ('C09', 'Kharola Collection Centre', 'Kharola', 'Latur'),
  ('C12', 'Murud Collection Centre', 'Murud', 'Latur'),
  ('C15', 'Gategaon Collection Centre', 'Gategaon', 'Latur'),
  ('C18', 'Bhada Collection Centre', 'Bhada', 'Latur'),
  ('C21', 'Hasegaon Collection Centre', 'Hasegaon', 'Latur')
on conflict (code) do nothing;

insert into public.farmer_members
  (member_code, full_name, village, centre_id, phone, land_acres, crops, active, consent_recorded_at)
select v.code, v.name, v.village, c.id, v.phone, v.acres::numeric, v.crops::public.crop_type[],
       v.active, now()
from (values
  ('FM00101', 'Sunil Jadhav', 'Ganjur', 'C07', '9000000101', '14.50', '{soybean,tur}', true),
  ('FM00102', 'Kamal Shinde', 'Ganjur', 'C07', '9000000102', '9.00', '{soybean}', true),
  ('FM00103', 'Ramesh Patil', 'Sarola', 'C07', '9000000103', '6.25', '{soybean}', true),
  ('FM00104', 'Sangita Pawar', 'Ganjur', 'C07', '9000000104', '3.75', '{tur}', true),
  ('FM00105', 'Vitthal Deshmukh', 'Wadwal', 'C07', '9000000105', '18.00', '{soybean,tur}', true),
  ('FM00106', 'Anita Gaikwad', 'Harangul', 'C01', '9000000106', '7.50', '{soybean}', true),
  ('FM00107', 'Suresh Kadam', 'Harangul', 'C01', '9000000107', '12.00', '{soybean,tur}', true),
  ('FM00108', 'Balaji Mane', 'Medha', 'C01', '9000000108', '4.50', '{tur}', true),
  ('FM00109', 'Ganesh Kulkarni', 'Harangul', 'C01', '9000000109', '21.75', '{soybean,tur}', true),
  ('FM00110', 'Shivaji Chavan', 'Tondar', 'C03', '9000000110', '10.25', '{soybean}', true),
  ('FM00111', 'Dnyaneshwar Bhosale', 'Tondar', 'C03', '9000000111', '15.00', '{soybean,tur}', true),
  ('FM00112', 'Savita Waghmare', 'Takalgaon', 'C03', '9000000112', '2.50', '{tur}', true),
  ('FM00113', 'Pandurang Sawant', 'Tondar', 'C03', '9000000113', '8.00', '{soybean}', false),
  ('FM00114', 'Rajendra Thorat', 'Kharola', 'C09', '9000000114', '11.50', '{soybean,tur}', true),
  ('FM00115', 'Meena Jagtap', 'Kharola', 'C09', '9000000115', '5.25', '{soybean}', true),
  ('FM00116', 'Prakash Kamble', 'Dhanora', 'C09', '9000000116', '13.00', '{soybean,tur}', true),
  ('FM00117', 'Laxman Swami', 'Kharola', 'C09', '9000000117', '6.00', '{tur}', true),
  ('FM00118', 'Uddhav Munde', 'Murud', 'C12', '9000000118', '16.50', '{soybean,tur}', true),
  ('FM00119', 'Sandipan Rathod', 'Murud', 'C12', '9000000119', '9.75', '{soybean}', true),
  ('FM00120', 'Vaishali Kendre', 'Babhalgaon', 'C12', '9000000120', '4.00', '{tur}', true),
  ('FM00121', 'Nitin Ghuge', 'Murud', 'C12', '9000000121', '22.00', '{soybean,tur}', true),
  ('FM00203', 'Mohan Biradar', 'Murud', 'C12', '9000000203', '11.25', '{tur}', true),
  ('FM00122', 'Kishor Lokhande', 'Gategaon', 'C15', '9000000122', '7.00', '{soybean}', true),
  ('FM00123', 'Archana Mhetre', 'Gategaon', 'C15', '9000000123', '3.25', '{soybean,tur}', true),
  ('FM00124', 'Sanjay Bhalerao', 'Kendri', 'C15', '9000000124', '12.75', '{soybean}', true),
  ('FM00125', 'Manohar Gutte', 'Gategaon', 'C15', '9000000125', '19.50', '{soybean,tur}', true),
  ('FM00126', 'Shobha Ingole', 'Bhada', 'C18', '9000000126', '5.50', '{tur}', true),
  ('FM00127', 'Tukaram Solanke', 'Bhada', 'C18', '9000000127', '14.00', '{soybean,tur}', true),
  ('FM00128', 'Babasaheb Dhage', 'Lamjana', 'C18', '9000000128', '8.75', '{soybean}', true),
  ('FM00129', 'Jyoti Nagargoje', 'Bhada', 'C18', '9000000129', '2.00', '{tur}', false),
  ('FM00130', 'Arjun Pandit', 'Hasegaon', 'C21', '9000000130', '17.25', '{soybean,tur}', true),
  ('FM00131', 'Sopan Ambade', 'Hasegaon', 'C21', '9000000131', '6.50', '{soybean}', true),
  ('FM00132', 'Rukmini Katkar', 'Hasegaon', 'C21', '9000000132', '4.25', '{tur}', true),
  ('FM00133', 'Bhimrao Salunke', 'Sarola', 'C21', '9000000133', '10.00', '{soybean,tur}', true),
  ('FM00134', 'Gopal Chilgar', 'Takalgaon', 'C03', '9000000134', '13.50', '{soybean,tur}', true),
  ('FM00135', 'Vandana Sonawane', 'Dhanora', 'C09', '9000000135', '8.25', '{soybean}', true),
  ('FM00136', 'Hanumant Birajdar', 'Murud', 'C12', '9000000136', '6.75', '{soybean,tur}', false)
) as v (code, name, village, centre, phone, acres, crops, active)
join public.centres c on c.code = v.centre
on conflict (member_code) do nothing;

insert into public.farmer_bank_accounts
  (member_id, holder_name, account_number, ifsc, verified, verified_at)
select m.id, m.full_name, b.account_number, b.ifsc, b.verified,
       case when b.verified then now() end
from (values
  ('FM00101', '504618608387888', 'SBIN0012874', true),
  ('FM00102', '58089406541324', 'SBIN0012874', true),
  ('FM00103', '995871863888718', 'MAHB0001532', true),
  ('FM00104', '224026222946', 'MAHG0000418', false),
  ('FM00105', '30979555559', 'HDFC0004021', true),
  ('FM00106', '468829670884', 'SBIN0001193', true),
  ('FM00107', '505325987930059', 'MAHB0000947', true),
  ('FM00108', '2996779451452201', 'MAHG0000211', true),
  ('FM00109', '171045723574301', 'ICIC0003318', false),
  ('FM00110', '353815971752493', 'SBIN0004456', true),
  ('FM00111', '87688382078', 'MAHB0002210', true),
  ('FM00112', '478095190576', 'MAHG0000533', true),
  ('FM00113', '32620684403', 'SBIN0004456', true),
  ('FM00114', '937654680834522', 'HDFC0001875', true),
  ('FM00115', '387286335715285', 'MAHG0000306', true),
  ('FM00116', '86159325147201', 'SBIN0009120', false),
  ('FM00117', '317603364473', 'MAHB0001108', true),
  ('FM00118', '7274729707366614', 'SBIN0003308', true),
  ('FM00119', '77715058660458', 'MAHB0000715', true),
  ('FM00120', '8058190945686444', 'MAHG0000127', true),
  ('FM00121', '941025853350', 'ICIC0000674', true),
  ('FM00203', '547533454126', 'SBIN0003308', true),
  ('FM00122', '46719571594', 'SBIN0007741', true),
  ('FM00123', '98083445334449', 'MAHG0000589', false),
  ('FM00124', '23879355482', 'MAHB0001864', true),
  ('FM00126', '608180154693', 'MAHG0000342', true),
  ('FM00127', '797333190126', 'SBIN0005029', true),
  ('FM00128', '91037755052', 'HDFC0002650', true),
  ('FM00129', '18057672091', 'MAHG0000342', false),
  ('FM00130', '555437910257', 'SBIN0008863', true),
  ('FM00131', '652636711636', 'MAHB0002037', true),
  ('FM00132', '95975513778172', 'MAHG0000674', true),
  ('FM00133', '625475885846921', 'SBIN0008863', false),
  ('FM00135', '36646551015', 'ICIC0001402', true),
  ('FM00136', '45852421994', 'SBIN0003308', true)
) as b (code, account_number, ifsc, verified)
join public.farmer_members m on m.member_code = b.code
on conflict (member_id) do nothing;

insert into public.daily_prices (price_date, crop, grade, rate_per_quintal) values
  (current_date, 'soybean', 'A', 4850.00),
  (current_date, 'soybean', 'B', 4700.00),
  (current_date, 'tur',     'A', 7200.00),
  (current_date, 'tur',     'B', 7000.00)
on conflict (price_date, crop, grade) do nothing;
