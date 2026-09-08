import { useMemo } from "react";
import { Command, Package, Plus, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Order } from "@routepulse/shared";
import { useDialog } from "../lib/useDialog";

export type CommandDestination = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export function CommandPalette({
  open,
  query,
  destinations,
  orders,
  canCreate,
  onQueryChange,
  onClose,
  onNavigate,
  onOrder,
  onCreate,
}: {
  open: boolean;
  query: string;
  destinations: CommandDestination[];
  orders: Order[];
  canCreate: boolean;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onOrder: (order: Order) => void;
  onCreate: () => void;
}) {
  const dialogRef = useDialog(open, onClose);
  const normalized = query.trim().toLowerCase();
  const visibleDestinations = useMemo(
    () =>
      destinations.filter((item) =>
        `${item.label} ${item.description}`.toLowerCase().includes(normalized),
      ),
    [destinations, normalized],
  );
  const visibleOrders = useMemo(
    () =>
      orders
        .filter((order) =>
          `${order.trackingCode} ${order.customerName} ${order.dropoff.label} ${order.status}`
            .toLowerCase()
            .includes(normalized),
        )
        .slice(0, 6),
    [normalized, orders],
  );

  if (!open) return null;
  const noResults = !visibleDestinations.length && !visibleOrders.length;
  return (
    <div className="command-backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="command-title" className="sr-only">
          Search RoutePulse
        </h2>
        <header>
          <Search aria-hidden="true" />
          <input
            data-dialog-autofocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search deliveries or go to a workspace…"
            aria-label="Search RoutePulse"
          />
          <kbd>ESC</kbd>
          <button type="button" onClick={onClose} aria-label="Close search">
            <X />
          </button>
        </header>
        <div className="command-results">
          {!normalized && canCreate && (
            <div className="command-group">
              <span>Quick action</span>
              <button type="button" onClick={onCreate}>
                <i className="command-icon action">
                  <Plus />
                </i>
                <span>
                  <strong>Create a delivery</strong>
                  <small>Open the shipment form</small>
                </span>
              </button>
            </div>
          )}
          {visibleDestinations.length > 0 && (
            <div className="command-group">
              <span>Workspaces</span>
              {visibleDestinations.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                  >
                    <i className="command-icon">
                      <Icon />
                    </i>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    <Command />
                  </button>
                );
              })}
            </div>
          )}
          {visibleOrders.length > 0 && (
            <div className="command-group">
              <span>Deliveries</span>
              {visibleOrders.map((order) => (
                <button
                  type="button"
                  key={order.id}
                  onClick={() => onOrder(order)}
                >
                  <i className={`command-icon ${order.priority}`}>
                    <Package />
                  </i>
                  <span>
                    <strong>
                      {order.trackingCode} · {order.customerName}
                    </strong>
                    <small>
                      {order.dropoff.label} · {order.status.replace("_", " ")}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {noResults && (
            <div className="command-empty">
              <Search />
              <strong>No results for “{query}”</strong>
              <small>
                Try a tracking code, customer, destination, or page.
              </small>
            </div>
          )}
        </div>
        <footer>
          <span>Tip: search by tracking code from any page</span>
          <span>
            <kbd>⌘</kbd>
            <kbd>K</kbd> to open
          </span>
        </footer>
      </section>
    </div>
  );
}
