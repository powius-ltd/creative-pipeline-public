"use client";

import { useState } from "react";
import type { RunState } from "@/lib/orchestrator/types";

function assetUrl(projectSlug: string, runId: string, relPath: string) {
  return `/api/runs/${runId}/asset?project=${encodeURIComponent(
    projectSlug,
  )}&path=${encodeURIComponent(relPath)}`;
}

export function CarouselPreview({
  run,
  projectSlug,
}: {
  run: RunState;
  projectSlug: string;
}) {
  const [copied, setCopied] = useState(false);

  if (run.payload.kind !== "carousel") return null;
  const { slides, caption, hashtags, theme } = run.payload;

  if (slides.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Önizleme için henüz slide yok — sanat yönetmeni aşaması tamamlanınca burada görünür.
      </p>
    );
  }

  const slideAssets = run.assets.slideAssets ?? {};
  const captionText = [caption, "", hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")]
    .join("\n")
    .trim();

  async function copyCaption() {
    await navigator.clipboard.writeText(captionText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="flex flex-col gap-4">
      {theme ? (
        <details className="rounded border border-neutral-800 p-3 text-xs">
          <summary className="cursor-pointer text-neutral-400">Görsel tema</summary>
          <dl className="mt-2 flex flex-col gap-1 text-neutral-400">
            <div>
              <dt className="inline font-medium text-neutral-300">Palet: </dt>
              <dd className="inline">{theme.palette}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-neutral-300">Işık: </dt>
              <dd className="inline">{theme.lighting}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-neutral-300">Çekim: </dt>
              <dd className="inline">{theme.shotStyle}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-neutral-300">Tipografi: </dt>
              <dd className="inline">{theme.typography}</dd>
            </div>
          </dl>
        </details>
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {slides.map((slide) => {
          const finalPath = slideAssets[slide.id]?.finalPath;
          return (
            <figure
              key={slide.id}
              className="flex w-56 shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-800"
            >
              <div className="relative aspect-[4/5] bg-neutral-900">
                {finalPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={assetUrl(projectSlug, run.runId, finalPath)}
                    alt={slide.headline || slide.id}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-3 text-center text-xs text-neutral-500">
                    {slide.headline || "(henüz görsel yok)"}
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-neutral-300">
                  {slide.role} · {slide.textMode}
                </span>
              </div>
              <figcaption className="border-t border-neutral-800 p-2 text-[11px] text-neutral-400">
                {slide.headline || <span className="text-neutral-600">metin bekleniyor</span>}
              </figcaption>
            </figure>
          );
        })}
      </div>

      {captionText ? (
        <div className="rounded border border-neutral-800 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">Caption</span>
            <button
              onClick={copyCaption}
              className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500"
            >
              {copied ? "Kopyalandı" : "Kopyala"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-neutral-400">{captionText}</pre>
        </div>
      ) : null}
    </div>
  );
}
