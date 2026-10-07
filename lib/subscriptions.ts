import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { StoryMediaType, StoryPrivacy } from "@/lib/db";

export const subscriptionPlans = {
  free: { id: "free", name: "Free", priceRupees: 0, monthlyPostLimit: 1 },
  bronze: { id: "bronze", name: "Bronze", priceRupees: 100, monthlyPostLimit: 3 },
  silver: { id: "silver", name: "Silver", priceRupees: 300, monthlyPostLimit: 5 },
  gold: { id: "gold", name: "Gold", priceRupees: 1000, monthlyPostLimit: null },
} as const;

export type SubscriptionPlanId = keyof typeof subscriptionPlans;

export function isSubscriptionPlanId(value: unknown): value is SubscriptionPlanId {
  return typeof value === "string" && Object.hasOwn(subscriptionPlans, value);
}

function monthStartUtc(now: Date) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`;
}

function nextMonthStartUtc(now: Date) {
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`;
}

export function getCurrentSubscription(userId: string, now = new Date()) {
  const db = getDb();
  const active = db.prepare(`
    SELECT id, plan_id, status, started_at, expires_at, cancelled_at
    FROM subscriptions
    WHERE user_id = ? AND status = 'active' AND started_at <= ? AND expires_at > ?
    ORDER BY expires_at DESC
    LIMIT 1
  `).get(userId, now.toISOString(), now.toISOString()) as {
    id: string;
    plan_id: SubscriptionPlanId;
    status: string;
    started_at: string;
    expires_at: string;
    cancelled_at: string | null;
  } | undefined;

  if (!active || !isSubscriptionPlanId(active.plan_id)) return null;

  const postCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM stories
    WHERE owner_id = ? AND created_at >= ? AND created_at < ?
  `).get(userId, monthStartUtc(now), nextMonthStartUtc(now)) as { count: number };

  return {
    ...active,
    plan: subscriptionPlans[active.plan_id],
    monthlyPostCount: postCount.count,
  };
}

export type CreatePostInput = {
  ownerId: string;
  privacy: StoryPrivacy;
  media: Array<{ url: string; mediaType: StoryMediaType; thumbnailUrl?: string; position?: number }>;
  highlightTitle?: string;
};

export function createPostWithSubscription(input: CreatePostInput, now = new Date()) {
  const db = getDb();
  const storyId = randomUUID();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const transaction = db.transaction(() => {
    const subscription = db.prepare(`
      SELECT plan_id
      FROM subscriptions
      WHERE user_id = ? AND status = 'active' AND started_at <= ? AND expires_at > ?
      ORDER BY expires_at DESC
      LIMIT 1
    `).get(input.ownerId, now.toISOString(), now.toISOString()) as { plan_id: string } | undefined;

    if (!subscription || !isSubscriptionPlanId(subscription.plan_id)) {
      return { ok: false as const, reason: "active_subscription_required" as const };
    }

    const plan = subscriptionPlans[subscription.plan_id];
    const postCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM stories
      WHERE owner_id = ? AND created_at >= ? AND created_at < ?
    `).get(input.ownerId, monthStartUtc(now), nextMonthStartUtc(now)) as { count: number };

    if (plan.monthlyPostLimit !== null && postCount.count >= plan.monthlyPostLimit) {
      return { ok: false as const, reason: "monthly_post_limit_reached" as const, limit: plan.monthlyPostLimit, postCount: postCount.count };
    }

    db.prepare(`
      INSERT INTO stories (id, owner_id, privacy, created_at, expires_at, highlight_title)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(storyId, input.ownerId, input.privacy, now.toISOString(), expiresAt, input.highlightTitle ?? null);

    const insertMedia = db.prepare(`
      INSERT INTO story_media (id, story_id, media_type, url, thumbnail_url, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const [index, item] of input.media.entries()) {
      insertMedia.run(randomUUID(), storyId, item.mediaType, item.url, item.thumbnailUrl ?? null, item.position ?? index);
    }

    return { ok: true as const, storyId, expiresAt, monthlyPostCount: postCount.count + 1, monthlyPostLimit: plan.monthlyPostLimit };
  });

  return transaction();
}
