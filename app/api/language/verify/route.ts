import { getAuthenticatedUserId, hasTrustedMutationOrigin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hashOtp, matchesOtpHash } from "@/lib/otp";
import { supportedLanguages, type Language } from "@/lib/i18n";

export const runtime = "nodejs";

const maxFailedAttempts = 5;
const lockoutMs = 15 * 60 * 1000;

export async function POST(request: Request) {
  if (!hasTrustedMutationOrigin(request)) return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  let userId: string | null;
  try {
    userId = getAuthenticatedUserId(request);
  } catch {
    return Response.json({ error: "Authentication is not configured on this server." }, { status: 503 });
  }
  if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  let body: { challengeId?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.challengeId !== "string" || typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) {
    return Response.json({ error: "Enter the six-digit verification code.", code: "invalid_input" }, { status: 400 });
  }
  const challengeId = body.challengeId;
  const code = body.code;

  const db = getDb();
  const now = new Date();
  const lock = db.prepare("SELECT locked_until FROM otp_lockouts WHERE user_id = ?").get(userId) as { locked_until: string | null } | undefined;
  if (lock?.locked_until && Date.parse(lock.locked_until) > now.getTime()) {
    return Response.json({
      error: "Too many failed attempts. Try again later.",
      code: "locked",
      retryAfterSeconds: Math.ceil((Date.parse(lock.locked_until) - now.getTime()) / 1000),
    }, { status: 429 });
  }

  const challenge = db.prepare(`
    SELECT language, code_hash, expires_at, attempts, verified_at
    FROM otp_challenges WHERE id = ? AND user_id = ?
  `).get(challengeId, userId) as {
    language: Language;
    code_hash: string;
    expires_at: string;
    attempts: number;
    verified_at: string | null;
  } | undefined;
  if (!challenge || challenge.verified_at) return Response.json({ error: "This verification request is no longer active.", code: "challenge_inactive" }, { status: 409 });
  if (!supportedLanguages.some((item) => item.code === challenge.language)) return Response.json({ error: "Unsupported language.", code: "unsupported_language" }, { status: 400 });
  if (Date.parse(challenge.expires_at) <= now.getTime()) return Response.json({ error: "The OTP has expired. Request a new code.", code: "expired" }, { status: 410 });

  let expectedHash: Buffer;
  try {
    expectedHash = hashOtp(challengeId, userId, challenge.language, code);
  } catch {
    return Response.json({ error: "OTP verification is not configured on this server." }, { status: 503 });
  }

  if (!matchesOtpHash(challenge.code_hash, expectedHash)) {
    const result = db.transaction(() => {
      db.prepare("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ? AND user_id = ? AND verified_at IS NULL").run(challengeId, userId);
      db.prepare("INSERT OR IGNORE INTO otp_lockouts (user_id, failed_attempts) VALUES (?, 0)").run(userId);
      db.prepare("UPDATE otp_lockouts SET failed_attempts = failed_attempts + 1 WHERE user_id = ?").run(userId);
      const state = db.prepare("SELECT failed_attempts FROM otp_lockouts WHERE user_id = ?").get(userId) as { failed_attempts: number };
      if (state.failed_attempts >= maxFailedAttempts) {
        const lockedUntil = new Date(now.getTime() + lockoutMs).toISOString();
        db.prepare("UPDATE otp_lockouts SET locked_until = ? WHERE user_id = ?").run(lockedUntil, userId);
        db.prepare("UPDATE otp_challenges SET verified_at = ?, expires_at = ? WHERE user_id = ? AND verified_at IS NULL").run(now.toISOString(), now.toISOString(), userId);
        return { locked: true, retryAfterSeconds: Math.ceil(lockoutMs / 1000) };
      }
      return { locked: false, attemptsRemaining: maxFailedAttempts - state.failed_attempts };
    })();
    return Response.json({ error: result.locked ? "Too many failed attempts. Try again later." : "The verification code is incorrect.", code: result.locked ? "locked" : "incorrect", ...result }, { status: result.locked ? 429 : 400 });
  }

  const applied = db.transaction(() => {
    const result = db.prepare("UPDATE otp_challenges SET verified_at = ? WHERE id = ? AND user_id = ? AND verified_at IS NULL AND expires_at > ?").run(now.toISOString(), challengeId, userId, now.toISOString());
    if (result.changes !== 1) return false;
    db.prepare("UPDATE users SET preferred_language = ? WHERE id = ?").run(challenge.language, userId);
    db.prepare("DELETE FROM otp_lockouts WHERE user_id = ?").run(userId);
    return true;
  })();

  if (!applied) return Response.json({ error: "This verification request has expired or already been used.", code: "challenge_inactive" }, { status: 409 });
  return Response.json({ language: challenge.language, verified: true });
}
