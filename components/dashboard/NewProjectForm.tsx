"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACTIVE_MODES, DEFAULT_MODE } from "@/lib/modes/descriptors";
import { DEFAULT_LANGUAGE, type Language } from "@/lib/config/language";
import type { ModeId, Platform } from "@/lib/orchestrator/types";

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [defaultMode, setDefaultMode] = useState<ModeId>(DEFAULT_MODE);
  const [language, setLanguage] = useState<Language>(DEFAULT_LANGUAGE);
  const [defaultAuto, setDefaultAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, platform, defaultMode, language, defaultAuto }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Bir hata oluştu.");
      return;
    }
    setName("");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 p-4"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-400">Proje / marka adı</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="ör. Cariusb"
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-400">Platform</label>
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        >
          <option value="tiktok">TikTok</option>
          <option value="instagram">Instagram</option>
          <option value="youtube_shorts">YouTube Shorts</option>
          <option value="other">Diğer</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-400">Varsayılan mod</label>
        <select
          value={defaultMode}
          onChange={(e) => setDefaultMode(e.target.value as ModeId)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        >
          {ACTIVE_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        {/* Çıktı dili: izleyiciye giden metni bağlar, operatörün gördüğü
            sahne/çekim tarifleri Türkçe kalır (lib/config/language.ts). */}
        <label className="text-xs text-neutral-400">Çıktı dili</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        >
          <option value="tr">Türkçe</option>
          <option value="en">İngilizce (ABD)</option>
        </select>
      </div>
      <label className="flex items-center gap-2 pb-2 text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={defaultAuto}
          onChange={(e) => setDefaultAuto(e.target.checked)}
        />
        Varsayılan: tam otomatik (toggle kapalı başlasın)
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {busy ? "Oluşturuluyor…" : "Proje oluştur"}
      </button>
      {error ? <p className="w-full text-sm text-red-400">{error}</p> : null}
    </form>
  );
}
