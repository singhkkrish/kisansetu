import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex h-11 items-center gap-2 text-base font-semibold text-primary hover:underline">
      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      {label}
    </Link>
  );
}
