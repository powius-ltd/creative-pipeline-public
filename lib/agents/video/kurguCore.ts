import fsp from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_MIX,
  timelineDurationSec,
  type AudioItem,
  type CaptionItem,
  type CaptionStyleId,
  type ClipItem,
  type KenBurns,
  type OverlayItem,
  type TransitionSpec,
  type VideoTimeline,
} from "../../../remotion/real-video/timeline";
import { buildTimingContext, type TimingSceneInput } from "../../audio/timing";
import { languageSpec } from "../../config/language";
import { runAssetsDir } from "../../orchestrator/paths";
import type {
  AgentResult,
  FootageClip,
  RealSceneRole,
  RunState,
} from "../../orchestrator/types";
import { toRelative } from "../../providers/download";

/**
 * `lib/modes/real-video/format.ts`'teki `VideoFormat`'ın minimal karşılığı —
 * o tipi BURADAN import ETMİYORUZ bilerek: `lib/agents/` paylaşılan blok
 * deposu, `lib/modes/` ona bağımlı olmalı, tersi değil. ai-video kendi format
 * kaynağını yazacak (muhtemelen aynı `AspectSpec.video` + fps), o da bu
 * asgari şekle uyar.
 */
export interface KurguFormat {
  width: number;
  height: number;
  fps: number;
}

/**
 * KURGU ÇEKİRDEĞİ — sahneleri, kelime damgalarını ve materyali tek çizelgeye
 * bağlayan MEKANİK. real-video ve ai-video bunu PAYLAŞIYOR; ayrışan tek şey
 * hangi geçiş/hareket/altyazı stilinin seçildiği — o da `KurguPlugin` ile
 * dışarıdan veriliyor (bkz. `lib/agents/planner/core.ts`'teki aynı desen:
 * ortak çekirdek + moda özel eklenti).
 *
 * Aşama A'da DETERMİNİSTİK: LLM yok. Sahneler seslendirme süresine göre uç uca
 * diziliyor, her sahneye bir klip trim'leniyor, altyazı doğrudan kelime
 * damgalarından kuruluyor.
 */

/** Kurgu çekirdeğinin bir sahneden ihtiyaç duyduğu ASGARİ şekil. */
export interface KurguSceneBase {
  id: string;
  role: RealSceneRole;
  durationSec: number;
  voiceLine: string;
  onScreenText: string;
  /**
   * Lip-sync dikişi — yalnızca `AiScene` dolduruyor (`RealScene`'de yok, bu
   * yüzden opsiyonel). `KurguSceneBase`de olması ClipItem.lipSync'e mod
   * ayrımı yapmadan aktarılabilmesi için — bkz. `ClipItem.lipSync` notu.
   */
  speaking?: boolean;
}

/**
 * KARAR TABLOSU — moda göre değişen tek şey. real-video kendi 3 satırlık
 * kuralını burada verir; ai-video (absürt kurgu dili) kendi tablosunu.
 * `prev` yalnızca ai-video'nun ortam sıçraması gibi bağlam gerektiren
 * kararları için var — real-video'nun kuralları onu okumuyor.
 */
export interface KurguPlugin<TScene extends KurguSceneBase = KurguSceneBase> {
  transitionFor(scene: TScene, index: number, prev: TScene | undefined): TransitionSpec;
  motionFor(scene: TScene, index: number): KenBurns | undefined;
  captionStyleFor(scene: TScene): CaptionStyleId;
}

export interface KurguInput<TScene extends KurguSceneBase> {
  scenes: TScene[];
  footage: FootageClip[];
  musicTrack?: string;
}

/**
 * Altyazı PENCERELERE bölünüyor — tüm cümle aynı anda ekranda durmuyor.
 *
 * İki sebep, biri estetik biri teknik:
 *   - CapCut'ın yaptığı bu. Uzun cümlenin tamamını basmak "altyazılı video"
 *     görünümü verir, kısa pencereler hâlinde akıtmak "CapCut kreatifi".
 *   - Uzun replikler kareden TAŞIYOR (ölçüldü: 12 kelimelik bir replik 1080×1920
 *     karede alt kenardan kesildi). Pencereleme bunu kökten çözüyor.
 *
 * Bölme önce kelime sayısına, sonra süreye bakıyor: 5 kelimeyi geçmesin ama
 * 2.2 saniyeyi de geçmesin — yavaş konuşmada 5 kelime çok uzun durabiliyor.
 */
const MAX_WORDS_PER_CHUNK = 5;
const MAX_CHUNK_SEC = 2.2;

function chunkWords<T extends { startSec: number; endSec: number }>(words: T[]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];

  for (const w of words) {
    const wouldBeTooLong = cur.length > 0 && w.endSec - cur[0].startSec > MAX_CHUNK_SEC;
    if (cur.length >= MAX_WORDS_PER_CHUNK || wouldBeTooLong) {
      out.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export async function runKurguCore<TScene extends KurguSceneBase>(
  state: RunState,
  input: KurguInput<TScene>,
  format: KurguFormat,
  plugin: KurguPlugin<TScene>,
): Promise<AgentResult> {
  const { scenes, footage, musicTrack } = input;
  const fps = format.fps;

  if (scenes.length === 0) {
    throw new Error("Kurgu sahnesiz çalışamaz — 'plan' ve 'copy' önce koşmalı.");
  }

  // ---- 1. Zaman ekseni: seslendirmeden gelen gerçek süreler --------------
  const timingInput: TimingSceneInput[] = scenes.map((s) => ({
    sceneId: s.id,
    voiceLine: s.voiceLine,
    voicePath: state.assets.voice[s.id],
    wordsPath: state.assets.words?.[s.id],
    fallbackDurationSec: s.durationSec,
  }));

  const ctx = await buildTimingContext(timingInput, { fps, language: state.language });

  // ---- 2. Video kanalı ----------------------------------------------------
  const footageByScene = new Map(footage.map((f) => [f.sceneId, f]));
  const warnings: string[] = [];

  const clips: ClipItem[] = [];
  let prevScene: TScene | undefined;
  for (const [i, scene] of scenes.entries()) {
    const timing = ctx.scenes.find((s) => s.sceneId === scene.id);
    if (!timing) continue;

    const clip = footageByScene.get(scene.id);
    if (!clip) {
      warnings.push(`Sahne '${scene.id}' için materyal yok — klip atlandı.`);
      continue;
    }

    const sceneDur = timing.endSec - timing.startSec;
    const trans = plugin.transitionFor(scene, i, prevScene);
    prevScene = scene;

    // Geçiş BİNDİRME ile ifade ediliyor: klip, geçiş süresi kadar erken başlıyor
    // ve o kadar uzun sürüyor. Böylece önceki klip hâlâ ekrandayken bu açılıyor.
    // (Süreyi kısaltan TransitionSeries yaklaşımı çok kanallı modelde overlay
    // zamanını kaydırırdı — bkz. remotion/real-video/transitions.ts.)
    const overlap = i === 0 ? 0 : trans.durationSec;
    const startSec = Math.max(0, timing.startSec - overlap);
    const durationSec = sceneDur + overlap;

    // Kaynakta o kadar malzeme var mı? Yoksa elimizdekiyle yetin.
    const available = clip.outSec - clip.inSec;
    const outSec = clip.inSec + Math.min(durationSec, available);
    if (available + 0.05 < durationSec) {
      warnings.push(
        `Sahne '${scene.id}': klip ${available.toFixed(2)}sn ama ${durationSec.toFixed(2)}sn gerekiyor — ` +
          `son kare donacak.`,
      );
    }

    const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(clip.file);

    clips.push({
      id: scene.id,
      startSec,
      durationSec,
      fit: "cover",
      media: {
        // Gerçek URL compose aşamasında asset sunucusundan yazılıyor; burada
        // GÖRELİ YOL duruyor ki timeline.v2.json porta bağımlı olmasın.
        src: clip.file,
        kind: isVideo ? "video" : "image",
        inSec: isVideo ? clip.inSec : 0,
        outSec: isVideo ? outSec : 0,
        useSourceAudio: false,
        sourceGain: 0,
      },
      motion: plugin.motionFor(scene, i),
      transitionIn: trans,
      // Yatay kaynak dikey kareye giriyorsa üst-orta genelde daha doğru:
      // yüzler kadrajın üst yarısında oluyor.
      focus: clip.probe.width > clip.probe.height ? { x: 0.5, y: 0.38 } : undefined,
      // real-video'nun sahnelerinde `speaking` hiç yok (undefined) — alan
      // JSON.stringify'da düşer, yani real-video çıktısı ETKİLENMİYOR.
      ...(scene.speaking ? { lipSync: true } : {}),
    });
  }

  // ---- 3. Overlay kanalı: altyazı + ekran metni ---------------------------
  const overlays: OverlayItem[] = [];

  for (const scene of scenes) {
    const timing = ctx.scenes.find((s) => s.sceneId === scene.id);
    if (!timing || timing.words.length === 0) continue;

    const chunks = chunkWords(timing.words);
    const styleId = plugin.captionStyleFor(scene);

    for (const [ci, chunk] of chunks.entries()) {
      const first = chunk[0];
      const last = chunk[chunk.length - 1];
      const next = chunks[ci + 1]?.[0];

      // Pencere, bir sonraki pencere başlayana kadar ekranda kalsın — aksi halde
      // kelimeler arasında altyazı sönüp yanıyor. Son pencereye kısa kuyruk.
      const endSec = next ? next.startSec : last.endSec + 0.35;

      const caption: CaptionItem = {
        kind: "caption",
        id: `cap-${scene.id}-${ci}`,
        startSec: first.startSec,
        durationSec: Math.max(0.3, endSec - first.startSec),
        words: chunk.map((w) => ({
          text: w.text,
          startSec: w.startSec,
          endSec: w.endSec,
        })),
        styleId,
        position: { x: 0.5, y: 0.76 },
        maxWidthPct: 0.86,
        fontSizePct: 0.05,
        color: "#ffffff",
        highlightColor: "#ffd400",
        strokeWidthPct: 0.0055,
      };
      overlays.push(caption);
    }

    if (scene.onScreenText.trim()) {
      overlays.push({
        kind: "title",
        id: `title-${scene.id}`,
        startSec: timing.startSec + 0.12,
        durationSec: Math.max(1.2, (timing.endSec - timing.startSec) * 0.75),
        text: scene.onScreenText,
        styleId: scene.role === "hook" ? "hook" : scene.role === "cta" ? "cta" : "lower-third",
        animation: scene.role === "hook" ? "pop" : "slide-up",
        position: { x: 0.5, y: 0.22 },
        fontSizePct: scene.role === "hook" ? 0.058 : 0.042,
        color: "#ffffff",
        ...(scene.role === "cta" ? { boxColor: "#111318" } : {}),
      });
    }
  }

  // ---- 4. Ses kanalı (yalnızca önizleme; karışım ffmpeg'de) ---------------
  const audio: AudioItem[] = [];
  for (const scene of scenes) {
    const voicePath = state.assets.voice[scene.id];
    const timing = ctx.scenes.find((s) => s.sceneId === scene.id);
    if (!voicePath || !timing) continue;
    // Mock seslendirme .json yazıyor, çalınabilir değil — atla.
    if (!/\.(mp3|wav|m4a|aac)$/i.test(voicePath)) continue;

    audio.push({
      id: `vo-${scene.id}`,
      src: voicePath,
      role: "voice",
      startSec: timing.startSec,
      inSec: 0,
      outSec: timing.endSec - timing.startSec,
      gain: 1,
    });
  }

  const totalSec = clips.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0);

  if (musicTrack && /\.(mp3|wav|m4a|aac)$/i.test(musicTrack)) {
    audio.push({
      id: "music",
      src: musicTrack,
      role: "music",
      startSec: 0,
      inSec: 0,
      outSec: totalSec,
      gain: 0.35,
      fadeInSec: 0.6,
      fadeOutSec: 1.2,
    });
  }

  // ---- 5. Çizelgeyi yaz ---------------------------------------------------
  const timeline: VideoTimeline = {
    version: 2,
    fps,
    width: format.width,
    height: format.height,
    // Büyük harf locale'i buradan geliyor — bkz. VideoTimeline.language.
    language: state.language,
    video: [{ id: "v0", label: "Ana kurgu", items: clips }],
    overlays: [{ id: "o0", label: "Yazı", items: overlays }],
    audio: [{ id: "a0", label: "Ses", items: audio }],
    // Track içinde değil, kökte — bkz. WatermarkSpec'in üstündeki süre tuzağı notu.
    watermark: state.watermark
      ? {
          text: languageSpec(state.language).watermarkText,
          position: "alt-orta",
          fontSizePct: 0.028,
          opacity: 0.72,
        }
      : undefined,
    durationSec: 0,
    mix: DEFAULT_MIX,
  };
  timeline.durationSec = timelineDurationSec(timeline);

  const assetsDir = runAssetsDir(state.projectSlug, state.runId);
  await fsp.mkdir(assetsDir, { recursive: true });
  const timelinePath = path.join(assetsDir, "timeline.v2.json");
  await fsp.writeFile(timelinePath, JSON.stringify(timeline, null, 2));

  return {
    patch: {
      assets: { ...state.assets, timelineV2: toRelative(timelinePath) },
    },
    note:
      `Çizelge kuruldu: ${clips.length} klip, ${overlays.length} overlay, ` +
      `${audio.length} ses izi, ${timeline.durationSec.toFixed(1)}sn.` +
      (warnings.length > 0 ? `\nUYARILAR:\n  - ${warnings.join("\n  - ")}` : ""),
    cost: { vendor: "compute", detail: "kurgu — deterministik, LLM yok", costUsd: 0 },
  };
}
