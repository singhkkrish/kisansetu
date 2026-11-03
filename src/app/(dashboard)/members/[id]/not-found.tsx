import Link from "next/link";
import { Button } from "@/components/ui/button";
import { en } from "@/lib/i18n/messages";

export default function MemberNotFound() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-12 text-center">
      <h1 className="text-2xl font-bold">Farmer not found</h1>
      <p className="text-muted">This farmer does not exist, or you do not have access to the record.</p>
      <Button asChild variant="secondary">
        <Link href="/members">{en.members.backToList}</Link>
      </Button>
    </div>
  );
}
