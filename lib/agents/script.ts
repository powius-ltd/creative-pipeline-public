import { isMock } from "../config/mock";
import type {
  AgentResult,
  CameraAnimation,
  RunState,
  Scene,
  VariantIdea,
} from "../orchestrator/types";

const CAMERA_CYCLE: CameraAnimation[] = [
  "zoom-in",
  "pan-right",
  "breathing",
  "zoom-out",
];

const SCENE_BEATS = [
  "Hook — dikkat çeken açılış",
  "Problem — izleyicinin sorununu göster",
  "Çözüm — ürünü/tanıtımı devreye sok",
  "CTA — harekete geçirici çağrı",
];

function buildMockScenes(topic: string): Scene[] {
  return SCENE_BEATS.map((beat, i) => ({
    id: `scene-${i + 1}`,
    index: i,
    durationSec: i === SCENE_BEATS.length - 1 ? 4 : 5,
    voiceLine: `[MOCK] ${beat}: "${topic}" için örnek repluk.`,
    visualPrompt: `${topic} — ${beat.toLowerCase()}, sinematik, gerçekçi ışık`,
    cameraAnimation: CAMERA_CYCLE[i % CAMERA_CYCLE.length],
  }));
}

function buildMockVariants(topic: string): VariantIdea[] {
  return [
    {
      id: "variant-1",
      label: "Doğrudan hook",
      hook: `"${topic}" hakkında bilmediğin şey...`,
      cta: "Hemen dene",
    },
    {
      id: "variant-2",
      label: "Soru hook",
      hook: `${topic} için gerçekten en iyisi bu mu?`,
      cta: "Linke tıkla",
    },
    {
      id: "variant-3",
      label: "Karşılaştırma hook",
      hook: `Herkes ${topic} derken, biz farklı yaptık.`,
      cta: "Şimdi keşfet",
    },
  ];
}

export async function runScriptAgent(state: RunState): Promise<AgentResult> {
  if (!isMock("script")) {
    throw new Error(
      "Gerçek script/LLM entegrasyonu henüz bağlanmadı (açık madde) — MOCK_MODE=false iken " +
        "runScriptAgent çağrılamaz.",
    );
  }

  const scenes = buildMockScenes(state.topic);
  const variants = buildMockVariants(state.topic);
  const chosenVariantId = variants[0].id;

  return {
    patch: {
      payload: { kind: "video", scenes },
      variants,
      chosenVariantId,
    },
    note: `[MOCK] Brief işlendi: ${scenes.length} sahne, ${variants.length} varyant fikri üretildi (seçilen: ${chosenVariantId}).`,
  };
}
