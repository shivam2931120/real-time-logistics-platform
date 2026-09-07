import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMapGatewayCache,
  roadRoute,
  searchPlaces,
} from "../src/services/mapGateway.js";

describe("map gateway", () => {
  afterEach(() => {
    clearMapGatewayCache();
    vi.unstubAllGlobals();
  });

  it("normalizes and caches road geometry", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            routes: [
              {
                geometry: {
                  coordinates: [
                    [77.59, 12.97],
                    [77.62, 12.99],
                  ],
                },
                distance: 4200,
                duration: 780,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const points = [
      { lat: 12.97, lng: 77.59 },
      { lat: 12.99, lng: 77.62 },
    ];
    const first = await roadRoute(points);
    const second = await roadRoute(points);
    expect(first).toEqual({
      geometry: [
        [77.59, 12.97],
        [77.62, 12.99],
      ],
      distanceMeters: 4200,
      durationSeconds: 780,
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns safe address search results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                place_id: 42,
                display_name: "Indiranagar, Bengaluru, India",
                lat: "12.9784",
                lon: "77.6408",
                type: "suburb",
              },
              { place_id: 43, display_name: "Invalid", lat: "x", lon: "y" },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(searchPlaces("Indiranagar Bengaluru")).resolves.toEqual([
      {
        id: "42",
        label: "Indiranagar, Bengaluru, India",
        category: "suburb",
        lat: 12.9784,
        lng: 77.6408,
      },
    ]);
  });
});
