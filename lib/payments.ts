import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { isSubscriptionPlanId, subscriptionPlans } from "@/lib/subscriptions";

function getRazorpaySecret() {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error("RAZORPAY_KEY_SECRET is not configured");
  return secret;
}

function safeHexEqual(actual: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function isWithinPaymentHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return hour >= 5 && hour < 11;
}

export function verifyRazorpayPaymentSignature(orderId: string, paymentId: string, signature: string) {
  const expected = createHmac("sha256", getRazorpaySecret()).update(`${orderId}|${paymentId}`).digest("hex");
  return safeHexEqual(signature, expected);
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not configured");
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return safeHexEqual(signature, expected);
}

export function activateVerifiedPayment(userId: string, orderId: string, paymentId: string) {
  const db = getDb();
  const transaction = db.transaction(() => {
    const payment = db.prepare(`
      SELECT id, plan_id, status, gateway_payment_id
      FROM payments
      WHERE user_id = ? AND gateway_order_id = ?
    `).get(userId, orderId) as { id: string; plan_id: string; status: string; gateway_payment_id: string | null } | undefined;

    if (!payment || !isSubscriptionPlanId(payment.plan_id) || payment.plan_id === "free") {
      return { ok: false as const, reason: "payment_not_found" as const };
    }
    if (payment.status === "paid" && payment.gateway_payment_id === paymentId) {
      const subscription = db.prepare("SELECT id, expires_at FROM subscriptions WHERE id = (SELECT subscription_id FROM payments WHERE id = ?)").get(payment.id) as { id: string; expires_at: string } | undefined;
      return subscription ? { ok: true as const, subscriptionId: subscription.id, expiresAt: subscription.expires_at } : { ok: false as const, reason: "payment_not_found" as const };
    }
    if (payment.status !== "created") return { ok: false as const, reason: "payment_not_pending" as const };

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const subscriptionId = randomUUID();
    db.prepare(`
      INSERT INTO subscriptions (id, user_id, plan_id, status, started_at, expires_at)
      VALUES (?, ?, ?, 'active', ?, ?)
    `).run(subscriptionId, userId, payment.plan_id, now.toISOString(), expiresAt.toISOString());
    db.prepare(`
      UPDATE payments SET subscription_id = ?, gateway_payment_id = ?, status = 'paid' WHERE id = ?
    `).run(subscriptionId, paymentId, payment.id);

    return { ok: true as const, subscriptionId, expiresAt: expiresAt.toISOString() };
  });

  return transaction();
}

export function getPaymentAmount(planId: string) {
  if (!isSubscriptionPlanId(planId) || planId === "free") return null;
  return subscriptionPlans[planId].priceRupees * 100;
}

export async function sendPaymentReceiptEmail(paymentId: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return false;

  const db = getDb();
  const claim = db.transaction(() => {
    const payment = db.prepare(`
      SELECT p.user_id, p.plan_id, p.amount_paise, p.gateway_payment_id, p.receipt_email_sent_at,
        u.email, s.expires_at
      FROM payments p
      JOIN subscriptions s ON s.id = p.subscription_id
      JOIN users u ON u.id = p.user_id
      WHERE p.id = ? AND p.status = 'paid'
    `).get(paymentId) as {
      user_id: string;
      plan_id: string;
      amount_paise: number;
      gateway_payment_id: string | null;
      receipt_email_sent_at: string | null;
      email: string | null;
      expires_at: string;
    } | undefined;

    if (!payment?.email || !payment.gateway_payment_id || !isSubscriptionPlanId(payment.plan_id)) return null;
    if (payment.receipt_email_sent_at && Date.parse(payment.receipt_email_sent_at) > Date.now() - 10 * 60 * 1000) return null;

    const claimedAt = new Date().toISOString();
    db.prepare("UPDATE payments SET receipt_email_sent_at = ? WHERE id = ?").run(claimedAt, paymentId);
    return { ...payment, claimedAt };
  })();

  if (!claim) return false;
  const planName = subscriptionPlans[claim.plan_id as keyof typeof subscriptionPlans].name;
  const amountRupees = (claim.amount_paise / 100).toFixed(2);
  const body = [
    "Payment receipt",
    "",
    `Plan: ${planName}`,
    `Amount paid: INR ${amountRupees}`,
    `Gateway payment reference: ${claim.gateway_payment_id}`,
    `Access valid through: ${claim.expires_at}`,
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `payment-receipt-${paymentId}`,
      },
      body: JSON.stringify({
        from,
        to: [claim.email],
        subject: `Elevance Skills ${planName} payment receipt`,
        text: body,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error("Receipt delivery failed");
    db.prepare("UPDATE payments SET receipt_email_sent_at = ? WHERE id = ? AND receipt_email_sent_at = ?").run(new Date().toISOString(), paymentId, claim.claimedAt);
    return true;
  } catch {
    db.prepare("UPDATE payments SET receipt_email_sent_at = NULL WHERE id = ? AND receipt_email_sent_at = ?").run(paymentId, claim.claimedAt);
    return false;
  }
}
