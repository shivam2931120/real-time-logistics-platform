import type {
  Order,
  PaymentReconciliationRow,
  PaymentReconciliationSummary,
} from "@routepulse/shared";
import { asUuid, demoOrganizationId, demoOrganizationUuid } from "../db/persistence.js";
import { dbEnabled, pool } from "../db/client.js";
import { paymentMode } from "./payments.js";
import { store } from "../domain/store.js";

const organizationUuid = (value: string) =>
  value === demoOrganizationId ? demoOrganizationUuid : asUuid(value);

const capturedStatuses = new Set(["captured", "paid", "success", "succeeded"]);
const failedStatuses = new Set(["failed", "refunded", "cancelled"]);

type ProviderPayment = {
  orderId: string;
  provider: string;
  providerRef: string;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: string;
};

const rowStatus = (
  order: Order,
  payment: ProviderPayment | undefined,
): PaymentReconciliationRow["status"] => {
  if (!payment) return order.paymentStatus === "unpaid" ? "unpaid" : "missing_record";
  const providerStatus = payment.status.toLowerCase();
  const providerCaptured = capturedStatuses.has(providerStatus);
  const providerFailed = failedStatuses.has(providerStatus);
  const amountMatches = payment.amountMinor === Math.round(order.amount * 100);
  const currencyMatches = payment.currency.toUpperCase() === order.currency.toUpperCase();
  if (providerCaptured !== (order.paymentStatus === "paid")) return "mismatch";
  if (providerFailed !== (order.paymentStatus === "failed")) return "mismatch";
  if (!amountMatches || !currencyMatches) return "mismatch";
  return "matched";
};

export async function reconcilePayments(
  organizationId: string,
  requestedDays = 30,
): Promise<PaymentReconciliationSummary> {
  const windowDays = Math.min(90, Math.max(1, Math.round(requestedDays)));
  const periodEndDate = new Date();
  const periodStartDate = new Date(periodEndDate.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const periodStart = periodStartDate.toISOString();
  const periodEnd = periodEndDate.toISOString();
  const tenantOrders = store
    .listOrders(organizationId)
    .filter((order) => order.createdAt >= periodStart && order.createdAt <= periodEnd);

  const providerPayments = new Map<string, ProviderPayment>();
  if (dbEnabled && pool && tenantOrders.length) {
    try {
      const result = await pool.query(
        `SELECT DISTINCT ON (p.order_id) p.order_id::text,p.provider,p.provider_ref,
                p.amount_minor,p.currency,p.status,p.created_at
         FROM payments p
         WHERE p.organization_id=$1 AND p.created_at >= $2
         ORDER BY p.order_id,p.created_at DESC`,
        [organizationUuid(organizationId), periodStart],
      );
      for (const row of result.rows) {
        providerPayments.set(row.order_id, {
          orderId: row.order_id,
          provider: row.provider,
          providerRef: row.provider_ref,
          amountMinor: Number(row.amount_minor),
          currency: String(row.currency).trim(),
          status: row.status,
          createdAt: new Date(row.created_at).toISOString(),
        });
      }
    } catch {
      // Reconciliation remains useful from the canonical order ledger while a
      // payment migration is being applied or the database is unavailable.
    }
  }

  const rows: PaymentReconciliationRow[] = tenantOrders.map((order) => {
    const payment = providerPayments.get(asUuid(order.id)) || providerPayments.get(order.id);
    return {
      orderId: order.id,
      trackingCode: order.trackingCode,
      customerName: order.customerName,
      orderAmount: order.amount,
      currency: order.currency,
      orderPaymentStatus: order.paymentStatus,
      ...(payment
        ? {
            provider: payment.provider,
            providerRef: payment.providerRef,
            providerStatus: payment.status,
            providerAmount: payment.amountMinor / 100,
            providerCurrency: payment.currency,
            paymentCreatedAt: payment.createdAt,
          }
        : {}),
      status: rowStatus(order, payment),
      createdAt: order.createdAt,
    };
  });
  const sum = (predicate: (row: PaymentReconciliationRow) => boolean) =>
    rows.filter(predicate).reduce((total, row) => total + row.orderAmount, 0);
  const count = (predicate: (row: PaymentReconciliationRow) => boolean) => rows.filter(predicate).length;
  return {
    periodStart,
    periodEnd,
    windowDays,
    currency: rows[0]?.currency || "INR",
    provider: paymentMode(),
    orderCount: rows.length,
    capturedCount: count((row) => row.orderPaymentStatus === "paid"),
    capturedAmount: sum((row) => row.orderPaymentStatus === "paid"),
    outstandingCount: count((row) => row.orderPaymentStatus === "unpaid" || row.orderPaymentStatus === "pending"),
    outstandingAmount: sum((row) => row.orderPaymentStatus === "unpaid" || row.orderPaymentStatus === "pending"),
    failedCount: count((row) => row.orderPaymentStatus === "failed"),
    failedAmount: sum((row) => row.orderPaymentStatus === "failed"),
    missingRecordCount: count((row) => row.status === "missing_record"),
    mismatchCount: count((row) => row.status === "mismatch"),
    rows,
  };
}
