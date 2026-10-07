"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { translations } from "@/lib/i18n";
import { usePreferredLanguage } from "@/lib/use-preferred-language";

type Privacy = "PUBLIC" | "FOLLOWERS_ONLY" | "CLOSE_FRIENDS";

export default function CreatePostPage() {
  const language = usePreferredLanguage();
  const [privacy, setPrivacy] = useState<Privacy>("PUBLIC");
  const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [mediaUrls, setMediaUrls] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const t = useMemo(() => translations[language], [language]);

  const submitPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus("");
    setError("");
    const media = mediaUrls.split(/\r?\n/).map((url) => url.trim()).filter(Boolean).map((url) => ({ url, mediaType }));

    try {
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privacy, media }),
      });
      if (!response.ok) {
        if (response.status === 401) setError(t.signInRequired);
        else if (response.status === 402) setError(t.subscriptionRequired);
        else if (response.status === 429) setError(t.postLimitReached);
        else setError(t.validationMessage);
        return;
      }
      setMediaUrls("");
      setStatus(t.postCreated);
    } catch {
      setError(t.validationMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f4efe8] px-4 py-8 text-zinc-900 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4 border-b border-zinc-300 pb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Elevance Skills</p>
            <h1 className="mt-1 text-3xl font-semibold">{t.createPost}</h1>
          </div>
          <Link href="/" className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white">{t.dashboard}</Link>
        </header>

        <form onSubmit={submitPost} className="space-y-6 bg-white p-6 shadow-sm ring-1 ring-zinc-200 sm:p-8">
          <label className="block">
            <span className="text-sm font-medium">{t.privacySetting}</span>
            <select value={privacy} onChange={(event) => setPrivacy(event.target.value as Privacy)} className="mt-2 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-3">
              <option value="PUBLIC">{t.public}</option>
              <option value="FOLLOWERS_ONLY">{t.followersOnly}</option>
              <option value="CLOSE_FRIENDS">{t.closeFriends}</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">{t.mediaType}</span>
            <select value={mediaType} onChange={(event) => setMediaType(event.target.value as "IMAGE" | "VIDEO")} className="mt-2 block w-full rounded-xl border border-zinc-300 bg-white px-3 py-3">
              <option value="IMAGE">{t.image}</option>
              <option value="VIDEO">{t.video}</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">{t.mediaUrls}</span>
            <textarea value={mediaUrls} onChange={(event) => setMediaUrls(event.target.value)} rows={6} required className="mt-2 block w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-3 font-mono text-sm" />
            <span className="mt-2 block text-sm text-zinc-500">{t.mediaHint}</span>
          </label>

          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-5">
            <button type="submit" disabled={isSubmitting} className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-semibold text-white disabled:bg-zinc-400">
              {isSubmitting ? "…" : t.createPost}
            </button>
            <Link href="/subscriptions" className="rounded-full border border-zinc-300 px-4 py-3 text-sm font-medium">{t.subscriptions}</Link>
          </div>
          {status && <p role="status" className="border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{status}</p>}
          {error && <p role="alert" className="border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
        </form>
      </div>
    </main>
  );
}
