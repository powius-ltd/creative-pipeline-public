import { runCopyCore } from "./copyCore";
import type { AgentResult, RunState } from "../../orchestrator/types";
import { realVideoPayload } from "../../orchestrator/types";

/**
 * COPYWRITER (real-video) — çekirdek `copyCore.ts`'te; bu dosya yalnızca
 * real-video'nun payload erişicisini kullanıp sonucu geri yazıyor. ai-video
 * kendi ince sarmalayıcısını aynı çekirdeğin üstüne yazıyor
 * (`lib/modes/ai-video/copy.ts`).
 */
export async function runRealVideoCopy(state: RunState): Promise<AgentResult> {
  const payload = realVideoPayload(state);
  const result = await runCopyCore(state, payload.scenes);

  return {
    patch: {
      payload: {
        ...payload,
        scenes: result.scenes,
        caption: result.caption,
        hashtags: result.hashtags,
      },
      ...(result.mocked
        ? {}
        : {
            variants: result.variants,
            chosenVariantId: result.variants[0]?.id ?? state.chosenVariantId,
          }),
    },
    note: result.mocked
      ? `[MOCK] ${result.scenes.length} sahne için replik yazıldı.`
      : `${result.scenes.length} sahne için replik ve ekran metni yazıldı, caption + ` +
        `${result.hashtags.length} hashtag hazır.` +
        (result.missingVoiceLineIds.length > 0
          ? ` UYARI: repliksiz sahne(ler): ${result.missingVoiceLineIds.join(", ")}`
          : ""),
    cost: result.cost,
  };
}
