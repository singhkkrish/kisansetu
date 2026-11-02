/**
 * Creates a staff login and its profile. Run from a trusted machine only: it
 * needs the service-role key, which must never reach the browser or the repo.
 *
 *   npm run staff:create -- --email manager@company.example --name "Office Manager" --role office_manager
 *   npm run staff:create -- --email op07@company.example --name "Ganjur Operator" --role centre_operator --centre C07
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * The password comes from STAFF_PASSWORD; if unset, a random one is generated
 * and printed once.
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const ROLES = ["centre_operator", "office_manager"] as const;

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string" },
    centre: { type: "string" },
    phone: { type: "string" },
  },
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");

const { email, name, role, centre, phone } = values;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("--email is required and must be an email address");
if (!name || name.trim().length < 2) fail("--name is required");
if (!role || !(ROLES as readonly string[]).includes(role)) fail(`--role must be one of: ${ROLES.join(", ")}`);
if (role === "centre_operator" && !centre) fail("--centre (for example C07) is required for a centre operator");
if (role === "office_manager" && centre) fail("office managers are not tied to a centre; leave out --centre");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

let centreId: string | null = null;
if (centre) {
  const { data, error } = await supabase.from("centres").select("id").eq("code", centre).maybeSingle();
  if (error || !data) fail(`No centre with code ${centre}. Run supabase/seed.sql or add the centre first.`);
  centreId = data.id;
}

const generated = !process.env.STAFF_PASSWORD;
const password = process.env.STAFF_PASSWORD ?? randomBytes(12).toString("base64url");
if (password.length < 10) fail("STAFF_PASSWORD must be at least 10 characters");

// app_metadata can only be written with the service-role key, so users cannot
// grant themselves a role. The database trigger turns it into a profile.
const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: {
    role,
    full_name: name.trim(),
    centre_id: centreId ?? "",
    phone: phone ?? null,
  },
});
if (error || !data.user) fail(error?.message ?? "Could not create the user");

const { data: profile } = await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
if (!profile) fail("The login was created but its profile was not. Check that migration 4 has been applied.");

console.log(`Created ${role} ${email}${centre ? ` for centre ${centre}` : ""}.`);
if (generated) console.log(`Temporary password (shown once): ${password}`);
