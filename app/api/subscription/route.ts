import { randomUUID } from "node:crypto";
import { getAuthenticatedUserId, hasTrustedMutationOrigin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getCurrentSubscription, subscriptionPlans } from "@/lib/subscriptions";

export const runtime = "nodejs";

function getUserId(request: Request) {
  try {
    return { userId: getAuthenticatedUserId(request), configured: true };
  } catch {
    return { userId: null, configured: false };
  }
}

export async function GET(request: Request) {
  const auth = getUserId(request);
  if (!auth.configured) return Response.json({ error: "Authentication is not configured on this server." }, { status: 503 });
  if (!auth.userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  const subscription = getCurrentSubscription(auth.userId);
  return Response.json({
    subscription,
    plans: Object.values(subscriptionPlans),
  });
}

export async function POST(request: Request) {
  if (!hasTrustedMutationOrigin(request)) return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  const auth = getUserId(request);
  if (!auth.configured) return Response.json({ error: "Authentication is not configured on this server." }, { status: 503 });
  if (!auth.userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  let planId: unknown;
  try {
    planId = (await request.json() as { planId?: unknown }).planId;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (planId !== "free") {
    return Response.json({ error: "Paid plans must be purchased through the payment gateway." }, { status: 400 });
  }

  const db = getDb();
  const result = db.transaction(() => {
    const existing = db.prepare(`
      SELECT id FROM subscriptions
      WHERE user_id = ? AND status = 'active' AND expires_at > ?
      LIMIT 1
    `).get(auth.userId, new Date().toISOString());
    if (existing) return { ok: false as const, reason: "active_subscription_exists" as const };

    const alreadyUsedFree = db.prepare("SELECT id FROM subscriptions WHERE user_id = ? AND plan_id = 'free' LIMIT 1").get(auth.userId);
    if (alreadyUsedFree) return { ok: false as const, reason: "free_plan_already_used" as const };

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const id = randomUUID();
    db.prepare(`
      INSERT INTO subscriptions (id, user_id, plan_id, status, started_at, expires_at)
      VALUES (?, ?, 'free', 'active', ?, ?)
    `).run(id, auth.userId, now.toISOString(), expiresAt.toISOString());
    return { ok: true as const, id, expiresAt: expiresAt.toISOString() };
  })();

  if (!result.ok) return Response.json({ error: result.reason }, { status: 409 });
  return Response.json({ subscriptionId: result.id, planId: "free", expiresAt: result.expiresAt }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!hasTrustedMutationOrigin(request)) return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  const auth = getUserId(request);
  if (!auth.configured) return Response.json({ error: "Authentication is not configured on this server." }, { status: 503 });
  if (!auth.userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  const db = getDb();
  const result = db.prepare(`
    UPDATE subscriptions SET cancelled_at = ?
    WHERE id = (
      SELECT id FROM subscriptions
      WHERE user_id = ? AND status = 'active' AND expires_at > ? AND cancelled_at IS NULL
      ORDER BY expires_at DESC LIMIT 1
    )
  `).run(new Date().toISOString(), auth.userId, new Date().toISOString());

  if (result.changes === 0) return Response.json({ error: "No active subscription is available to cancel." }, { status: 404 });
  return Response.json({ cancelled: true, accessContinuesUntilExpiry: true });
}
