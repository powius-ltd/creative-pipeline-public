import { runKurguCore, type KurguPlugin } from "../../agents/video/kurguCore";
import type { AgentResult, AiScene, RunState } from "../../orchestrator/types";
import { aiVideoPayload } from "../../orchestrator/types";
import { runVideoFormat } from "../real-video/format";

/**
 * KURGU (ai-video) — çekirdek `lib/agents/video/kurguCore.ts`'te ortak;
 * burada yalnızca ABSÜRT KARAR TABLOSU var. real-video'nun tablosuyla
 * (`real-video/kurgu.ts`) aynı desende, ama üç kararı da farklı okuyor:
 *
 *   - transitionFor: ortam sıçraması (environmentJump) SERT KESME ile
 *     işaretlenir — dissolve/fade sıçramayı "rüya sekansı" gibi açıklardı,
 *     kesme ise şakayı açıklamadan bırakır. Bu modun asıl espri kaynağı bu.
 *   - motionFor: kaynak zaten i2v'den geliyor ve KENDİ hareketini taşıyor;
 *     `camera: "sabit"` sahnelerde Ken Burns EKLENMİYOR, üstüne binerse iki
 *     hareket birbirini yiyip görüntü yüzer gibi olurdu.
 *   - captionStyleFor: "karaoke-pop" — dört stilin en bariz düzenlenmişi,
 *     modun kimliği "bariz şekilde AI" olduğu için doğru seçim.
 */

function transitionFor(scene: AiScene, index: number) {
  // Hook'un 3sn penceresi geçişe harcanmaz — real-video'nun kuralıyla aynı gerekçe.
  if (index === 0) return { kind: "cut" as const, durationSec: 0 };
  // Ortam sıçraması bu modun asıl şakası: yumuşak geçiş bir özür olurdu.
  if (scene.environmentJump) return { kind: "cut" as const, durationSec: 0 };
  if (scene.role === "cta") return { kind: "zoom-punch" as const, durationSec: 0.28 };
  // "whip" real-video'da hiç kullanılmıyordu (ölü dağarcık) — burada devrede:
  // kanıt sahnesine sert bir sıçrama hissi katıyor.
  if (scene.role === "kanit") return { kind: "whip" as const, durationSec: 0.22 };
  return { kind: "dissolve" as const, durationSec: 0.22 };
}

function motionFor(scene: AiScene, index: number) {
  // Klip zaten i2v'den geliyor ve kendi hareketini taşıyor — Ken Burns eklemek
  // iki hareketi bindirir. Yalnızca "hareketli" işaretli sahnelerde ekleniyor.
  if (scene.camera === "sabit") return undefined;

  // Yön PARİTEDEN değil ROLDEN geliyor (real-video'nun tersine) — ve x/y
  // gerçekten kullanılıyor: motor (kenBurnsTransform) pan destekliyor ama
  // real-video'da hiç kullanılmamıştı (x/y hep 0).
  if (scene.role === "hook") {
    return { from: { scale: 1.14, x: 0, y: 0 }, to: { scale: 1.0, x: 0, y: 0 }, easing: "ease-out" as const };
  }
  if (scene.role === "cta") {
    return { from: { scale: 1.0, x: 0, y: 0 }, to: { scale: 1.06, x: 0, y: -1.5 }, easing: "ease-out" as const };
  }
  // Diğerleri: çapraz kaydırma (pan) — index'e göre yön alternasyonu.
  const left = index % 2 === 0;
  return {
    from: { scale: 1.05, x: left ? -2 : 2, y: 0 },
    to: { scale: 1.1, x: left ? 2 : -2, y: 0 },
    easing: "linear" as const,
  };
}

const AI_VIDEO_KURGU_PLUGIN: KurguPlugin<AiScene> = {
  transitionFor,
  motionFor,
  captionStyleFor: () => "karaoke-pop",
};

export async function runAiVideoKurgu(state: RunState): Promise<AgentResult> {
  const payload = aiVideoPayload(state);
  const format = runVideoFormat(state);

  return runKurguCore(state, { scenes: payload.scenes, footage: payload.footage }, format, AI_VIDEO_KURGU_PLUGIN);
}
