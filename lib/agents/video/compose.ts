import fsp from "node:fs/promises";
import path from "node:path";
import type { VideoTimeline } from "../../../remotion/real-video/timeline";
import { isMock } from "../../config/mock";
import { runAssetsDir, runDir } from "../../orchestrator/paths";
import type { AgentResult, RunState } from "../../orchestrator/types";
import { toRelative } from "../../providers/download";

/**
 * RENDER — çizelgeyi sessiz bir mp4'e basar.
 *
 * İki tembel import var ve ikisi de ZORUNLU (gerekçe lib/render/bundle.ts'te):
 * `@remotion/renderer` native compositor binary'lerini koşullu require ediyor,
 * statik import Next'in modül grafiğine hepsini sokup derlemeyi kırıyor.
 * `carousel/compose.ts:48-50` aynı şeyi yapıyor.
 *
 * Ses BURADA basılmıyor (`muted: true`). Nihai karışım `finish` aşamasında
 * ffmpeg'de — gerçek kompresörle ducking ve platform normalizasyonu.
 */

/**
 * Çizelgedeki göreli dosya yollarını, o an ayakta olan asset sunucusunun
 * URL'lerine çevirir.
 *
 * Yolların çizelgede GÖRELİ durmasının sebebi: `timeline.v2.json` diske
 * yazılıyor ve efemer bir port numarası içermemeli — yarın açıldığında ölü bir
 * URL'e bakmasın.
 */
function withServedUrls(
  timeline: VideoTimeline,
  urlFor: (p: string) => string,
): VideoTimeline {
  return {
    ...timeline,
    video: timeline.video.map((track) => ({
      ...track,
      items: track.items.map((clip) => ({
        ...clip,
        media: { ...clip.media, src: urlFor(clip.media.src) },
      })),
    })),
    overlays: timeline.overlays.map((track) => ({
      ...track,
      items: track.items.map((item) =>
        item.kind === "sticker" ? { ...item, src: urlFor(item.src) } : item,
      ),
    })),
    audio: timeline.audio.map((track) => ({
      ...track,
      items: track.items.map((item) => ({ ...item, src: urlFor(item.src) })),
    })),
  };
}

export async function runComposeAgent(state: RunState): Promise<AgentResult> {
  const assetsDir = runAssetsDir(state.projectSlug, state.runId);
  const outPath = path.join(assetsDir, "montage.mp4");

  if (isMock("render")) {
    return {
      patch: { assets: { ...state.assets } },
      note: "[MOCK] Render atlandı — gerçek mp4 basılmadı (MOCK_RENDER=false ile aç).",
      cost: { vendor: "compute", detail: "[MOCK] render", costUsd: 0 },
    };
  }

  const timelinePath = state.assets.timelineV2;
  if (!timelinePath) {
    throw new Error("Çizelge yok — 'kurgu' aşaması önce koşmalı.");
  }

  const raw = await fsp.readFile(path.resolve(process.cwd(), timelinePath), "utf8");
  const timeline = JSON.parse(raw) as VideoTimeline;

  const { serveRunAssets } = await import("../../render/assetServer");
  const { renderRunVideo } = await import("../../render/media");

  // Sunucu run KÖKÜNE bağlanıyor, assets/ değil: ileride run kökü altındaki
  // başka bir klasörden (örn. referans görseller) beslemek gerekebilir ve
  // traversal koruması zaten kökle sınırlıyor.
  const server = await serveRunAssets(runDir(state.projectSlug, state.runId));

  try {
    const served = withServedUrls(timeline, (p) => server.urlFor(p));

    let lastLogged = -1;
    await renderRunVideo(served, outPath, {
      onProgress: ({ progress }) => {
        // İlerlemeyi %10'luk adımlarla logluyoruz: kuyruk olmadığı için bu
        // render tek bir HTTP isteği içinde koşuyor ve sessiz kalması kötü.
        const step = Math.floor(progress * 10);
        if (step > lastLogged) {
          lastLogged = step;
          console.log(`[render] ${state.runId} — %${step * 10}`);
        }
      },
    });
  } finally {
    // Sızan bir listener, 50ms'lik başlatma maliyetinden çok daha kötü.
    await server.close();
  }

  const stat = await fsp.stat(outPath);
  const mb = (stat.size / 1024 / 1024).toFixed(1);

  return {
    patch: { assets: { ...state.assets, montage: toRelative(outPath) } },
    note: `Sessiz montaj basıldı: montage.mp4 (${mb} MB, ${timeline.durationSec.toFixed(1)}sn). Ses 'finish' aşamasında biniyor.`,
    cost: {
      vendor: "compute",
      detail: `Remotion render — ${Math.round(timeline.durationSec * timeline.fps)} kare, lokal GPU`,
      costUsd: 0,
    },
  };
}
