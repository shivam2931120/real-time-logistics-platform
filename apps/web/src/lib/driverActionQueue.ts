export type DriverActionType = "accept" | "reject" | "status" | "scan" | "proof";
export type QueuedDriverAction = {
  id: string;
  type: DriverActionType;
  orderId: string;
  data: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const MAX_QUEUE = 50;
const read = (key: string): QueuedDriverAction[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is QueuedDriverAction => Boolean(item && typeof item === "object" && typeof (item as QueuedDriverAction).id === "string" && typeof (item as QueuedDriverAction).orderId === "string" && typeof (item as QueuedDriverAction).type === "string"))
      : [];
  } catch {
    return [];
  }
};
const write = (key: string, actions: QueuedDriverAction[]) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(actions.slice(-MAX_QUEUE)));
  } catch {
    // Private browsing or storage quotas should not block live actions.
  }
};

export const driverActionQueue = (userId: string) => {
  const key = `routepulse:driver-actions:${userId}`;
  return {
    list: () => read(key),
    count: () => read(key).length,
    enqueue: (
      action: Omit<QueuedDriverAction, "id" | "createdAt" | "attempts">,
      id = crypto.randomUUID(),
    ) => {
      const actions = read(key);
      const queued: QueuedDriverAction = {
        ...action,
        id,
        createdAt: new Date().toISOString(),
        attempts: 0,
      };
      actions.push(queued);
      write(key, actions);
      return actions.length;
    },
    flush: async (send: (action: QueuedDriverAction) => Promise<unknown>) => {
      const pending = read(key);
      let sent = 0;
      for (const action of pending) {
        try {
          await send(action);
          sent += 1;
        } catch (error) {
          const current = read(key);
          const failed = current.find((item) => item.id === action.id);
          if (failed) {
            failed.attempts += 1;
            failed.lastError = error instanceof Error ? error.message : "Sync failed";
            write(key, current);
          }
          break;
        }
      }
      if (sent) write(key, read(key).filter((action) => !pending.slice(0, sent).some((sentAction) => sentAction.id === action.id)));
      return { sent, remaining: read(key).length };
    },
  };
};
