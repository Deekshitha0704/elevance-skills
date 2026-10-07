"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getLanguageLabel, supportedLanguages, translations, type Language } from "@/lib/i18n";
import { savePreferredLanguage, usePreferredLanguage } from "@/lib/use-preferred-language";

const otpLifetimeMs = 5 * 60 * 1000;
const maxFailedAttempts = 5;
const lockoutMs = 15 * 60 * 1000;

export default function SettingsPage() {
  const language = usePreferredLanguage();
  const [candidateLanguage, setCandidateLanguage] = useState<Language>("en");
  const [otp, setOtp] = useState("");
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockCountdown, setLockCountdown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const isLocked = lockCountdown > 0;

  useEffect(() => {
    fetch("/api/language/otp")
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{ language: Language }>;
      })
      .then(({ language: savedLanguage }) => {
        if (!supportedLanguages.some((item) => item.code === savedLanguage)) return;
        setCandidateLanguage(savedLanguage);
        savePreferredLanguage(savedLanguage);
      })
      .catch(() => {
        setErrorMessage(translations.en.signInRequired);
      });
  }, []);

  useEffect(() => {
    if (!otpSentAt) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((otpSentAt + otpLifetimeMs - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        setStatusMessage(translations[language].otpExpired);
        setChallengeId(null);
        setOtpSentAt(null);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [otpSentAt, language]);

  useEffect(() => {
    if (!isLocked) return;
    const timer = window.setInterval(() => setLockCountdown((remaining) => Math.max(0, remaining - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [isLocked]);

  const t = useMemo(() => translations[language], [language]);

  const getApiError = (code: string | undefined, status: number, dictionary: typeof t) => {
    if (code === "contact_missing") return dictionary.contactMissing;
    if (code === "delivery_unavailable" || status === 503) return dictionary.otpDeliveryUnavailable;
    if (code === "locked") return dictionary.locked;
    if (code === "cooldown" || code === "send_limit" || status === 429) return dictionary.otpRateLimited;
    if (code === "expired") return dictionary.otpExpired;
    if (code === "incorrect") return dictionary.otpInvalid;
    if (status === 401) return dictionary.signInRequired;
    return dictionary.otpInvalid;
  };

  const sendOtp = async (nextLanguage: Language) => {
    if (isLocked || isLoading) return;
    setIsLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const response = await fetch("/api/language/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: nextLanguage }),
      });
      const result = await response.json() as { challengeId?: string; destination?: string; expiresAt?: string; code?: string };
      if (!response.ok || !result.challengeId || !result.expiresAt) {
        setErrorMessage(getApiError(result.code, response.status, translations[language]));
        if (result.code === "locked") {
          setLockCountdown(lockoutMs / 1000);
        }
        return;
      }

      setChallengeId(result.challengeId);
      setDestination(result.destination ?? "");
      setOtpSentAt(Date.parse(result.expiresAt) - otpLifetimeMs);
      setCountdown(otpLifetimeMs / 1000);
      setOtp("");
      const channelLabel = nextLanguage === "fr" ? translations[language].emailLabel : translations[language].mobileLabel;
      setStatusMessage(`${translations[language].otpSent} ${channelLabel}: ${result.destination ?? ""}`);
    } catch {
      setErrorMessage(translations[language].otpDeliveryUnavailable);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLanguageChange = (nextLanguage: Language) => {
    setCandidateLanguage(nextLanguage);
    if (nextLanguage === language) {
      setStatusMessage("");
      setErrorMessage("");
      return;
    }

    sendOtp(nextLanguage);
  };

  const verifyOtp = async () => {
    if (!challengeId || isLoading) return;
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/language/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code: otp }),
      });
      const result = await response.json() as { language?: Language; code?: string; attemptsRemaining?: number; retryAfterSeconds?: number };
      if (!response.ok || !result.language) {
        setErrorMessage(getApiError(result.code, response.status, translations[language]));
        if (typeof result.attemptsRemaining === "number") setFailedAttempts(maxFailedAttempts - result.attemptsRemaining);
        if (result.code === "locked") {
          setFailedAttempts(maxFailedAttempts);
          setLockCountdown(result.retryAfterSeconds ?? lockoutMs / 1000);
        }
        return;
      }

      setCandidateLanguage(result.language);
      savePreferredLanguage(result.language);
      setStatusMessage(translations[result.language].success);
      setChallengeId(null);
      setDestination("");
      setOtp("");
      setFailedAttempts(0);
      setOtpSentAt(null);
      setCountdown(0);
    } catch {
      setErrorMessage(translations[language].otpDeliveryUnavailable);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-6 text-zinc-900">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between rounded-full bg-white px-5 py-3 shadow-sm ring-1 ring-zinc-200">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{t.appName}</p>
            <h1 className="text-xl font-semibold">{t.settings}</h1>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/subscriptions" className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800">
              {t.subscriptions}
            </Link>
            <Link href="/" className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
              {t.dashboard}
            </Link>
          </nav>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-zinc-200">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{t.preferredLanguage}</p>
            <h2 className="mt-2 text-2xl font-semibold">{t.chooseLanguage}</h2>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {supportedLanguages.map((supportedLanguage) => {
                const isSelected = candidateLanguage === supportedLanguage.code;
                return (
                  <button
                    key={supportedLanguage.code}
                    type="button"
                    onClick={() => handleLanguageChange(supportedLanguage.code)}
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      isSelected
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{supportedLanguage.label}</span>
                      {isSelected && <span className="text-xs uppercase tracking-[0.2em]">{t.currentSelection}</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
              <p className="font-medium text-zinc-900">{t.otpVerification}</p>
              <p className="mt-2">{candidateLanguage === "fr" ? t.otpForFrench : t.otpForOtherLanguages}</p>
              {destination && <p className="mt-2 text-xs uppercase tracking-[0.2em] text-zinc-500">{destination}</p>}
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <label className="text-sm font-medium text-zinc-700">{t.otpPlaceholder}</label>
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                maxLength={6}
                disabled={!challengeId || isLoading || isLocked}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-0 transition focus:border-zinc-500"
                placeholder="123456"
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => sendOtp(candidateLanguage)}
                disabled={isLoading || isLocked || (Boolean(challengeId) && countdown > 240)}
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                {isLoading ? t.otpVerification : t.requestNewOtp}
              </button>
              <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                {challengeId ? `${countdown}s ${t.secondsLeft}` : ""}
              </span>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={verifyOtp}
                disabled={isLocked || isLoading || !challengeId || otp.length !== 6}
                className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {t.verifyAndApply}
              </button>
              <span className="text-sm text-zinc-600">{t.failedAttempts}: {failedAttempts}/{maxFailedAttempts}</span>
            </div>

            {statusMessage && <p className="mt-4 rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{statusMessage}</p>}
            {errorMessage && <p className="mt-4 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>}
          </section>

          <aside className="space-y-6">
            <div className="rounded-[2rem] bg-zinc-900 p-6 text-white shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">{t.profile}</p>
              <h3 className="mt-2 text-2xl font-semibold">{t.userWelcome}</h3>
              <div className="mt-5 space-y-3 text-sm text-zinc-300">
                <div className="flex justify-between gap-3"><span>{t.language}</span><span className="text-white">{getLanguageLabel(language)}</span></div>
              </div>
            </div>

            <div className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-zinc-200">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{t.validation}</p>
              <h3 className="mt-2 text-xl font-semibold">{t.validationMessage}</h3>
              <p className="mt-4 text-sm text-zinc-600">{t.localeSummary}</p>
              <p className="mt-4 rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{t.note}</p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
