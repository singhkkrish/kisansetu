export default function MembersLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading members">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-line" />
      <div className="h-36 animate-pulse rounded-xl bg-line/70" />
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <div className="h-4 w-20 animate-pulse rounded bg-line" />
            <div className="h-4 w-40 animate-pulse rounded bg-line" />
            <div className="ml-auto h-4 w-24 animate-pulse rounded bg-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
