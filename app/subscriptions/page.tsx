"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { translations } from "@/lib/i18n";
import { usePreferredLanguage } from "@/lib/use-preferred-language";

type Plan = {
  id: "free" | "bronze" | "silver" | "gold";
  name: string;
  priceRupees: number;
  monthlyPostLimit: number | null;
};

type Subscription = {
  plan_id: Plan["id"];
  expires_at: string;
  cancelled_at: string | null;
  monthlyPostCount: number;
  plan: Plan;
};

type CheckoutOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => void;
  modal: { ondismiss: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => { open: () => void };
  }
}

const fallbackPlans: Plan[] = [
  { id: "free", name: "Free", priceRupees: 0, monthlyPostLimit: 1 },
  { id: "bronze", name: "Bronze", priceRupees: 100, monthlyPostLimit: 3 },
  { id: "silver", name: "Silver", priceRupees: 300, monthlyPostLimit: 5 },
  { id: "gold", name: "Gold", priceRupees: 1000, monthlyPostLimit: null },
];

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay-checkout]");
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function SubscriptionsPage() {
  const language = usePreferredLanguage();
  const [plans, setPlans] = useState<Plan[]>(fallbackPlans);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyPlan, setBusyPlan] = useState<Plan["id"] | null>(null);
  const [loading, setLoading] = useState(true);
  const t = useMemo(() => translations[language], [language]);

  const refreshSubscription = useCallback(async () => {
    try {
      const response = await fetch("/api/subscription");
      const result = await response.json() as { subscription?: Subscription | null; plans?: Plan[] };
      if (!response.ok) {
        setError(response.status === 401 ? translations[language].signInRequired : translations[language].checkoutFailed);
        return;
      }
      setSubscription(result.subscription ?? null);
      if (result.plans) setPlans(result.plans);
      setError("");
    } catch {
      setError(translations[language].checkoutFailed);
    } finally {
      setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshSubscription(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshSubscription]);

  const startPlan = async (plan: Plan) => {
    if (busyPlan) return;
    setBusyPlan(plan.id);
    setMessage("");
    setError("");
    try {
      if (plan.id === "free") {
        const response = await fetch("/api/subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId: "free" }),
        });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(response.status === 401 ? "auth" : result.error ?? "failed");
        setMessage(t.subscriptionActive);
        await refreshSubscription();
        return;
      }

      const orderResponse = await fetch("/api/payments/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
      });
      const order = await orderResponse.json() as { keyId?: string; orderId?: string; amount?: number; currency?: string };
      if (!orderResponse.ok || !order.keyId || !order.orderId || !order.amount || !order.currency) {
        if (orderResponse.status === 401) throw new Error("auth");
        throw new Error(orderResponse.status === 403 ? "hours" : "failed");
      }

      const checkoutReady = await loadRazorpayCheckout();
      if (!checkoutReady || !window.Razorpay) throw new Error("failed");
      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "Elevance Skills",
        description: `${plan.name} · ${t.planPeriod}`,
        modal: { ondismiss: () => setBusyPlan(null) },
        handler: (payment) => {
          void fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: payment.razorpay_order_id, paymentId: payment.razorpay_payment_id, signature: payment.razorpay_signature }),
          }).then(async (response) => {
            const result = await response.json() as { error?: string };
            if (!response.ok) throw new Error("failed");
            setMessage(t.subscriptionActive);
            setError("");
            await refreshSubscription();
            return result;
          }).catch(() => setError(t.checkoutFailed)).finally(() => setBusyPlan(null));
        },
      });
      checkout.open();
      return;
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "failed";
      if (code === "auth") setError(t.signInRequired);
      else if (code === "hours") setError(t.paymentHours);
      else setError(t.checkoutFailed);
    } finally {
      setBusyPlan(null);
    }
  };

  const cancelSubscription = async () => {
    setError("");
    const response = await fetch("/api/subscription", { method: "DELETE" });
    if (!response.ok) {
      setError(response.status === 401 ? t.signInRequired : t.checkoutFailed);
      return;
    }
    setMessage(t.cancelInfo);
    await refreshSubscription();
  };

  return (
    <main className="min-h-screen bg-[#f4efe8] px-4 py-8 text-zinc-900 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-center justify-between gap-4 border-b border-zinc-300 pb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Elevance Skills</p>
            <h1 className="mt-1 text-3xl font-semibold">{t.subscriptions}</h1>
          </div>
          <Link href="/" className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white">{t.dashboard}</Link>
        </header>

        <section className="mb-9 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{t.currentPlan}</p>
            <h2 className="mt-2 text-2xl font-semibold">{subscription?.plan.name ?? t.noPlan}</h2>
            {subscription && <p className="mt-2 text-sm text-zinc-600">{t.monthlyPosts}: {subscription.monthlyPostCount} / {subscription.plan.monthlyPostLimit ?? t.unlimitedPosts}</p>}
            {subscription && <p className="mt-1 text-sm text-zinc-600">{t.expires}: {new Date(subscription.expires_at).toLocaleDateString()}</p>}
            {subscription?.cancelled_at && <p className="mt-2 text-sm text-amber-800">{t.cancelInfo}</p>}
          </div>
          {subscription && !subscription.cancelled_at && (
            <button type="button" onClick={cancelSubscription} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-white">
              {t.cancelSubscription}
            </button>
          )}
        </section>

        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-300 pb-4">
          <div>
            <h2 className="text-xl font-semibold">{t.choosePlan}</h2>
            <p className="mt-1 text-sm text-zinc-600">{t.paymentHours}</p>
          </div>
          {loading && <span className="text-sm text-zinc-500">…</span>}
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <article key={plan.id} className="flex min-h-64 flex-col border-t-4 border-zinc-900 bg-white p-5 shadow-sm ring-1 ring-zinc-200">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{plan.name}</p>
              <p className="mt-4 text-3xl font-semibold">₹{plan.priceRupees}<span className="ml-1 text-sm font-normal text-zinc-500">/ 30d</span></p>
              <p className="mt-3 text-sm text-zinc-600">
                {plan.monthlyPostLimit === null ? t.unlimitedPosts : `${plan.monthlyPostLimit} ${t.postsPerMonth}`}
              </p>
              <button
                type="button"
                onClick={() => void startPlan(plan)}
                disabled={Boolean(busyPlan) || loading || Boolean(subscription)}
                className="mt-auto rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
              >
                {busyPlan === plan.id ? "…" : plan.id === "free" ? t.activateFree : t.subscribe}
              </button>
            </article>
          ))}
        </section>

        {message && <p role="status" className="mt-6 border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
        {error && <p role="alert" className="mt-6 border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
        <p className="mt-6 text-xs text-zinc-500">{t.planPeriod}. {t.cancelInfo}</p>
      </div>
    </main>
  );
}
