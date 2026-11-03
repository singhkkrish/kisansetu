import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Entry not found</h1>
      <p className="text-muted">This entry does not exist, or it belongs to another centre.</p>
      <Link href="/procurement" className="font-semibold text-primary underline">Back to entries</Link>
    </div>
  );
}
