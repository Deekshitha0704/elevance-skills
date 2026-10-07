import { getDb } from "@/lib/db";
import { activateVerifiedPayment, getPaymentAmount, sendPaymentReceiptEmail, verifyRazorpayWebhookSignature } from "@/lib/payments";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  try {
    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
      return Response.json({ error: "Invalid webhook signature." }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Payment webhook is not configured on this server." }, { status: 503 });
  }

  let event: {
    event?: unknown;
    payload?: {
      payment?: {
        entity?: { id?: unknown; order_id?: unknown; amount?: unknown; currency?: unknown };
      };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const payment = event.payload?.payment?.entity;
  if (event.event !== "payment.captured" && event.event !== "payment.failed") {
    return Response.json({ received: true, ignored: true });
  }
  if (typeof payment?.id !== "string" || typeof payment.order_id !== "string") {
    return Response.json({ error: "Webhook payment details are incomplete." }, { status: 400 });
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT id, user_id, plan_id, amount_paise, currency, status
    FROM payments WHERE gateway_order_id = ?
  `).get(payment.order_id) as {
    id: string;
    user_id: string;
    plan_id: string;
    amount_paise: number;
    currency: string;
    status: string;
  } | undefined;
  if (!row) return Response.json({ received: true, ignored: true });

  if (event.event === "payment.failed") {
    db.prepare("UPDATE payments SET status = 'failed', gateway_payment_id = ? WHERE gateway_order_id = ? AND status = 'created'").run(payment.id, payment.order_id);
    return Response.json({ received: true });
  }

  if (payment.amount !== row.amount_paise || payment.currency !== row.currency || getPaymentAmount(row.plan_id) !== row.amount_paise) {
    return Response.json({ error: "Captured payment does not match the recorded order." }, { status: 400 });
  }

  const result = activateVerifiedPayment(row.user_id, payment.order_id, payment.id);
  if (!result.ok) return Response.json({ error: "Unable to activate subscription for this payment." }, { status: 409 });
  const receiptSent = await sendPaymentReceiptEmail(row.id);
  return Response.json({ received: true, subscriptionId: result.subscriptionId, receiptSent });
}
