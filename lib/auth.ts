import { createHmac, timingSafeEqual } from "node:crypto";

const sessionCookieName = "elevance_session";

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters");
  }
  return secret;
}

function sign(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest();
}

export function createSessionToken(userId: string, expiresAt: number) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: expiresAt })).toString("base64url");
  return `${payload}.${sign(payload).toString("base64url")}`;
}

function verifySessionToken(token: string): string | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;

  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }

  const expectedSignature = sign(payload);
  if (providedSignature.length !== expectedSignature.length || !timingSafeEqual(providedSignature, expectedSignature)) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.exp !== "number" || claims.exp <= Date.now()) return null;
    return claims.sub;
  } catch {
    return null;
  }
}

export function getAuthenticatedUserId(request: Request) {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`));
  const token = bearer ?? cookie?.slice(sessionCookieName.length + 1);
  if (!token) return null;
  return verifySessionToken(token);
}

export function hasTrustedMutationOrigin(request: Request) {
  if (/^Bearer\s+.+$/i.test(request.headers.get("authorization") ?? "")) return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export function getSessionCookieName() {
  return sessionCookieName;
}
