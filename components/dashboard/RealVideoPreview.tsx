"use client";

import { useState } from "react";
import type { RunState } from "@/lib/orchestrator/types";

function assetUrl(projectSlug: string, runId: string, relPath: string) {
  return `/api/runs/${runId}/asset?project=${encodeURIComponent(
    projectSlug,
  )}&path=${encodeURIComponent(relPath)}`;
}

/**
 * Gerçek video önizlemesi.
 *
 * Carousel'den farkı: burada Remotion Player KULLANILMIYOR. Sebebi somut —
 * çizelgedeki medya yolları göreli ve tarayıcıdan erişilemiyor; render sırasında
 * yerel asset sunucusunun URL'lerine çevriliyorlar (lib/render/assetServer.ts) ve
 * o sunucu yalnızca render süresince ayakta. Basılmış mp4'ü göstermek hem doğru
 * hem dürüst: kullanıcı gerçekte üretileni görüyor, bir yaklaşığını değil.
 *
 * Video henüz basılmadıysa sahne/materyal durumu gösteriliyor ki aşamalar
 * ilerlerken ekran boş kalmasın.
 */
export function RealVideoPreview({
  run,
  projectSlug,
}: {
  run: RunState;
  projectSlug: string;
}) {
  const [copied, setCopied] = useState(false);

  // ai-video real-video ile AYNI önizleme bileşenini kullanıyor (descriptor'da
  // output:"real-video") — sahne şekli (id/role/voiceLine/onScreenText) ikisinde
  // de ortak, bu yüzden guard ikisini de kabul ediyor.
  if (run.payload.kind !== "real-video" && run.payload.kind !== "ai-video") return null;
  const { scenes, footage, caption, hashtags, theme } = run.payload;

  // final > montage: finisaj bittiyse sesli olanı göster.
  const video = run.assets.finalVideo ?? run.assets.montage;
  const isFinal = Boolean(run.assets.finalVideo);
  const footageByScene = new Map(footage.map((f) => [f.sceneId, f]));

  if (scenes.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Önizleme için henüz sahne yok — sanat yönetmeni aşaması tamamlanınca burada görünür.
      </p>
    );
  }

  const captionText = [caption, hashtags.map((h) => `#${h}`).join(" ")]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div className="space-y-4">
      {video ? (
        <div className="w-full max-w-sm overflow-hidden rounded-lg border border-neutral-800">
          <video
            key={video}
            src={assetUrl(projectSlug, run.runId, video)}
            controls
            playsInline
            className="w-full"
          />
          <p className="border-t border-neutral-800 px-3 py-2 text-xs text-neutral-500">
            {isFinal
              ? "final.mp4 — ses karışımı ve loudness uygulandı"
              : "montage.mp4 — SESSİZ, finisaj aşaması henüz koşmadı"}
          </p>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">
          Video henüz basılmadı — render aşaması tamamlanınca burada oynatılabilir.
        </p>
      )}

      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Sahneler</p>
        <ul className="space-y-1 text-sm">
          {scenes.map((s) => {
            const clip = footageByScene.get(s.id);
            return (
              <li key={s.id} className="flex gap-2 text-neutral-400">
                <span className="w-16 shrink-0 text-neutral-600">{s.role}</span>
                <span className="flex-1">
                  {s.voiceLine || <span className="text-neutral-600">{s.intent}</span>}
                  {s.onScreenText ? (
                    <span className="text-neutral-500"> · ekran: “{s.onScreenText}”</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-neutral-600">
                  {clip
                    ? `${(clip.outSec - clip.inSec).toFixed(1)}sn`
                    : "materyal yok"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {theme?.styleContract ? (
        <details className="text-xs text-neutral-500">
          <summary className="cursor-pointer">Stil sözleşmesi</summary>
          <p className="mt-1 whitespace-pre-wrap">{theme.styleContract}</p>
        </details>
      ) : null}

      {captionText.trim() ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Caption</p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(captionText);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="text-xs text-neutral-400 underline hover:text-neutral-200"
            >
              {copied ? "kopyalandı" : "kopyala"}
            </button>
          </div>
          <p className="whitespace-pre-wrap text-sm text-neutral-300">{captionText}</p>
        </div>
      ) : null}
    </div>
  );
}
