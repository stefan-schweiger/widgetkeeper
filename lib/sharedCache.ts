/**
 * One read shared by everyone who asks while it's at most `maxAge` old, including while it's on its way. A read that
 * fails is dropped (unless a newer one already replaced it), so the next ask reads again.
 * - `keepFor`: a read is let go this long after it came in, so a large one (every device) isn't held between rare
 *   uses for the app's whole life; without it, the last read is kept until a newer one replaces it.
 */
export function sharedCache<T>(fetch: () => Promise<T>, { keepFor }: { keepFor?: number } = {}) {
  let entry: { at: number, promise: Promise<T> } | null = null;
  return {
    get(maxAge: number): Promise<T> {
      const now = Date.now();
      if (!entry || now - entry.at > maxAge) {
        const promise: Promise<T> = fetch().catch((err: unknown) => {
          if (entry?.promise === promise) entry = null;
          throw err;
        });
        entry = { at: now, promise };
        if (keepFor !== undefined) {
          promise.then(() => {
            // Only lets go of memory, so it mustn't keep the app (or a test) running.
            const timer = setTimeout(() => { if (entry?.promise === promise) entry = null; }, keepFor);
            (timer as { unref?: () => void }).unref?.();
          }, () => {});
        }
      }
      return entry.promise;
    },
    /** Whether a read is kept (done or on its way). */
    get cached() {
      return !!entry;
    },
  };
}
