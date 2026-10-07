"use client";

import { useEffect, useSyncExternalStore } from "react";
import { supportedLanguages, type Language } from "@/lib/i18n";

const languageChangedEvent = "preferred-language-changed";
let serverLanguageSync: Promise<void> | undefined;

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(languageChangedEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(languageChangedEvent, onStoreChange);
  };
}

function getSnapshot(): Language {
  const stored = window.localStorage.getItem("preferred-language");
  return supportedLanguages.some((language) => language.code === stored) ? stored as Language : "en";
}

function getServerSnapshot(): Language {
  return "en";
}

export function usePreferredLanguage() {
  const language = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!serverLanguageSync) {
      serverLanguageSync = fetch("/api/language/otp")
        .then(async (response) => {
          if (!response.ok) {
            serverLanguageSync = undefined;
            return;
          }
          const result = await response.json() as { language?: Language };
          if (result.language && supportedLanguages.some((item) => item.code === result.language)) {
            savePreferredLanguage(result.language);
          }
        })
        .catch(() => {
          serverLanguageSync = undefined;
        });
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return language;
}

export function savePreferredLanguage(language: Language) {
  window.localStorage.setItem("preferred-language", language);
  window.dispatchEvent(new Event(languageChangedEvent));
}
