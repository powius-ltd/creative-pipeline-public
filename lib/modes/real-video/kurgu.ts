import { runKurguCore, type KurguPlugin } from "../../agents/video/kurguCore";
import type { AgentResult, RealScene, RunState } from "../../orchestrator/types";
import { realVideoPayload } from "../../orchestrator/types";
import { runVideoFormat } from "./format";

/**
 * KURGU (real-video) — çekirdek mekanik `lib/agents/video/kurguCore.ts`'te,
 * burada yalnızca KARAR TABLOSU kalıyor: hangi geçiş, hangi kamera hareketi,
 * hangi altyazı stili. ai-video kendi tablosunu aynı çekirdeğe veriyor —
 * ikisi arasındaki tek fark bu dosyanın içeriği.
 *
 * Aşama A'da DETERMİNİSTİK: LLM yok. Aşama B'de LLM direktörü
 * `AnchoredEvent[]` üretecek ve `lib/timeline/anchors.ts` onu saniyeye
 * çevirecek; kurguCore'un çıktı şekli aynı kalacak.
 */

/** Sahne rolüne göre giriş geçişi — kapalı, basit bir kural. */
function transitionFor(scene: RealScene, index: number) {
  // İlk sahne ve hook sert girer: fade ile açılan bir hook 3 saniyelik dikkat
  // penceresinin yarısını harcar.
  if (index === 0 || scene.role === "hook") return { kind: "cut" as const, durationSec: 0 };
  if (scene.role === "cta") return { kind: "zoom-punch" as const, durationSec: 0.28 };
  return { kind: "dissolve" as const, durationSec: 0.25 };
}

/** Sahne başına hafif bir kamera nefesi — sabit görüntü ölü duruyor. */
function motionFor(_scene: RealScene, index: number) {
  const zoomIn = index % 2 === 0;
  return {
    from: { scale: zoomIn ? 1 : 1.1, x: 0, y: 0 },
    to: { scale: zoomIn ? 1.1 : 1, x: 0, y: 0 },
    easing: "ease-out" as const,
  };
}

const REAL_VIDEO_KURGU_PLUGIN: KurguPlugin<RealScene> = {
  transitionFor,
  motionFor,
  captionStyleFor: () => "capcut-bold",
};

export async function runKurguAgent(state: RunState): Promise<AgentResult> {
  const payload = realVideoPayload(state);
  // Carousel'in kanal presetini DEĞİL video formatını kullanıyoruz: orada
  // Instagram 4:5, burada Reels yani 9:16 olmalı (bkz. format.ts).
  const format = runVideoFormat(state);

  return runKurguCore(
    state,
    { scenes: payload.scenes, footage: payload.footage, musicTrack: state.assets.musicTrack },
    format,
    REAL_VIDEO_KURGU_PLUGIN,
  );
}
