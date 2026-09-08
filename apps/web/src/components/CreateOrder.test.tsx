import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateOrder } from "./CreateOrder";
import { setToken } from "../lib/api";

describe("CreateOrder", () => {
  beforeEach(() => {
    setToken("demo-token");
    vi.restoreAllMocks();
  });

  it("allows manual coordinates when address search is unavailable", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, _options?: RequestInit) =>
        new Response(
          JSON.stringify(
            String(input).includes("/maps/search")
              ? { error: "Search temporarily unavailable" }
              : { id: "manual-order" },
          ),
          {
            status: String(input).includes("/maps/search") ? 503 : 201,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const saved = vi.fn();
    const view = render(<CreateOrder saved={saved} close={vi.fn()} />);
    fireEvent.change(view.getByLabelText("Customer name"), {
      target: { value: "Manual Customer" },
    });
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "manual@example.com" },
    });
    fireEvent.change(view.getByLabelText("Destination"), {
      target: { value: "My delivery address" },
    });
    fireEvent.click(view.getByRole("button", { name: "Find" }));
    expect(await view.findByRole("alert")).toHaveTextContent(
      "Search temporarily unavailable",
    );
    fireEvent.click(view.getByLabelText("Enter coordinates manually"));
    fireEvent.change(view.getByLabelText("Latitude"), {
      target: { value: "12.97" },
    });
    fireEvent.change(view.getByLabelText("Longitude"), {
      target: { value: "77.59" },
    });
    fireEvent.click(view.getByRole("button", { name: "Create delivery" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/orders"),
    );
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      dropoff: { label: "My delivery address", lat: 12.97, lng: 77.59 },
    });
  });

  it("verifies a searched address before creating a delivery", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, _options?: RequestInit) => {
        const url = String(input);
        const body = url.includes("/api/maps/search")
          ? [
              {
                id: "place:1",
                label: "HSR Layout, Bengaluru, India",
                category: "suburb",
                lat: 12.9121,
                lng: 77.6446,
              },
            ]
          : { id: "order:1" };
        return new Response(JSON.stringify(body), {
          status:
            url.includes("/api/maps/search") || url.endsWith("/api/orders")
              ? 200
              : 404,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const saved = vi.fn();
    const close = vi.fn();
    const view = render(<CreateOrder saved={saved} close={close} />);

    fireEvent.change(view.getByLabelText("Customer name"), {
      target: { value: "Ananya Rao" },
    });
    fireEvent.change(view.getByLabelText("Email"), {
      target: { value: "ananya@example.com" },
    });
    fireEvent.change(view.getByLabelText("Destination"), {
      target: { value: "HSR Layout" },
    });
    fireEvent.click(view.getByRole("button", { name: "Find" }));
    fireEvent.click(
      await view.findByRole("button", {
        name: /HSR Layout, Bengaluru, India/,
      }),
    );
    expect(view.getByText(/Address selected/)).toBeInTheDocument();

    fireEvent.click(view.getByRole("button", { name: "Create delivery" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(close).toHaveBeenCalledTimes(1);
    const createCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/orders"),
    );
    expect(createCall).toBeTruthy();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      dropoff: {
        label: "HSR Layout, Bengaluru, India",
        lat: 12.9121,
        lng: 77.6446,
      },
    });
  });
});
