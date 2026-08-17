import { runKonsept } from "../carousel/konsept";
import { MODE_DESCRIPTORS } from "../descriptors";
import { assertModeConsistent, type ModeDefinition } from "../types";
import { runComposeAgent } from "../../agents/video/compose";
import { runRealVideoCopy } from "../../agents/video/copy";
import { runFinishAgent } from "../../agents/video/finish";
import { runVoiceAgent } from "../../agents/voice";
import { estimateRealVideo } from "./cost";
import { runFootageStage } from "./footage";
import { runKurguAgent } from "./kurgu";
import { runRealVideoPlanner } from "./planner";
import { runRealVideoQc } from "./qc";

/**
 * GERÇEK VİDEO MODU — CapCut tarzı kurgu hattı.
 *
 * `konsept` ve `voice` ajanları PAYLAŞILAN: konsept moddan bağımsız (taksonomi
 * ve marka anayasası üzerinden çalışıyor), voice ise zaten sahne listesi alıp
 * mp3 + kelime damgası üretiyor. `lib/agents/` bu yüzden ortak blok deposu.
 *
 * Aşama sırası bir onay kapıları dizisi: `copy` bitmeden seslendirme parası
 * harcanmıyor, `footage` bitmeden render zamanı harcanmıyor.
 */
export const realVideoMode: ModeDefinition = assertModeConsistent({
  descriptor: MODE_DESCRIPTORS["real-video"],
  payloadKind: "real-video",
  agents: {
    konsept: runKonsept,
    plan: runRealVideoPlanner,
    copy: runRealVideoCopy,
    footage: runFootageStage,
    voice: runVoiceAgent,
    kurgu: runKurguAgent,
    compose: runComposeAgent,
    finish: runFinishAgent,
    qc: runRealVideoQc,
  },
  estimate: estimateRealVideo,
});
