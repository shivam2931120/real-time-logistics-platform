import { useEffect, useState } from "react";
import { ArrowLeft, LifeBuoy, Send, UserRound } from "lucide-react";
import type { Order, SupportMessage, SupportTicket } from "@routepulse/shared";
import { api } from "../lib/api";
import { io } from "socket.io-client";
import { useDialog } from "../lib/useDialog";

export function SupportPage({
  orders = [],
  customerOnly = false,
  onBack,
}: {
  orders?: Order[];
  customerOnly?: boolean;
  onBack?: () => void;
}) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [newTicket, setNewTicket] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const dialogRef = useDialog(newTicket, () => {
    if (!busy) setNewTicket(false);
  });
  const selected = tickets.find((ticket) => ticket.id === selectedId);
  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await api.supportTickets();
      setTickets(next);
      if (!selectedId && next[0]) setSelectedId(next[0].id);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load support",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    let active = true;
    setMessages([]);
    setDraft("");
    if (selectedId) {
      setLoadingMessages(true);
      void api
        .supportMessages(selectedId)
        .then((history) => {
          if (active)
            setMessages((items) => [
              ...history,
              ...items.filter(
                (item) => !history.some((entry) => entry.id === item.id),
              ),
            ]);
        })
        .catch((reason) => {
          if (active)
            setError(
              reason instanceof Error
                ? reason.message
                : "Unable to load conversation",
            );
        })
        .finally(() => {
          if (active) setLoadingMessages(false);
        });
    }
    return () => {
      active = false;
    };
  }, [selectedId]);
  useEffect(() => {
    if (!selectedId || !api.token()) return;
    const socket = io(api.base, { auth: api.socketAuth });
    socket.on("connect", () => socket.emit("support:subscribe", selectedId));
    socket.on("support:message", (message: SupportMessage) => {
      if (message.ticketId === selectedId)
        setMessages((items) =>
          items.some((item) => item.id === message.id)
            ? items
            : [...items, message],
        );
    });
    socket.on("support:ticket.updated", (ticket: SupportTicket) =>
      setTickets((items) =>
        items.map((item) => (item.id === ticket.id ? ticket : item)),
      ),
    );
    return () => {
      socket.close();
    };
  }, [selectedId]);
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const ticket = await api.createSupportTicket({
        subject: String(form.get("subject")),
        category: String(form.get("category")) as SupportTicket["category"],
        priority: String(form.get("priority")) as SupportTicket["priority"],
        orderId: String(form.get("orderId") || "") || undefined,
        message: String(form.get("message")),
      });
      setNewTicket(false);
      setTickets((items) => [ticket, ...items]);
      setSelectedId(ticket.id);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to create ticket",
      );
    } finally {
      setBusy(false);
    }
  };
  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !draft.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const message = await api.sendSupportMessage(selected.id, draft.trim());
      setMessages((items) =>
        items.some((item) => item.id === message.id)
          ? items
          : [...items, message],
      );
      setTickets((items) =>
        items.map((item) =>
          item.id === selected.id
            ? {
                ...item,
                lastMessage: message.message,
                updatedAt: message.createdAt,
                status: item.status === "resolved" ? "open" : item.status,
              }
            : item,
        ),
      );
      setDraft("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to send message",
      );
    } finally {
      setBusy(false);
    }
  };
  const update = async (data: { status?: SupportTicket["status"] }) => {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const ticket = await api.updateSupportTicket(selected.id, data);
      setTickets((items) =>
        items.map((item) => (item.id === ticket.id ? ticket : item)),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to update ticket",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="support-page">
      <div className="page-intro">
        <div>
          {onBack && (
            <button className="back-button" onClick={onBack}>
              <ArrowLeft /> Back
            </button>
          )}
          <span className="eyebrow">Operations / communication</span>
          <h1>Support center</h1>
          <p>
            Keep customers, dispatchers, and drivers aligned in one auditable
            conversation.
          </p>
        </div>
        <button className="button primary" onClick={() => setNewTicket(true)}>
          <LifeBuoy /> New ticket
        </button>
      </div>
      {error && !newTicket && (
        <div className="inline-retry" role="alert">
          <span>{error}</span>
          <button onClick={() => void reload()}>Refresh inbox</button>
        </div>
      )}
      <div className="support-layout">
        <aside className="panel support-list">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Inbox</span>
              <h3>{tickets.length} tickets</h3>
            </div>
            <LifeBuoy />
          </div>
          {tickets.map((ticket) => (
            <button
              key={ticket.id}
              disabled={busy}
              className={ticket.id === selectedId ? "active" : ""}
              onClick={() => setSelectedId(ticket.id)}
            >
              <span className={`ticket-priority ${ticket.priority}`} />
              <span>
                <strong>{ticket.subject}</strong>
                <small>
                  {ticket.category} · {ticket.lastMessage || "No messages"}
                </small>
              </span>
              <em>{ticket.status}</em>
            </button>
          ))}
          {loading && <p role="status">Loading support inbox…</p>}
          {!loading && !error && !tickets.length && (
            <div className="empty-state">
              <LifeBuoy />
              <strong>No tickets</strong>
              <span>Support requests will show here.</span>
            </div>
          )}
        </aside>
        <section className="panel support-thread">
          {selected ? (
            <>
              <div className="panel-head thread-head">
                <div>
                  <span className="eyebrow">Ticket · {selected.category}</span>
                  <h3>{selected.subject}</h3>
                  <small>
                    {selected.priority.toUpperCase()} priority · created{" "}
                    {new Date(selected.createdAt).toLocaleString()}
                  </small>
                </div>
                {!customerOnly && (
                  <select
                    aria-label="Ticket status"
                    disabled={busy}
                    value={selected.status}
                    onChange={(event) =>
                      void update({
                        status: event.target.value as SupportTicket["status"],
                      })
                    }
                  >
                    <option value="open">Open</option>
                    <option value="pending">Pending</option>
                    <option value="resolved">Resolved</option>
                  </select>
                )}
              </div>
              <div className="message-list">
                {loadingMessages && <p role="status">Loading conversation…</p>}
                {messages.map((message) => (
                  <article
                    className={
                      message.senderRole === "customer"
                        ? "customer-message"
                        : ""
                    }
                    key={message.id}
                  >
                    <span className="message-avatar">
                      <UserRound />
                    </span>
                    <div>
                      <strong>
                        {message.senderName || message.senderRole}
                      </strong>
                      <small>
                        {new Date(message.createdAt).toLocaleString()}
                        {message.internal ? " · INTERNAL" : ""}
                      </small>
                      <p>{message.message}</p>
                    </div>
                  </article>
                ))}
              </div>
              <form className="message-compose" onSubmit={send}>
                <input
                  aria-label="Reply to ticket"
                  disabled={busy || loadingMessages}
                  maxLength={2000}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Write a reply…"
                />
                <button
                  className="button primary"
                  disabled={!draft.trim() || busy || loadingMessages}
                >
                  <Send /> {busy ? "Sending…" : "Send"}
                </button>
              </form>
            </>
          ) : (
            <div className="empty-state">
              <LifeBuoy />
              <strong>Select a ticket</strong>
              <span>Choose a conversation from the inbox.</span>
            </div>
          )}
        </section>
      </div>
      {newTicket && (
        <div className="modal-backdrop">
          <section
            className="modal"
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-title"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">Support center</span>
                <h2 id="support-title">Open a ticket</h2>
              </div>
              <button
                className="icon-btn"
                aria-label="Close ticket form"
                disabled={busy}
                onClick={() => setNewTicket(false)}
              >
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={create}>
              <label className="span-2">
                Subject
                <input
                  name="subject"
                  maxLength={120}
                  data-dialog-autofocus
                  required
                  minLength={3}
                  placeholder="What do you need help with?"
                />
              </label>
              <label>
                Category
                <select name="category" defaultValue="delivery">
                  <option value="delivery">Delivery</option>
                  <option value="payment">Payment</option>
                  <option value="address">Address</option>
                  <option value="account">Account</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Priority
                <select name="priority" defaultValue="normal">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              {orders.length > 0 && (
                <label className="span-2">
                  Related delivery
                  <select name="orderId">
                    <option value="">Not linked</option>
                    {orders.map((order) => (
                      <option value={order.id} key={order.id}>
                        {order.trackingCode} · {order.dropoff.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="span-2">
                Message
                <textarea
                  name="message"
                  maxLength={2000}
                  required
                  minLength={3}
                  rows={5}
                  placeholder="Describe the issue…"
                />
              </label>
              {error && (
                <p role="alert" className="error span-2">
                  {error}
                </p>
              )}
              <div className="form-actions span-2">
                <button
                  type="button"
                  className="button ghost"
                  disabled={busy}
                  onClick={() => setNewTicket(false)}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={busy}>
                  <Send /> {busy ? "Creating…" : "Create ticket"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
