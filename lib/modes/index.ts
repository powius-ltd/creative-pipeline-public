import { aiVideoMode } from "./ai-video";
import { carouselMode } from "./carousel";
import { fullAiVideoMode } from "./full-ai-video";
import { realVideoMode } from "./real-video";
import type { ModeDefinition } from "./types";
import type { ModeId } from "../orchestrator/types";

/**
 * SUNUCU TARAFI mod kayıt defteri. Mod tanımları ajan fonksiyonları içerir ve
 * bunlar node:fs / node:child_process kullanır — bu dosya İSTEMCİDEN İMPORT
 * EDİLMEMELİ. İstemcinin ihtiyaç duyduğu aşama listesi ve etiketler
 * ./descriptors.ts içinde saf veri olarak ayrı duruyor; RunView yalnızca onu
 * import eder.
 */
const MODES: Record<ModeId, ModeDefinition> = {
  "full-ai-video": fullAiVideoMode,
  carousel: carouselMode,
  "real-video": realVideoMode,
  "ai-video": aiVideoMode,
};

export function getMode(mode: ModeId): ModeDefinition {
  const found = MODES[mode];
  if (!found) throw new Error(`Bilinmeyen mod: ${mode}`);
  return found;
}
