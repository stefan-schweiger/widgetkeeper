/**
 * One read shared by everyone who asks while it's at most `maxAge` old, including while it's on its way. A read that
 * fails is dropped (unless a newer one already replaced it), so the next ask reads again.
 */
export function sharedCache<T>(fetch: () => Promise<T>) {
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
      }
      return entry.promise;
    },
    /** Whether a read is kept (done or on its way). */
    get cached() {
      return !!entry;
    },
  };
}
