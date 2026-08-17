import fsp from "node:fs/promises";
import path from "node:path";
import type { VideoTimeline } from "../../../remotion/real-video/timeline";
import { isMock } from "../../config/mock";
import { finishVideo, type FinishAudioInput } from "../../media/ffmpeg";
import { runAssetsDir } from "../../orchestrator/paths";
import type { AgentResult, RunState } from "../../orchestrator/types";
import { toRelative } from "../../providers/download";

/**
 * SES KARIŞIMI VE NİHAİ ENCODE.
 *
 * Çizelgedeki `audio` kanalı Remotion'da yalnızca önizleme içindi; gerçek
 * karışım burada. `mix` alanı bildirimsel: hangi iz neyi duck'lasın ve hedef
 * loudness ne — kurgu ajanı bunu yazdı, ffmpeg icra ediyor.
 */
export async function runFinishAgent(state: RunState): Promise<AgentResult> {
  const assetsDir = runAssetsDir(state.projectSlug, state.runId);
  const outPath = path.join(assetsDir, "final.mp4");

  if (isMock("finish")) {
    return {
      patch: { assets: { ...state.assets } },
      note: "[MOCK] Ses karışımı atlandı (MOCK_FINISH=false ile aç).",
      cost: { vendor: "compute", detail: "[MOCK] finisaj", costUsd: 0 },
    };
  }

  const montage = state.assets.montage;
  if (!montage) {
    throw new Error("Montaj yok — 'compose' aşaması önce koşmalı.");
  }
  const timelinePath = state.assets.timelineV2;
  if (!timelinePath) {
    throw new Error("Çizelge yok — 'kurgu' aşaması önce koşmalı.");
  }

  const timeline = JSON.parse(
    await fsp.readFile(path.resolve(process.cwd(), timelinePath), "utf8"),
  ) as VideoTimeline;

  // Çizelgedeki yollar göreli; ffmpeg mutlak istiyor.
  const audio: FinishAudioInput[] = timeline.audio
    .flatMap((t) => t.items)
    .map((a) => ({
      src: path.resolve(process.cwd(), a.src),
      role: a.role,
      startSec: a.startSec,
      inSec: a.inSec,
      outSec: a.outSec,
      gain: a.gain,
      fadeInSec: a.fadeInSec,
      fadeOutSec: a.fadeOutSec,
    }));

  // Var olmayan ses dosyası tüm filtre grafiğini düşürür — önden eliyoruz.
  const usable: FinishAudioInput[] = [];
  const skipped: string[] = [];
  for (const a of audio) {
    const ok = await fsp
      .stat(a.src)
      .then((s) => s.isFile())
      .catch(() => false);
    if (ok) usable.push(a);
    else skipped.push(path.basename(a.src));
  }

  await finishVideo({
    videoPath: path.resolve(process.cwd(), montage),
    audio: usable,
    duck: {
      ratio: timeline.mix.duck.ratio,
      thresholdDb: timeline.mix.duck.thresholdDb,
      releaseMs: timeline.mix.duck.releaseMs,
    },
    loudnessLufs: timeline.mix.loudnessLufs,
    outPath,
  });

  const stat = await fsp.stat(outPath);
  const mb = (stat.size / 1024 / 1024).toFixed(1);
  const voices = usable.filter((a) => a.role === "voice").length;
  const beds = usable.length - voices;

  return {
    patch: { assets: { ...state.assets, finalVideo: toRelative(outPath) } },
    note:
      `final.mp4 hazır (${mb} MB) — ${voices} seslendirme + ${beds} fon izi, ` +
      `${timeline.mix.loudnessLufs} LUFS'a normalize edildi` +
      (voices > 0 && beds > 0 ? ", müzik VO altında duck'landı." : ".") +
      (skipped.length > 0 ? `\nUYARI: bulunamayan ses dosyaları atlandı: ${skipped.join(", ")}` : ""),
    cost: { vendor: "compute", detail: "ffmpeg karışım + encode (video kopyalandı)", costUsd: 0 },
  };
}
