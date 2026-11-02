export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-line" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-36 animate-pulse rounded-xl bg-line" />
        <div className="h-36 animate-pulse rounded-xl bg-line" />
      </div>
    </div>
  );
}
