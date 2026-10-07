import { createHmac, timingSafeEqual } from "node:crypto";

export type OtpChannel = "email" | "sms";

function getOtpSecret() {
  const secret = process.env.OTP_HASH_SECRET;
  if (!secret || secret.length < 32) throw new Error("OTP_HASH_SECRET must be configured with at least 32 characters");
  return secret;
}

export function hashOtp(challengeId: string, userId: string, language: string, code: string) {
  return createHmac("sha256", getOtpSecret()).update(`${challengeId}.${userId}.${language}.${code}`).digest();
}

export function matchesOtpHash(storedHash: string, expectedHash: Buffer) {
  const stored = Buffer.from(storedHash, "hex");
  return stored.length === expectedHash.length && timingSafeEqual(stored, expectedHash);
}

export async function deliverOtp(channel: OtpChannel, destination: string, code: string) {
  if (channel === "email") {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) throw new Error("Email OTP delivery is not configured");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [destination],
        subject: "Your language verification code",
        text: `Your verification code is ${code}. It expires in 5 minutes. Do not share this code.`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Email OTP delivery failed");
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) throw new Error("SMS OTP delivery is not configured");

  const body = new URLSearchParams({
    To: destination,
    From: from,
    Body: `Your language verification code is ${code}. It expires in 5 minutes. Do not share this code.`,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("SMS OTP delivery failed");
}
