"use client";

import Link from "next/link";
import { useMemo } from "react";
import { getLanguageLabel, translations } from "@/lib/i18n";
import { usePreferredLanguage } from "@/lib/use-preferred-language";

const featuredImages = [
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=1200&q=80",
];

const stories = [
  { id: "s_1", display_name: "Nina Parker", privacy: "PUBLIC", total_views: 812, unique_views: 624, archived: 0 },
  { id: "s_2", display_name: "Marcus Chen", privacy: "FOLLOWERS_ONLY", total_views: 643, unique_views: 488, archived: 0 },
  { id: "s_3", display_name: "Tessa Bloom", privacy: "PUBLIC", total_views: 517, unique_views: 394, archived: 0 },
  { id: "s_4", display_name: "Leo Hart", privacy: "CLOSE_FRIENDS", total_views: 449, unique_views: 357, archived: 1 },
];

export default function Home() {
  const language = usePreferredLanguage();
  const t = useMemo(() => translations[language], [language]);
  const totalViews = stories.reduce((sum, story) => sum + story.total_views, 0);
  const totalUniqueViewers = stories.reduce((sum, story) => sum + story.unique_views, 0);
  const activeStories = stories.filter((story) => story.archived === 0).length;
  const featuredStory = stories[0] ?? null;

  const statCards = [
    { label: t.storiesLive, value: `${stories.length}`, detail: `${activeStories} ${t.active}` },
    { label: t.totalViews, value: `${totalViews}`, detail: `${totalUniqueViewers} ${t.uniqueViewers}` },
    { label: t.highlights, value: "4", detail: t.featuredMoments },
    { label: t.avgEngagement, value: "92%", detail: t.strongRetention },
  ];

  const quickPicks = [
    { title: t.sunsetRun, tone: t.warmGlow, color: "from-orange-400 to-rose-400" },
    { title: t.weekendCrew, tone: t.cityMomentum, color: "from-cyan-400 to-blue-500" },
    { title: t.studioSet, tone: t.creativeEnergy, color: "from-violet-400 to-fuchsia-500" },
  ];

  return (
    <main className="min-h-screen bg-[#f4efe8] text-zinc-900">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between rounded-full border border-zinc-200 bg-white/80 px-4 py-3 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-pink-500 to-rose-500 text-lg font-bold text-white">
              S
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{t.storyline}</p>
              <h1 className="text-lg font-semibold">{t.stories}</h1>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-zinc-600 md:flex">
            <a href="#" className="transition hover:text-zinc-900">{t.discover}</a>
            <a href="#" className="transition hover:text-zinc-900">{t.highlights}</a>
            <a href="#" className="transition hover:text-zinc-900">{t.analytics}</a>
          </nav>

          <div className="flex items-center gap-3">
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700">
              {getLanguageLabel(language)}
            </span>
            <Link href="/subscriptions" className="hidden rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 sm:inline-flex">
              {t.subscriptions}
            </Link>
            <Link href="/settings" className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700">
              {t.settings}
            </Link>
          </div>
        </header>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
          <div className="rounded-[2rem] bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-700 p-8 text-white shadow-[0_30px_60px_rgba(0,0,0,0.18)]">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-200">
              {t.liveNow}
            </div>
            <h2 className="mt-6 max-w-xl text-4xl font-semibold leading-tight sm:text-5xl">
              {t.heroTitle}
            </h2>
            <p className="mt-4 max-w-lg text-base text-zinc-300">
              {t.heroText}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/create" className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100">
                {t.createPost}
              </Link>
              <button className="rounded-full border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                {t.viewDashboard}
              </button>
            </div>
          </div>

          <div className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-zinc-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{t.featured}</p>
                <h3 className="mt-2 text-xl font-semibold">{t.mostEngaging}</h3>
              </div>
              {featuredStory ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  {featuredStory.unique_views} {t.views}
                </span>
              ) : null}
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl">
              <img
                src={featuredImages[0]}
                alt="Featured story"
                className="h-56 w-full object-cover"
              />
            </div>

            <div className="mt-5 space-y-2 text-sm text-zinc-600">
              <p className="font-medium text-zinc-900">{featuredStory?.display_name ?? "Nina Parker"}</p>
              <p>Weekend city light walk • {featuredStory?.total_views ?? 312} {t.totalViews.toLowerCase()}</p>
              <div className="flex items-center justify-between pt-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                <span>24m</span>
                <span>{activeStories} {t.active}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-4">
          {statCards.map((card) => (
            <div key={card.label} className="rounded-[1.5rem] border border-zinc-200 bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{card.label}</p>
              <div className="mt-4 flex items-end justify-between">
                <span className="text-3xl font-semibold text-zinc-900">{card.value}</span>
                <span className="rounded-full bg-orange-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-orange-700">
                  {t.liveNow}
                </span>
              </div>
              <p className="mt-3 text-sm text-zinc-600">{card.detail}</p>
            </div>
          ))}
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
          <div className="rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-zinc-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">{t.feed}</p>
                <h3 className="mt-2 text-2xl font-semibold">{t.latestStories}</h3>
              </div>
              <button className="rounded-full border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50">
                {t.filter}
              </button>
            </div>

            <div className="mt-6 space-y-4">
              {stories.slice(0, 3).map((story, index) => (
                <article key={story.id} className="flex gap-4 rounded-[1.5rem] border border-zinc-200 bg-zinc-50 p-3">
                  <img
                    src={featuredImages[index % featuredImages.length]}
                    alt={`${story.display_name} story`}
                    className="h-28 w-28 rounded-2xl object-cover"
                  />
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">{story.display_name}</p>
                        <p className="text-xs uppercase tracking-[0.15em] text-zinc-500">{story.privacy}</p>
                      </div>
                      <span className="rounded-full bg-zinc-900 px-2 py-1 text-[10px] font-medium text-white">
                        {story.total_views} views
                      </span>
                    </div>

                    <p className="mt-3 text-sm text-zinc-600">
                      {story.display_name} reached <span className="font-semibold text-zinc-900">{story.unique_views}</span> unique viewers today with a strong engagement window.
                    </p>

                    <div className="mt-4 flex items-center gap-4 text-xs text-zinc-500">
                      <span>❤️ {story.total_views / 4}</span>
                      <span>💬 18 replies</span>
                      <span>👁 {story.unique_views}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className="rounded-[2rem] bg-zinc-900 p-6 text-white shadow-[0_25px_45px_rgba(0,0,0,0.2)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">{t.highlights}</p>
                <h3 className="mt-2 text-2xl font-semibold">{t.quickPicks}</h3>
              </div>
              <span className="text-xs uppercase tracking-[0.2em] text-amber-300">{t.newLabel}</span>
            </div>

            <div className="mt-6 space-y-4">
              {quickPicks.map((item) => (
                <div key={item.title} className="rounded-[1.5rem] border border-white/10 bg-white/5 p-3">
                  <div className={`mb-3 h-20 rounded-2xl bg-gradient-to-br ${item.color}`} />
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-zinc-300">{item.tone}</p>
                    </div>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-zinc-200">
                      {t.saved}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
