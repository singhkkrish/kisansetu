import type { Metadata } from "next";
import { Search } from "lucide-react";
import { redirect } from "next/navigation";
import { MembersTable } from "@/components/members/members-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { getMessages } from "@/lib/i18n/messages";
import { getSession } from "@/lib/services/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Members" };

const PAGE_SIZE = 50;

/** Strips characters that have meaning inside a PostgREST filter expression. */
function cleanSearch(raw: string): string {
  return raw.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const t = getMessages(session.profile.preferred_lang).members;
  const params = await searchParams;
  const q = cleanSearch(Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? ""));

  const supabase = await createClient();
  let query = supabase
    .from("farmer_members")
    .select("id, member_code, full_name, village, land_acres", { count: "exact" })
    .eq("active", true)
    .order("full_name")
    .limit(PAGE_SIZE);

  if (q) {
    query = query.or(`full_name.ilike.%${q}%,village.ilike.%${q}%,member_code.ilike.%${q}%`);
  }

  const { data, count, error } = await query;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t.title}</h1>

      <form role="search" method="get" className="flex gap-3">
        <Input
          name="q"
          defaultValue={q}
          placeholder={t.searchPlaceholder}
          aria-label={t.search}
          className="max-w-md"
          autoComplete="off"
        />
        <Button type="submit" variant="secondary">
          <Search className="h-5 w-5" aria-hidden="true" />
          <span className="hidden sm:inline">{t.search}</span>
        </Button>
      </form>

      {error ? (
        <div className="space-y-3">
          <Notice tone="error">{t.loadError}</Notice>
          <Button asChild variant="secondary">
            <a href={q ? `?q=${encodeURIComponent(q)}` : "?"}>{t.reload}</a>
          </Button>
        </div>
      ) : !data || data.length === 0 ? (
        <p className="py-8 text-muted">{q ? t.noneForSearch : t.none}</p>
      ) : (
        <>
          <MembersTable rows={data} t={t} />
          <p className="text-sm text-muted">
            {t.showing} {data.length} / {count ?? data.length}
          </p>
        </>
      )}
    </div>
  );
}
