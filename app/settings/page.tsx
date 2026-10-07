"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getLanguageLabel, supportedLanguages, translations, type Language } from "@/lib/i18n";

const registeredEmail = "student@elevance.example";
const registeredMobile = "+1 (555) 010-2048";
const otpLifetimeMs = 120000;
const maxFailedAttempts = 3;
const lockoutMs = 300000;

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default function SettingsPage() {
  const [language, setLanguage] = useState<Language>("en");
  const [candidateLanguage, setCandidateLanguage] = useState<Language>("en");
  const [otp, setOtp] = useState("");
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [generatedOtp, setGeneratedOtp] = useState("123456");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [countdown, setCountdown] = useState(120);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [lockUntil, setLockUntil] = useState<number | null>(null);

  useEffect(() => {
    const savedValue = typeof window !== "undefined" ? window.localStorage.getItem("preferred-language") : null;
    const initial = (savedValue as Language) || "en";
    setLanguage(initial);
    setCandidateLanguage(initial);
  }, []);

  useEffect(() => {
    if (!otpSentAt) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((otpLifetimeMs - (Date.now() - otpSentAt)) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        setStatusMessage(translations[language].otpExpired);
        setErrorMessage("");
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [otpSentAt, language]);

  const t = useMemo(() => translations[language], [language]);

  const sendOtp = (nextLanguage: Language) => {
    if (isLocked) {
      const remaining = lockUntil ? Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000)) : 0;
      setErrorMessage(`${translations[language].locked} ${remaining}s`);
      return;
    }

    const newOtp = generateOtp();
    setGeneratedOtp(newOtp);
    setOtpSentAt(Date.now());
    setCountdown(120);
    setOtp("");
    setErrorMessage("");
    setStatusMessage(
      nextLanguage === "fr"
        ? `${translations[language].otpSent} ${translations[language].emailLabel}: ${registeredEmail}`
        : `${translations[language].otpSent} ${translations[language].mobileLabel}: ${registeredMobile}`
    );
  };

  const handleLanguageChange = (nextLanguage: Language) => {
    setCandidateLanguage(nextLanguage);
    if (nextLanguage === language) {
      setStatusMessage(translations[language].success);
      setErrorMessage("");
      return;
    }

    sendOtp(nextLanguage);
  };

  const verifyOtp = () => {
    if (isLocked) {
      const remaining = lockUntil ? Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000)) : 0;
      setErrorMessage(`${translations[language].locked} ${remaining}s`);
      return;
    }

    if (!otpSentAt) {
      setErrorMessage(translations[language].otpSent);
      return;
    }

    const otpAge = Date.now() - otpSentAt;
    if (otpAge > otpLifetimeMs) {
      setErrorMessage(translations[language].otpExpired);
      return;
    }

    if (otp.trim() !== generatedOtp) {
      const nextAttempts = failedAttempts + 1;
      setFailedAttempts(nextAttempts);
      setErrorMessage(translations[language].otpInvalid);

      if (nextAttempts >= maxFailedAttempts) {
        const nextLockUntil = Date.now() + lockoutMs;
        setIsLocked(true);
        setLockUntil(nextLockUntil);
        setErrorMessage(translations[language].locked);
      }
      return;
    }

    window.localStorage.setItem("preferred-language", candidateLanguage);
    setLanguage(candidateLanguage);
    setStatusMessage(translations[candidateLanguage].success);
    setErrorMessage("");
    setFailedAttempts(0);
    setIsLocked(false);
    setLockUntil(null);
    setOtp("");
  };

  useEffect(() => {
    if (!isLocked || !lockUntil) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= lockUntil) {
        setIsLocked(false);
        setLockUntil(null);
        setFailedAttempts(0);
        setErrorMessage("");
        window.clearInterval(timer);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isLocked, lockUntil]);

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-6 text-zinc-900">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between rounded-full bg-white px-5 py-3 shadow-sm ring-1 ring-zinc-200">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{t.appName}</p>
            <h1 className="text-xl font-semibold">{t.settings}</h1>
          </div>
          <Link href="/" className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
            {t.dashboard}
          </Link>
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
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                {candidateLanguage === "fr" ? registeredEmail : registeredMobile}
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <label className="text-sm font-medium text-zinc-700">{t.otpPlaceholder}</label>
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                maxLength={6}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-base outline-none ring-0 transition focus:border-zinc-500"
                placeholder="123456"
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => sendOtp(candidateLanguage)}
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                {t.requestNewOtp}
              </button>
              <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                {countdown}s {t.secondsLeft}
              </span>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={verifyOtp}
                disabled={isLocked}
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
                <div className="flex justify-between gap-3"><span>{t.emailLabel}</span><span className="text-white">{registeredEmail}</span></div>
                <div className="flex justify-between gap-3"><span>{t.mobileLabel}</span><span className="text-white">{registeredMobile}</span></div>
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
