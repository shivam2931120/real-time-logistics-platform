import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, setToken, setTokenProvider } from "./api";

describe("API authentication", () => {
  beforeEach(() => {
    setTokenProvider(null);
    setToken("");
    vi.restoreAllMocks();
  });

  it("allows a hosted instance to wake up before completing demo sign-in", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const timer = window.setTimeout(() => resolve(new Response(JSON.stringify({
            token: "demo-token",
            user: { id: "u_dispatch", role: "dispatcher" },
          }), { status: 200 })), 60_000);
          options.signal?.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        }),
      ));
      const result = expect(api.login("dispatcher")).resolves.toMatchObject({
        id: "u_dispatch",
      });
      await vi.advanceTimersByTimeAsync(60_000);
      await result;
      expect(api.token()).toBe("demo-token");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes an expired Clerk token and retries the request once", async () => {
    let currentToken = "stale-token";
    const provider = vi.fn(async (options?: { skipCache?: boolean }) => {
      if (options?.skipCache) currentToken = "fresh-token";
      return currentToken;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Invalid Clerk session" }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "clerk_user_1",
            organizationId: "org_demo",
            name: "RoutePulse user",
            email: "user@example.com",
            role: "customer",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    setTokenProvider(provider);

    await expect(api.me()).resolves.toMatchObject({ id: "clerk_user_1" });
    expect(provider).toHaveBeenCalledWith({ skipCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer stale-token",
    });
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
      authorization: "Bearer fresh-token",
    });
    expect(api.token()).toBe("fresh-token");
  });
});
