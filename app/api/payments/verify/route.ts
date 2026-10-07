import { getAuthenticatedUserId, hasTrustedMutationOrigin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { activateVerifiedPayment, getPaymentAmount, sendPaymentReceiptEmail, verifyRazorpayPaymentSignature } from "@/lib/payments";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasTrustedMutationOrigin(request)) return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  let userId: string | null;
  try {
    userId = getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "Authentication is not configured on this server." }, { status: 503 });
  }
  if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  let body: { orderId?: unknown; paymentId?: unknown; signature?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.orderId !== "string" || typeof body.paymentId !== "string" || typeof body.signature !== "string") {
    return Response.json({ error: "Payment verification details are incomplete." }, { status: 400 });
  }

  const db = getDb();
  const pending = db.prepare(`
    SELECT id, plan_id, amount_paise, currency FROM payments
    WHERE user_id = ? AND gateway_order_id = ?
  `).get(userId, body.orderId) as { id: string; plan_id: string; amount_paise: number; currency: string } | undefined;
  if (!pending || getPaymentAmount(pending.plan_id) !== pending.amount_paise || pending.currency !== "INR") {
    return Response.json({ error: "Payment order was not found or does not match the expected amount." }, { status: 404 });
  }

  try {
    if (!verifyRazorpayPaymentSignature(body.orderId, body.paymentId, body.signature)) {
      return Response.json({ error: "Payment signature verification failed." }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Payment verification is not configured on this server." }, { status: 503 });
  }

  const result = activateVerifiedPayment(userId, body.orderId, body.paymentId);
  if (!result.ok) return Response.json({ error: "Payment is not eligible for activation." }, { status: 409 });
  const receiptSent = await sendPaymentReceiptEmail(pending.id);
  return Response.json({ subscriptionId: result.subscriptionId, expiresAt: result.expiresAt, receiptSent });
}
