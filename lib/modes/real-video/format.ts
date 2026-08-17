import { aspectSpec, type AspectRatioId } from "../../config/aspect";
import { runAspect } from "../descriptors";
import type { Platform, RunState } from "../../orchestrator/types";

/**
 * VİDEO FORMATI — boyut artık `lib/config/aspect.ts`'ten (run başına seçiliyor,
 * bkz. `AspectSpec.video`). Burada YALNIZCA piksele indirgenemeyen kısım kalıyor:
 * fps ve platforma göre hedef süre bandı (Shorts 55sn'ye kadar çıkabiliyor).
 *
 * Ayrılığın eski gerekçesi ("carousel Instagram'ı 4:5 tanımlıyor, video 9:16
 * ister") artık geçerli değil — o gerekçe "ayrı tablo" değildi, "aynı orandan
 * iki farklı piksel kuralı"ydı ve bunu şimdi `AspectSpec.still` / `.video`
 * karşılıyor. Platform hâlâ yalnızca SÜRE bandını belirliyor.
 */
export interface VideoFormat {
  width: number;
  height: number;
  fps: number;
  /** Hedef süre aralığı — planner promptuna giriyor. */
  minSec: number;
  maxSec: number;
}

const FPS = 30;
const DEFAULT_DURATION = { minSec: 15, maxSec: 40 };

const DURATION_BY_PLATFORM: Record<Platform, { minSec: number; maxSec: number }> = {
  instagram: DEFAULT_DURATION,
  tiktok: DEFAULT_DURATION,
  // Shorts 60 saniyeye kadar çıkabiliyor; hattın hedefi hâlâ kısa ama pay var.
  youtube_shorts: { ...DEFAULT_DURATION, maxSec: 55 },
  other: DEFAULT_DURATION,
};

export function videoFormat(platform: Platform, aspect: AspectRatioId): VideoFormat {
  const { width, height } = aspectSpec(aspect).video;
  const duration = DURATION_BY_PLATFORM[platform] ?? DEFAULT_DURATION;
  return { width, height, fps: FPS, ...duration };
}

/** `videoFormat`'ın run'a uygulanmış kısayolu — eski run'larda `aspect` yoksa çözer. */
export function runVideoFormat(
  state: Pick<RunState, "mode" | "platform" | "aspect">,
): VideoFormat {
  return videoFormat(state.platform, runAspect(state));
}
