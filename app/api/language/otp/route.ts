import { randomInt, randomUUID } from "node:crypto";
import { getAuthenticatedUserId, hasTrustedMutationOrigin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { deliverOtp, hashOtp, type OtpChannel } from "@/lib/otp";
import { supportedLanguages, type Language } from "@/lib/i18n";

export const runtime = "nodejs";

const otpLifetimeMs = 5 * 60 * 1000;
const resendCooldownMs = 60 * 1000;
const maxSendsPerHour = 5;

function maskDestination(channel: OtpChannel, destination: string) {
  if (channel === "email") {
    const [name, domain] = destination.split("@");
    return `${name.slice(0, 1)}***@${domain}`;
  }
  return `${destination.slice(0, 3)}***${destination.slice(-2)}`;
}

export async function GET(request: Request) {
  let userId: string | null;
  try {
    userId = getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "Authentication is not configured on this server." }, { status: 503 });
  }
  if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  const user = getDb().prepare("SELECT preferred_language FROM users WHERE id = ?").get(userId) as { preferred_language: Language } | undefined;
  if (!user) return Response.json({ error: "Authenticated account was not found." }, { status: 401 });
  return Response.json({ language: user.preferred_language });
}

export async function POST(request: Request) {
  if (!hasTrustedMutationOrigin(request)) return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  let userId: string | null;
  try {
    userId = getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "Authentication is not configured on this server." }, { status: 503 });
  }
  if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  let language: unknown;
  try {
    language = (await request.json() as { language?: unknown }).language;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof language !== "string" || !supportedLanguages.some((item) => item.code === language)) {
    return Response.json({ error: "Unsupported language.", code: "unsupported_language" }, { status: 400 });
  }

  const db = getDb();
  const user = db.prepare("SELECT email, phone FROM users WHERE id = ?").get(userId) as { email: string | null; phone: string | null } | undefined;
  if (!user) return Response.json({ error: "Authenticated account was not found." }, { status: 401 });

  const channel: OtpChannel = language === "fr" ? "email" : "sms";
  const destination = channel === "email" ? user.email : user.phone;
  if (!destination) {
    return Response.json({ error: `A registered ${channel} address is required.`, code: "contact_missing" }, { status: 409 });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const challengeId = randomUUID();
  const code = String(randomInt(100000, 1000000));
  let storedHash: Buffer;
  try {
    storedHash = hashOtp(challengeId, userId, language, code);
  } catch {
    return Response.json({ error: "OTP verification is not configured on this server." }, { status: 503 });
  }

  const createChallenge = db.transaction(() => {
    const lock = db.prepare("SELECT failed_attempts, locked_until FROM otp_lockouts WHERE user_id = ?").get(userId) as { failed_attempts: number; locked_until: string | null } | undefined;
    if (lock?.locked_until && Date.parse(lock.locked_until) > now.getTime()) {
      return { ok: false as const, code: "locked" as const, retryAfterSeconds: Math.ceil((Date.parse(lock.locked_until) - now.getTime()) / 1000) };
    }
    if (lock?.locked_until && Date.parse(lock.locked_until) <= now.getTime()) {
      db.prepare("UPDATE otp_lockouts SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?").run(userId);
    }

    const latest = db.prepare("SELECT last_sent_at FROM otp_challenges WHERE user_id = ? ORDER BY last_sent_at DESC LIMIT 1").get(userId) as { last_sent_at: string } | undefined;
    if (latest && now.getTime() - Date.parse(latest.last_sent_at) < resendCooldownMs) {
      return { ok: false as const, code: "cooldown" as const, retryAfterSeconds: Math.ceil((resendCooldownMs - (now.getTime() - Date.parse(latest.last_sent_at))) / 1000) };
    }

    const recentSends = db.prepare("SELECT COUNT(*) AS count FROM otp_challenges WHERE user_id = ? AND last_sent_at >= ?").get(userId, new Date(now.getTime() - 60 * 60 * 1000).toISOString()) as { count: number };
    if (recentSends.count >= maxSendsPerHour) {
      return { ok: false as const, code: "send_limit" as const, retryAfterSeconds: 3600 };
    }

    db.prepare("UPDATE otp_challenges SET verified_at = ? WHERE user_id = ? AND verified_at IS NULL").run(nowIso, userId);
    db.prepare(`
      INSERT INTO otp_challenges (id, user_id, language, channel, code_hash, expires_at, last_sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(challengeId, userId, language, channel, storedHash.toString("hex"), new Date(now.getTime() + otpLifetimeMs).toISOString(), nowIso);
    return { ok: true as const };
  });

  const issued = createChallenge();
  if (!issued.ok) return Response.json({ error: issued.code, code: issued.code, retryAfterSeconds: issued.retryAfterSeconds }, { status: 429 });

  try {
    await deliverOtp(channel, destination, code);
  } catch {
    db.prepare("UPDATE otp_challenges SET expires_at = ?, verified_at = ? WHERE id = ? AND user_id = ?").run(nowIso, nowIso, challengeId, userId);
    return Response.json({ error: "OTP delivery is unavailable. Verify the delivery provider configuration.", code: "delivery_unavailable" }, { status: 503 });
  }

  return Response.json({
    challengeId,
    channel,
    destination: maskDestination(channel, destination),
    expiresAt: new Date(now.getTime() + otpLifetimeMs).toISOString(),
  }, { status: 201 });
}
