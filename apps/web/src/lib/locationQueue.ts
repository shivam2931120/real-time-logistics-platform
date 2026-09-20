export type QueuedLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  source: string;
  recordedAt: string;
};

const MAX_QUEUE = 250;

const read = (key: string): QueuedLocation[] => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QueuedLocation =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as QueuedLocation).lat === "number" &&
            typeof (item as QueuedLocation).lng === "number" &&
            typeof (item as QueuedLocation).recordedAt === "string",
        ),
    );
  } catch {
    return [];
  }
};

const write = (key: string, items: QueuedLocation[]) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(items.slice(-MAX_QUEUE)));
  } catch {
    // Storage can be unavailable in private browsing; the live HTTP path still works.
  }
};

export const locationQueue = (userId: string) => {
  const key = `routepulse:location-queue:${userId}`;
  return {
    count: () => read(key).length,
    enqueue: (reading: QueuedLocation) => {
      const current = read(key);
      // Coalesce repeated fixes from a paused tab to keep the queue bounded.
      const last = current.at(-1);
      if (
        last &&
        Math.abs(new Date(last.recordedAt).getTime() - new Date(reading.recordedAt).getTime()) < 5_000
      )
        current[current.length - 1] = reading;
      else current.push(reading);
      write(key, current);
      return current.length;
    },
    flush: async (
      send: (reading: QueuedLocation) => Promise<unknown>,
    ) => {
      const pending = read(key);
      let sent = 0;
      for (const reading of pending) {
        try {
          await send(reading);
          sent += 1;
        } catch {
          break;
        }
      }
      if (sent) write(key, pending.slice(sent));
      return { sent, remaining: pending.length - sent };
    },
    clear: () => write(key, []),
  };
};
