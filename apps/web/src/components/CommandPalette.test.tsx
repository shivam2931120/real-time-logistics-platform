import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

it("names empty search results, traps focus, and restores the trigger on close", async () => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  const onClose = vi.fn();
  const props = {
    open: true,
    query: "unknown",
    destinations: [],
    orders: [],
    canCreate: false,
    onQueryChange: vi.fn(),
    onClose,
    onNavigate: vi.fn(),
    onOrder: vi.fn(),
    onCreate: vi.fn(),
  };
  const view = render(<CommandPalette {...props} />);
  expect(
    view.getByRole("dialog", { name: "Search RoutePulse" }),
  ).toBeInTheDocument();
  const input = view.getByRole("textbox", { name: "Search RoutePulse" });
  await waitFor(() => expect(input).toHaveFocus());
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(view.getByRole("button", { name: "Close search" })).toHaveFocus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(input).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  view.rerender(<CommandPalette {...props} open={false} />);
  expect(trigger).toHaveFocus();
  trigger.remove();
});
