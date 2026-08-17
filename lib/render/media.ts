import os from "node:os";
import path from "node:path";
import type { VideoTimeline } from "../../remotion/real-video/timeline";
import { getServeUrl } from "./bundle";

/**
 * GERÇEK mp4 RENDER'I.
 *
 * `still.ts` ile aynı iskelet ama iki fark var ve ikisi de bilinçli:
 *
 *   1. `muteAudio: true` — ses Remotion'da BASILMIYOR. Nihai karışım ffmpeg'de
 *      yapılıyor (`lib/media/ffmpeg.ts` → `finishVideo`): gerçek bir kompresörle
 *      ducking (`sidechaincompress`) ve platform normalizasyonu
 *      (`loudnorm I=-14`). Remotion'ın kare bazlı volume'ü bunların yerine
 *      geçemez. Tek karışım yetkisi olsun diye burada susturuluyor.
 *
 *   2. `imageFormat: "jpeg"` — kare başına PNG kodlamak video uzunluğunda
 *      belirgin şekilde yavaş. Kalite kaybı h264 encode'un yanında ölçülemez.
 *
 * `@remotion/renderer` importu TEMBEL kalmak zorunda — gerekçe `bundle.ts`'te.
 */

export interface RenderProgress {
  renderedFrames: number;
  encodedFrames: number;
  /** 0..1 */
  progress: number;
}

export interface RenderVideoOptions {
  onProgress?: (p: RenderProgress) => void;
  /**
   * Eşzamanlı sekme sayısı. Varsayılan: çekirdek sayısının yarısı — hepsini
   * kullanmak Windows'ta makineyi kilitliyor ve Next sunucusunu açlığa itiyor.
   */
  concurrency?: number;
  /** 0-51, düşük = daha iyi kalite. Varsayılan 18 (sosyal medya için fazlasıyla). */
  crf?: number;
}

export async function renderRunVideo(
  timeline: VideoTimeline,
  outputPath: string,
  opts: RenderVideoOptions = {},
): Promise<string> {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await getServeUrl();

  const inputProps = { timeline };

  // inputProps HEM selectComposition'a HEM renderMedia'ya veriliyor:
  // Root.tsx'teki calculateMetadata boyutu/fps'i/süreyi çizelgeden türetiyor,
  // yani props olmadan yanlış kompozisyon metadatası döner.
  const composition = await selectComposition({
    serveUrl,
    id: "RealVideo",
    inputProps,
  });

  const totalFrames = composition.durationInFrames;

  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    codec: "h264",
    outputLocation: path.resolve(outputPath),
    imageFormat: "jpeg",
    jpegQuality: 95,
    crf: opts.crf ?? 18,
    // Seçeneğin adı `muted` (kurulu 4.0.498'in RenderMediaOptions'ından
    // doğrulandı — `muteAudio` diye bir alan yok).
    muted: true,
    // `muted` tek başına yetmiyor: Remotion yine de SESSİZ bir AAC izi ekliyor
    // (ölçüldü — 2.0sn'lik video 2.048sn'lik dosya veriyor). `finishVideo` zaten
    // `-map 0:v` ile onu yok sayıyor, yani boşa yer ve kodlama zamanı.
    enforceAudioTrack: false,
    concurrency: opts.concurrency ?? Math.max(2, Math.floor(os.cpus().length / 2)),
    // "angle" Windows'ta yazılım GL'den belirgin şekilde hızlı ve
    // OffthreadVideo'nun kare çıkarımıyla uyumlu.
    chromiumOptions: { gl: "angle" },
    onProgress: opts.onProgress
      ? ({ renderedFrames, encodedFrames }) =>
          opts.onProgress?.({
            renderedFrames,
            encodedFrames,
            progress: totalFrames > 0 ? renderedFrames / totalFrames : 0,
          })
      : undefined,
    // OffthreadVideo kaynak klipte seek yaparken yavaş olabiliyor; varsayılan
    // 30sn'lik kare zaman aşımı gerçek footage'da yetmiyor.
    timeoutInMilliseconds: 120_000,
  });

  return outputPath;
}
