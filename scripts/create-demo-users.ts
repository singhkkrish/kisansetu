/**
 * Creates three DEMO staff logins in YOUR OWN Supabase project, for trying the app.
 * They exist only where you run this; there is no shared or hosted demo.
 *
 *   DEMO_PASSWORD='choose-a-password-of-10+-chars' npm run demo:users
 *
 * The password is read from the environment, never stored in the repository.
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, and
 * supabase/seed.sql applied (for centres C07 and C12). Run from a trusted machine only.
 * Safe to run again: existing demo users are left as they are.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD;
if (!url || !serviceKey) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
if (!password || password.length < 10) throw new Error("Set DEMO_PASSWORD (at least 10 characters) for this run");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const DEMO = [
  { email: "manager@kisansetu.demo", name: "Demo Office Manager", role: "office_manager", centre: null },
  { email: "operator.c07@kisansetu.demo", name: "Demo Operator (Ganjur C07)", role: "centre_operator", centre: "C07" },
  { email: "operator.c12@kisansetu.demo", name: "Demo Operator (Murud C12)", role: "centre_operator", centre: "C12" },
] as const;

for (const user of DEMO) {
  let centreId = "";
  if (user.centre) {
    const { data } = await supabase.from("centres").select("id").eq("code", user.centre).maybeSingle();
    if (!data) throw new Error(`Centre ${user.centre} not found. Apply supabase/seed.sql first.`);
    centreId = data.id as string;
  }
  const { error } = await supabase.auth.admin.createUser({
    email: user.email,
    password,
    email_confirm: true,
    app_metadata: { role: user.role, full_name: user.name, centre_id: centreId, phone: null },
  });
  if (error && /already|registered|exists/i.test(error.message)) console.log(`${user.email}: already exists, left unchanged`);
  else if (error) throw new Error(`${user.email}: ${error.message}`);
  else console.log(`${user.email}: created (${user.role}${user.centre ? `, ${user.centre}` : ""})`);
}
console.log("Done. Sign in with the DEMO_PASSWORD you chose.");
