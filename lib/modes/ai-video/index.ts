import { runKonsept } from "../carousel/konsept";
import { MODE_DESCRIPTORS } from "../descriptors";
import { assertModeConsistent, type ModeDefinition } from "../types";
import { runComposeAgent } from "../../agents/video/compose";
import { runFinishAgent } from "../../agents/video/finish";
import { runVoiceAgent } from "../../agents/voice";
import { estimateAiVideo } from "./cost";
import { runAiVideoCopy } from "./copy";
import { runCharacterStage } from "./karakter";
import { runAiVideoKurgu } from "./kurgu";
import { runAiVideoPlanner } from "./planner";
import { runAiVideoQc } from "./qc";
import { runSceneStage } from "./sahne";

/**
 * AI VIDEO MODU — tamamen AI üretimi, bilinçli olarak absürt/açıkça-AI kurgu
 * dili. Aynı karakter, ortam sahneden sahneye vahşice değişiyor.
 *
 * real-video'nun kanıtlanmış render/ses/QC bloklarını PAYLAŞIYOR (konsept,
 * voice, compose, finish — `lib/agents/` "paylaşılan blok deposu"); yalnızca
 * kreatif kararın farklı olduğu yerler forklanmış: planner, copy (çekirdeği
 * paylaşıyor, eklentisi kendi), karakter/sahne (real-video'nun footage'ı
 * yerine), kurgu (çekirdeği paylaşıyor, karar tablosu absürt), qc (çekirdeği
 * aynı desen, karakter tutarlılığı merceği).
 *
 * Aşama sırası: `voice` ÜRETİMDEN (karakter/sahne) ÖNCE — bu modda materyal
 * bedava değil, süresi paraya çevriliyor. Seslendirme gerçek süreyi öğrenmenin
 * en ucuz yolu, video üretimi yanlış süreyle olmanın en pahalısı.
 */
export const aiVideoMode: ModeDefinition = assertModeConsistent({
  descriptor: MODE_DESCRIPTORS["ai-video"],
  payloadKind: "ai-video",
  agents: {
    konsept: runKonsept,
    plan: runAiVideoPlanner,
    copy: runAiVideoCopy,
    voice: runVoiceAgent,
    karakter: runCharacterStage,
    sahne: runSceneStage,
    kurgu: runAiVideoKurgu,
    compose: runComposeAgent,
    finish: runFinishAgent,
    qc: runAiVideoQc,
  },
  estimate: estimateAiVideo,
});
