import { runMontageAgent } from "../../agents/montage";
import { runQcAgent } from "../../agents/qc";
import { runScriptAgent } from "../../agents/script";
import { runVisualAgent } from "../../agents/visual";
import { runVoiceAgent } from "../../agents/voice";
import { MODE_DESCRIPTORS } from "../descriptors";
import { assertModeConsistent, type ModeDefinition } from "../types";
import { estimateFullAiVideo } from "./cost";

// Ajanlar lib/agents/ altında kalıyor: bunlar paylaşılan blok deposu, moda özel
// değil (real-photo modu voice/montage ajanlarını aynen yeniden kullanacak).
export const fullAiVideoMode: ModeDefinition = assertModeConsistent({
  descriptor: MODE_DESCRIPTORS["full-ai-video"],
  payloadKind: "video",
  agents: {
    brief: runScriptAgent,
    voice: runVoiceAgent,
    visual: runVisualAgent,
    montage: runMontageAgent,
    qc: runQcAgent,
  },
  estimate: estimateFullAiVideo,
});
