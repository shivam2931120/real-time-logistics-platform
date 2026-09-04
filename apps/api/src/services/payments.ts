import Razorpay from 'razorpay';
import { createHmac } from 'node:crypto';
import type { Order } from '@routepulse/shared';
const razorpayOrders = new Map<string, string>();
export async function createCheckout(order: Order) {
  if(!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return {provider:'demo',url:`/payments/demo/${order.id}`,sessionId:`demo_${order.id}`};
  const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  const created = await razorpay.orders.create({ amount: Math.round(order.amount * 100), currency: order.currency, receipt: order.trackingCode, notes: { routepulseOrderId: order.id, organizationId: order.organizationId } });
  razorpayOrders.set(created.id, order.id);
  return { provider:'razorpay', keyId:process.env.RAZORPAY_KEY_ID, razorpayOrderId:created.id, amount:created.amount, currency:created.currency };
}
export function verifyRazorpayPayment(orderId:string, razorpayOrderId:string, paymentId:string, signature:string) { if(razorpayOrders.get(razorpayOrderId)!==orderId || !process.env.RAZORPAY_KEY_SECRET) return false; const expected=createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${razorpayOrderId}|${paymentId}`).digest('hex'); return expected===signature; }
export const orderIdForRazorpayOrder=(razorpayOrderId:string)=>razorpayOrders.get(razorpayOrderId);
export function verifyRazorpayWebhook(raw:Buffer, signature:string) { if(!process.env.RAZORPAY_WEBHOOK_SECRET) return false; const expected=createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex'); return expected===signature; }
export const paymentMode=()=>process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET?'razorpay':'demo';
