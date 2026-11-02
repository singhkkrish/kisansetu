"use client";

import { liveQuery } from "dexie";
import { useEffect, useRef, useState } from "react";

/** Subscribes to an IndexedDB query and re-renders whenever the underlying rows change. */
export function useLocalQuery<T>(query: () => Promise<T> | T, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  const latest = useRef(query);

  useEffect(() => {
    latest.current = query;
  });

  useEffect(() => {
    const subscription = liveQuery(() => latest.current()).subscribe({
      next: setValue,
      error: () => {
        // Storage can be unavailable (private mode, quota). Keep the last value.
      },
    });
    return () => subscription.unsubscribe();
  }, []);

  return value;
}
