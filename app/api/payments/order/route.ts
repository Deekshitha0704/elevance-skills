import { randomUUID } from "node:crypto";
import { getAuthenticatedUserId, hasTrustedMutationOrigin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getPaymentAmount, isWithinPaymentHours } from "@/lib/payments";
import { isSubscriptionPlanId, subscriptionPlans } from "@/lib/subscriptions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasTrustedMutationOrigin(request)) return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  if (!isWithinPaymentHours()) {
    return Response.json({
      error: "Payments are currently unavailable. Payments are accepted only between 5:00 AM and 11:00 AM IST.",
    }, { status: 403 });
  }

  let userId: string | null;
  try {
    userId = getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "Authentication is not configured on this server." }, { status: 503 });
  }
  if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  let planId: unknown;
  try {
    planId = (await request.json() as { planId?: unknown }).planId;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!isSubscriptionPlanId(planId) || planId === "free") {
    return Response.json({ error: "Choose a valid paid plan." }, { status: 400 });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const amount = getPaymentAmount(planId);
  if (!keyId || !keySecret || amount === null) {
    return Response.json({ error: "Payment gateway is not configured." }, { status: 503 });
  }

  const db = getDb();
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) return Response.json({ error: "Authenticated account was not found." }, { status: 401 });

  const currentSubscription = db.prepare(`
    SELECT id FROM subscriptions
    WHERE user_id = ? AND status = 'active' AND expires_at > ?
    LIMIT 1
  `).get(userId, new Date().toISOString());
  if (currentSubscription) return Response.json({ error: "Cancel or wait for your current plan to expire before upgrading." }, { status: 409 });

  const recentOrders = db.prepare(`
    SELECT COUNT(*) AS count FROM payments
    WHERE user_id = ? AND status = 'created' AND created_at >= datetime('now', '-10 minutes')
  `).get(userId) as { count: number };
  if (recentOrders.count >= 3) return Response.json({ error: "Too many pending payment attempts. Try again in 10 minutes." }, { status: 429 });

  const receipt = randomUUID();
  try {
    const gatewayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt,
        notes: { userId, planId },
      }),
    });

    if (!gatewayResponse.ok) return Response.json({ error: "Payment gateway could not create an order." }, { status: 502 });
    const order = await gatewayResponse.json() as { id?: unknown; amount?: unknown; currency?: unknown };
    if (typeof order.id !== "string" || order.amount !== amount || order.currency !== "INR") {
      return Response.json({ error: "Payment gateway returned an invalid order." }, { status: 502 });
    }

    db.prepare(`
      INSERT INTO payments (id, user_id, plan_id, gateway_order_id, amount_paise, currency, status)
      VALUES (?, ?, ?, ?, ?, 'INR', 'created')
    `).run(randomUUID(), userId, planId, order.id, amount);

    return Response.json({
      keyId,
      orderId: order.id,
      amount,
      currency: "INR",
      planName: subscriptionPlans[planId].name,
    }, { status: 201 });
  } catch {
    return Response.json({ error: "Unable to reach the payment gateway." }, { status: 502 });
  }
}
