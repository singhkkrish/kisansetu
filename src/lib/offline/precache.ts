/**
 * Warms the service worker's cache so these pages open with no network.
 * Each page is fetched (the worker stores the HTML), then the script and style
 * files it refers to are fetched too (the worker stores those as well).
 */
export async function precachePages(paths: string[]): Promise<void> {
  const assets = new Set<string>();
  for (const path of paths) {
    try {
      const response = await fetch(path, { credentials: "same-origin" });
      if (!response.ok || response.redirected) continue;
      const html = await response.text();
      for (const match of html.matchAll(/\/_next\/static\/[A-Za-z0-9_\-./%~]+\.(?:js|css)/g)) {
        assets.add(match[0]);
      }
    } catch {
      // Offline or the page is not for this user: skip it.
    }
  }
  await Promise.allSettled([...assets].map((url) => fetch(url, { credentials: "same-origin" })));
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // The app still works online without it.
  }
}
