"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { aspectSpec, type AspectRatioId } from "@/lib/config/aspect";
import {
  ACTIVE_MODES,
  DEFAULT_MODE,
  getDescriptor,
  isSelectableMode,
  resolveAspect,
} from "@/lib/modes/descriptors";
import type { ModeId, Platform } from "@/lib/orchestrator/types";

export function NewRunForm({
  projectSlug,
  projectPlatform,
  defaultMode,
  defaultAuto,
}: {
  projectSlug: string;
  projectPlatform: Platform;
  defaultMode: ModeId;
  defaultAuto: boolean;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<ModeId>(isSelectableMode(defaultMode) ? defaultMode : DEFAULT_MODE);
  // Mod değişince varsayılan oran tazelenir — kullanıcı elle seçmediyse.
  const [aspect, setAspect] = useState<AspectRatioId>(
    resolveAspect(isSelectableMode(defaultMode) ? defaultMode : DEFAULT_MODE, projectPlatform, undefined),
  );
  const [auto, setAuto] = useState(defaultAuto);
  // Mod değişince önden işaretlenir — kullanıcı elle değiştirebilir.
  const [watermark, setWatermark] = useState(getDescriptor(mode).watermarkDefault);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onModeChange(next: ModeId) {
    setMode(next);
    setAspect(resolveAspect(next, projectPlatform, undefined));
    setWatermark(getDescriptor(next).watermarkDefault);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectSlug, mode, aspect, watermark, topic, notes, auto }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Bir hata oluştu.");
      return;
    }
    const { run } = await res.json();
    router.push(`/projects/${projectSlug}/runs/${run.runId}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-4"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-400">Brief / konu</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          required
          placeholder="ör. Yeni ürün lansmanı — genç, dinamik hedef kitle"
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-400">Notlar (opsiyonel)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-400">Mod</label>
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value as ModeId)}
          className="self-start rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        >
          {ACTIVE_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-neutral-500">{getDescriptor(mode).description}</p>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-neutral-400">Kare oranı</label>
        <select
          value={aspect}
          onChange={(e) => setAspect(e.target.value as AspectRatioId)}
          className="self-start rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        >
          {getDescriptor(mode).aspects.map((id) => {
            const spec = aspectSpec(id);
            return (
              <option key={id} value={id}>
                {spec.label} (görsel {spec.still.width}×{spec.still.height} · video{" "}
                {spec.video.width}×{spec.video.height})
              </option>
            );
          })}
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => setAuto(e.target.checked)}
        />
        Toggle: tam otomatik (yayına kadar) — kapalıysa her adımda onay bekler
      </label>
      <label className="flex items-center gap-2 text-xs text-neutral-400">
        <input
          type="checkbox"
          checked={watermark}
          onChange={(e) => setWatermark(e.target.checked)}
        />
        Watermark: &quot;AI ile üretildi&quot; ibaresi eklensin
      </label>
      <button
        type="submit"
        disabled={busy}
        className="self-start rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
      >
        {busy ? "Başlatılıyor…" : "Run başlat"}
      </button>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </form>
  );
}
