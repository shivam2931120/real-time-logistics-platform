import type {
  Order,
  PaymentSettlementRow,
  PaymentSettlementSummary,
  SettlementMatchStatus,
  SettlementReviewStatus,
} from "@routepulse/shared";
import { dbEnabled, pool } from "../db/client.js";
import { asUuid, demoOrganizationId, demoOrganizationUuid } from "../db/persistence.js";
import { store } from "../domain/store.js";

const providerName = "razorpay";
const memory = new Map<string, PaymentSettlementRow[]>();
const organizationUuid = (value: string) =>
  value === demoOrganizationId ? demoOrganizationUuid : asUuid(value);

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, "_");

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    if (row.some((value) => value.length)) rows.push(row);
  }
  return rows;
}

function numberValue(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[₹,]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateValue(value: string | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

const statusFor = (
  order: Order | undefined,
  providerStatus: string,
  providerAmount: number,
  currency: string,
): SettlementMatchStatus => {
  const normalizedStatus = normalize(providerStatus);
  if (normalizedStatus.includes("chargeback")) return "chargeback";
  if (normalizedStatus.includes("refund")) return "refund";
  if (!order) return "missing_order";
  if (Math.abs(order.amount - providerAmount) > 0.01) return "amount_mismatch";
  if (order.currency.toUpperCase() !== currency.toUpperCase()) return "currency_mismatch";
  return "matched";
};

function findOrder(orders: Order[], row: Record<string, string>) {
  const localId = row.order_id || row.routepulse_order_id;
  const tracking = row.tracking_code || row.tracking;
  return orders.find(
    (order) =>
      (localId && (order.id === localId || asUuid(order.id) === localId)) ||
      (tracking && order.trackingCode.toLowerCase() === tracking.toLowerCase()),
  );
}

async function persistRows(rows: PaymentSettlementRow[]) {
  if (!dbEnabled || !pool) return;
  try {
    for (const row of rows) {
      await pool.query(
        `INSERT INTO payment_settlement_records
           (id,organization_id,provider,provider_ref,order_id,tracking_code,order_amount_minor,provider_amount_minor,fee_amount_minor,net_amount_minor,currency,provider_status,match_status,review_status,note,settled_at,imported_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT(organization_id,provider,provider_ref) DO UPDATE SET
           order_id=EXCLUDED.order_id,tracking_code=EXCLUDED.tracking_code,order_amount_minor=EXCLUDED.order_amount_minor,
           provider_amount_minor=EXCLUDED.provider_amount_minor,fee_amount_minor=EXCLUDED.fee_amount_minor,net_amount_minor=EXCLUDED.net_amount_minor,
           currency=EXCLUDED.currency,provider_status=EXCLUDED.provider_status,match_status=EXCLUDED.match_status,settled_at=EXCLUDED.settled_at,imported_at=EXCLUDED.imported_at`,
        [
          row.id,
          organizationUuid(row.organizationId),
          row.provider,
          row.providerRef,
          row.orderId ? asUuid(row.orderId) : null,
          row.trackingCode || null,
          row.orderAmount === undefined ? null : Math.round(row.orderAmount * 100),
          Math.round(row.providerAmount * 100),
          row.feeAmount === undefined ? null : Math.round(row.feeAmount * 100),
          row.netAmount === undefined ? null : Math.round(row.netAmount * 100),
          row.currency,
          row.providerStatus,
          row.matchStatus,
          row.reviewStatus,
          row.note || null,
          row.settledAt || null,
          row.importedAt,
        ],
      );
    }
  } catch {
    // Keep the local ledger available while the database is temporarily unavailable.
  }
}

function mergeRows(organizationId: string, imported: PaymentSettlementRow[]) {
  const current = memory.get(organizationId) || [];
  const byRef = new Map(current.map((item) => [`${item.provider}:${item.providerRef}`, item]));
  for (const row of imported) {
    const previous = byRef.get(`${row.provider}:${row.providerRef}`);
    byRef.set(`${row.provider}:${row.providerRef}`, {
      ...row,
      id: previous?.id || row.id,
      reviewStatus: previous?.reviewStatus || row.reviewStatus,
      note: previous?.note || row.note,
    });
  }
  memory.set(
    organizationId,
    [...byRef.values()].sort((a, b) => b.importedAt.localeCompare(a.importedAt)).slice(0, 1_000),
  );
}

export async function importSettlementCsv(organizationId: string, csv: string) {
  if (csv.length > 100_000) throw new Error("Settlement CSV must be 100 KB or smaller");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("Settlement CSV must contain a header and at least one row");
  if (rows.length > 501) throw new Error("Settlement CSV may contain at most 500 rows");
  const headers = rows[0]!.map(normalize);
  const required = ["payment_id", "provider_ref", "amount", "currency"];
  const hasProviderRef = required.slice(0, 2).some((key) => headers.includes(key));
  if (!hasProviderRef || !headers.includes("amount") || !headers.includes("currency"))
    throw new Error("CSV needs payment_id or provider_ref, amount, and currency columns");
  const orders = store.listOrders(organizationId);
  const importedAt = new Date().toISOString();
  const imported: PaymentSettlementRow[] = [];
  for (const values of rows.slice(1)) {
    const raw = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    const providerRef = raw.payment_id || raw.provider_ref;
    const providerAmount = numberValue(raw.amount);
    const currency = String(raw.currency || "").trim().toUpperCase();
    if (!providerRef || providerAmount === undefined || !/^[A-Z]{3}$/.test(currency))
      throw new Error("Each settlement row needs a payment reference, numeric amount, and 3-letter currency");
    const order = findOrder(orders, raw);
    const matchStatus = statusFor(order, raw.status || "settled", providerAmount, currency);
    imported.push({
      id: crypto.randomUUID(),
      organizationId,
      provider: providerName,
      providerRef,
      orderId: order?.id,
      trackingCode: order?.trackingCode || raw.tracking_code || raw.tracking || undefined,
      orderAmount: order?.amount,
      providerAmount,
      feeAmount: numberValue(raw.fee),
      netAmount: numberValue(raw.settlement_amount || raw.net_amount || raw.net),
      currency,
      providerStatus: raw.status || "settled",
      matchStatus,
      reviewStatus: matchStatus === "matched" ? "accepted" : "pending",
      settledAt: dateValue(raw.settled_at || raw.settlement_date),
      importedAt,
    });
  }
  mergeRows(organizationId, imported);
  await persistRows(imported);
  return summarize(organizationId, importedAt);
}

export interface ProviderSettlementEventInput {
  organizationId: string;
  providerRef: string;
  orderId?: string;
  trackingCode?: string;
  providerAmount: number;
  currency: string;
  providerStatus: string;
  feeAmount?: number;
  netAmount?: number;
  note?: string;
  settledAt?: string;
}

export async function recordProviderSettlementEvent(input: ProviderSettlementEventInput) {
  const providerRef = input.providerRef.trim();
  const currency = input.currency.trim().toUpperCase();
  if (!providerRef || providerRef.length > 160) throw new Error("Provider settlement reference is invalid");
  if (!Number.isFinite(input.providerAmount) || input.providerAmount < 0)
    throw new Error("Provider settlement amount is invalid");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Provider settlement currency is invalid");
  const order = store.listOrders(input.organizationId).find(
    (candidate) =>
      (input.orderId && (candidate.id === input.orderId || asUuid(candidate.id) === input.orderId)) ||
      (input.trackingCode && candidate.trackingCode.toLowerCase() === input.trackingCode.toLowerCase()),
  );
  const importedAt = new Date().toISOString();
  const existing = (memory.get(input.organizationId) || []).find(
    (row) => row.provider === providerName && row.providerRef === providerRef,
  );
  const matchStatus = statusFor(order, input.providerStatus, input.providerAmount, currency);
  const row: PaymentSettlementRow = {
    id: existing?.id || crypto.randomUUID(),
    organizationId: input.organizationId,
    provider: providerName,
    providerRef,
    orderId: order?.id,
    trackingCode: order?.trackingCode || input.trackingCode,
    orderAmount: order?.amount,
    providerAmount: input.providerAmount,
    feeAmount: input.feeAmount,
    netAmount: input.netAmount,
    currency,
    providerStatus: input.providerStatus,
    matchStatus,
    reviewStatus: existing?.reviewStatus || (matchStatus === "matched" ? "accepted" : "pending"),
    note: input.note || existing?.note,
    settledAt: input.settledAt,
    importedAt,
  };
  mergeRows(input.organizationId, [row]);
  await persistRows([row]);
  return row;
}

async function loadPersisted(organizationId: string) {
  if (!dbEnabled || !pool) return;
  try {
    const result = await pool.query(
      `SELECT id::text,provider,provider_ref,order_id::text,tracking_code,order_amount_minor,provider_amount_minor,fee_amount_minor,net_amount_minor,currency,provider_status,match_status,review_status,note,settled_at,imported_at
       FROM payment_settlement_records WHERE organization_id=$1 ORDER BY imported_at DESC LIMIT 1000`,
      [organizationUuid(organizationId)],
    );
    const rows = result.rows.map((row) => ({
      id: row.id,
      organizationId,
      provider: row.provider,
      providerRef: row.provider_ref,
      orderId: row.order_id || undefined,
      trackingCode: row.tracking_code || undefined,
      orderAmount: row.order_amount_minor === null ? undefined : Number(row.order_amount_minor) / 100,
      providerAmount: Number(row.provider_amount_minor) / 100,
      feeAmount: row.fee_amount_minor === null ? undefined : Number(row.fee_amount_minor) / 100,
      netAmount: row.net_amount_minor === null ? undefined : Number(row.net_amount_minor) / 100,
      currency: String(row.currency).trim(),
      providerStatus: row.provider_status,
      matchStatus: row.match_status,
      reviewStatus: row.review_status,
      note: row.note || undefined,
      settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : undefined,
      importedAt: new Date(row.imported_at).toISOString(),
    })) as PaymentSettlementRow[];
    if (rows.length) memory.set(organizationId, rows);
  } catch {
    // A database migration should not make the review page unavailable.
  }
}

function summarize(organizationId: string, importedAt?: string): PaymentSettlementSummary {
  const rows = memory.get(organizationId) || [];
  const mismatch = rows.filter((row) => ["amount_mismatch", "currency_mismatch"].includes(row.matchStatus));
  return {
    provider: providerName,
    importedAt: importedAt || rows[0]?.importedAt,
    rowCount: rows.length,
    matchedCount: rows.filter((row) => row.matchStatus === "matched").length,
    reviewCount: rows.filter((row) => row.reviewStatus === "pending").length,
    missingOrderCount: rows.filter((row) => row.matchStatus === "missing_order").length,
    mismatchCount: mismatch.length,
    refundCount: rows.filter((row) => row.matchStatus === "refund" || row.matchStatus === "chargeback").length,
    rows,
  };
}

export async function listSettlementRows(organizationId: string) {
  await loadPersisted(organizationId);
  return summarize(organizationId);
}

export async function reviewSettlement(
  organizationId: string,
  id: string,
  reviewStatus: SettlementReviewStatus,
  note?: string,
) {
  await loadPersisted(organizationId);
  const rows = memory.get(organizationId) || [];
  const row = rows.find((item) => item.id === id);
  if (!row) return undefined;
  row.reviewStatus = reviewStatus;
  row.note = note?.trim() || undefined;
  if (dbEnabled && pool) {
    try {
      await pool.query(
        `UPDATE payment_settlement_records SET review_status=$1,note=$2 WHERE organization_id=$3 AND id=$4`,
        [reviewStatus, row.note || null, organizationUuid(organizationId), id],
      );
    } catch {
      // Keep the local review state available if the database is temporarily unavailable.
    }
  }
  return row;
}
