import type { SlaTask, SlaTaskStatus } from "@routepulse/shared";
import { dbEnabled, pool } from "../db/client.js";
import { asUuid, demoOrganizationId, demoOrganizationUuid } from "../db/persistence.js";
import { deliveryExceptions, drivers, store, supportTickets, users } from "../domain/store.js";
import { operationalAlerts } from "./operationalAlerts.js";

const states = new Map<string, { status: SlaTaskStatus; assigneeId?: string; updatedAt: string }>();
const organizationUuid = (value: string) => value === demoOrganizationId ? demoOrganizationUuid : asUuid(value);

async function loadStates(organizationId: string) {
  if (!dbEnabled || !pool) return;
  try {
    const result = await pool.query(
      `SELECT task_id,status,assignee_id::text,updated_at FROM sla_task_states WHERE organization_id=$1`,
      [organizationUuid(organizationId)],
    );
    for (const row of result.rows) states.set(`${organizationId}:${row.task_id}`, {
      status: row.status,
      assigneeId: row.assignee_id || undefined,
      updatedAt: new Date(row.updated_at).toISOString(),
    });
  } catch {
    // The derived inbox remains available while the additive migration is applied.
  }
}

const dueIn = (value: string, minutes: number) => new Date(new Date(value).getTime() + minutes * 60_000).toISOString();

export async function listSlaTasks(organizationId: string, status?: SlaTaskStatus) {
  await loadStates(organizationId);
  const now = new Date().toISOString();
  const orders = store.listOrders(organizationId);
  const exceptions = deliveryExceptions.filter((item) => item.organizationId === organizationId && item.status === "open");
  const tickets = supportTickets.filter((item) => item.organizationId === organizationId && item.status !== "resolved" && ["high", "urgent"].includes(item.priority));
  const tenantDrivers = drivers.filter((driver) => users.some((user) => user.id === driver.userId && user.organizationId === organizationId));
  const alerts = await operationalAlerts(organizationId);
  const tasks: SlaTask[] = [];
  for (const order of orders.filter((item) => item.lateRisk && !["delivered", "cancelled", "failed"].includes(item.status))) {
    tasks.push({ id: `late_delivery:${order.id}`, organizationId, type: "late_delivery", title: `Delivery at risk · ${order.trackingCode}`, description: `${order.customerName}'s delivery is projected to miss its promise window.`, severity: "critical", dueAt: order.promisedAt, orderId: order.id, createdAt: order.createdAt, updatedAt: now, ...stateFor(organizationId, `late_delivery:${order.id}`) });
  }
  for (const alert of alerts) {
    tasks.push({ id: `alert:${alert.id}`, organizationId, type: "operational_alert", title: alert.title, description: alert.description, severity: alert.severity, dueAt: now, orderId: alert.orderId, driverId: alert.driverId, createdAt: alert.createdAt, updatedAt: now, ...stateFor(organizationId, `alert:${alert.id}`) });
  }
  for (const item of exceptions) {
    tasks.push({ id: `exception:${item.id}`, organizationId, type: "exception", title: `Open exception · ${item.type.replaceAll("_", " ")}`, description: item.description, severity: "warning", dueAt: dueIn(item.createdAt, 60), orderId: item.orderId, createdAt: item.createdAt, updatedAt: now, ...stateFor(organizationId, `exception:${item.id}`) });
  }
  for (const ticket of tickets) {
    tasks.push({ id: `ticket:${ticket.id}`, organizationId, type: "support_ticket", title: `Priority support · ${ticket.subject}`, description: `A ${ticket.priority} customer ticket needs an owner.`, severity: ticket.priority === "urgent" ? "critical" : "warning", dueAt: dueIn(ticket.createdAt, ticket.priority === "urgent" ? 60 : 240), ticketId: ticket.id, orderId: ticket.orderId, createdAt: ticket.createdAt, updatedAt: now, ...stateFor(organizationId, `ticket:${ticket.id}`) });
  }
  for (const driver of tenantDrivers.filter((item) => item.maintenanceStatus === "due" || item.maintenanceStatus === "overdue")) {
    const dueAt = driver.maintenanceDueAt || now;
    tasks.push({ id: `maintenance:${driver.id}`, organizationId, type: "maintenance", title: `Maintenance ${itemStatus(driver.maintenanceStatus)}`, description: `${driver.name}'s vehicle requires maintenance before the next shift.`, severity: driver.maintenanceStatus === "overdue" ? "critical" : "warning", dueAt, driverId: driver.id, createdAt: dueAt, updatedAt: now, ...stateFor(organizationId, `maintenance:${driver.id}`) });
  }
  return tasks.filter((task) => !status || task.status === status).sort((a, b) => (a.status === b.status ? new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime() : a.status === "resolved" ? 1 : -1));
}

const itemStatus = (value?: string) => value === "overdue" ? "overdue" : "due";
const stateFor = (organizationId: string, taskId: string) => {
  const value = states.get(`${organizationId}:${taskId}`);
  return value ? { status: value.status, assigneeId: value.assigneeId, updatedAt: value.updatedAt } : { status: "open" as const };
};

export async function updateSlaTask(organizationId: string, taskId: string, status: SlaTaskStatus, assigneeId?: string) {
  const updatedAt = new Date().toISOString();
  states.set(`${organizationId}:${taskId}`, { status, assigneeId, updatedAt });
  if (dbEnabled && pool) {
    try {
      await pool.query(
        `INSERT INTO sla_task_states(organization_id,task_id,status,assignee_id,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,task_id) DO UPDATE SET status=EXCLUDED.status,assignee_id=EXCLUDED.assignee_id,updated_at=EXCLUDED.updated_at`,
        [organizationUuid(organizationId), taskId, status, assigneeId ? asUuid(assigneeId) : null, updatedAt],
      );
    } catch {
      // Keep the acknowledgement available in this process if the table is not migrated yet.
    }
  }
  return { status, assigneeId, updatedAt };
}
