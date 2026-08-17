import { runCopyCore } from "../../agents/video/copyCore";
import type { AgentResult, RunState } from "../../orchestrator/types";
import { aiVideoPayload } from "../../orchestrator/types";

/**
 * COPYWRITER (ai-video) — çekirdek `copyCore.ts`'te; real-video'nun ince
 * sarmalayıcısıyla (`lib/agents/video/copy.ts`) BİREBİR aynı desen, tek fark
 * payload erişicisi.
 */
export async function runAiVideoCopy(state: RunState): Promise<AgentResult> {
  const payload = aiVideoPayload(state);
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
