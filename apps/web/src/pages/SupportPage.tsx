import { useEffect, useState } from "react";
import { ArrowLeft, LifeBuoy, Send, UserRound } from "lucide-react";
import type { Order, SupportMessage, SupportTicket } from "@routepulse/shared";
import { api } from "../lib/api";
import { io } from "socket.io-client";

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
  const selected = tickets.find((ticket) => ticket.id === selectedId);
  const reload = async () => {
    try {
      const next = await api.supportTickets();
      setTickets(next);
      if (!selectedId && next[0]) setSelectedId(next[0].id);
      if (selectedId) setMessages(await api.supportMessages(selectedId));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load support",
      );
    }
  };
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (selectedId)
      void api
        .supportMessages(selectedId)
        .then(setMessages)
        .catch(() => setMessages([]));
  }, [selectedId]);
  useEffect(() => {
    if (!selectedId || !api.token()) return;
    const socket = io(api.base, { auth: { token: api.token() } });
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
      setMessages(await api.supportMessages(ticket.id));
      event.currentTarget.reset();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to create ticket",
      );
    }
  };
  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    try {
      const message = await api.sendSupportMessage(selected.id, draft.trim());
      setMessages((items) => [...items, message]);
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
    }
  };
  const update = async (data: { status?: SupportTicket["status"] }) => {
    if (!selected) return;
    try {
      const ticket = await api.updateSupportTicket(selected.id, data);
      setTickets((items) =>
        items.map((item) => (item.id === ticket.id ? ticket : item)),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to update ticket",
      );
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
      {error && <p className="error">{error}</p>}
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
          {!tickets.length && (
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
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Write a reply…"
                />
                <button className="button primary" disabled={!draft.trim()}>
                  <Send /> Send
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
          <section className="modal">
            <div className="modal-head">
              <div>
                <span className="eyebrow">Support center</span>
                <h2>Open a ticket</h2>
              </div>
              <button className="icon-btn" onClick={() => setNewTicket(false)}>
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={create}>
              <label className="span-2">
                Subject
                <input
                  name="subject"
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
                  required
                  minLength={3}
                  rows={5}
                  placeholder="Describe the issue…"
                />
              </label>
              <div className="form-actions span-2">
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => setNewTicket(false)}
                >
                  Cancel
                </button>
                <button className="button primary">
                  <Send /> Create ticket
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
