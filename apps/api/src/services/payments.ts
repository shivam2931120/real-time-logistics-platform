import Razorpay from "razorpay";
import { createHmac } from "node:crypto";
import type { Order } from "@routepulse/shared";
import {
  asUuid,
  paymentOrderId,
  persistPaymentRecord,
} from "../db/persistence.js";

const razorpayOrders = new Map<string, string>();

export async function createCheckout(order: Order) {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
    return {
      provider: "demo",
      url: `/payments/demo/${order.id}`,
      sessionId: `demo_${order.id}`,
    };
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  const created = await razorpay.orders.create({
    amount: Math.round(order.amount * 100),
    currency: order.currency,
    receipt: order.trackingCode,
    notes: { routepulseOrderId: order.id, organizationId: order.organizationId },
  });
  razorpayOrders.set(created.id, order.id);
  await persistPaymentRecord({
    organizationId: order.organizationId,
    orderId: order.id,
    provider: "razorpay_order",
    providerRef: created.id,
    amountMinor: Number(created.amount),
    currency: created.currency,
    status: created.status || "created",
  });
  return {
    provider: "razorpay",
    keyId: process.env.RAZORPAY_KEY_ID,
    razorpayOrderId: created.id,
    amount: created.amount,
    currency: created.currency,
  };
}

export async function verifyRazorpayPayment(
  orderId: string,
  razorpayOrderId: string,
  paymentId: string,
  signature: string,
) {
  if (!process.env.RAZORPAY_KEY_SECRET) return false;
  const mappedOrderId =
    razorpayOrders.get(razorpayOrderId) ||
    (await paymentOrderId("razorpay_order", razorpayOrderId));
  if (
    !mappedOrderId ||
    (mappedOrderId !== orderId && mappedOrderId !== asUuid(orderId))
  )
    return false;
  const expected = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${paymentId}`)
    .digest("hex");
  if (expected !== signature) return false;
  return true;
}

export async function orderIdForRazorpayOrder(razorpayOrderId: string) {
  return (
    razorpayOrders.get(razorpayOrderId) ||
    (await paymentOrderId("razorpay_order", razorpayOrderId))
  );
}

export function verifyRazorpayWebhook(raw: Buffer, signature: string) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(raw)
    .digest("hex");
  return expected === signature;
}

export const paymentMode = () =>
  process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ? "razorpay"
    : "demo";
