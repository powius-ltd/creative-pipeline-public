import { isMock } from "../../config/mock";
import { PRICES } from "../../cost/prices";
import { channelPreset } from "./channels";
import type { CostLine, RunState, StageId } from "../../orchestrator/types";

interface Shape {
  slides: number;
  baked: number;
}

function shape(state: RunState): Shape {
  if (state.payload.kind === "carousel" && state.payload.slides.length > 0) {
    const slides = state.payload.slides;
    return {
      slides: slides.length,
      baked: slides.filter((s) => s.textMode === "baked").length,
    };
  }
  // Plan aşaması henüz koşmadıysa varsayım kullanılır; completeStage plan bitince
  // tahminleri gerçek slide verisiyle tazeliyor.
  const preset = channelPreset(state.platform);
  return { slides: preset.assumedSlides, baked: 2 };
}

export function estimateCarousel(state: RunState): Record<StageId, CostLine[]> {
  const { slides, baked } = shape(state);

  const visual: CostLine[] = isMock("visual")
    ? [{ vendor: "fal", detail: "[MOCK] görsel — maliyet yok", usd: 0 }]
    : [
        {
          vendor: "fal",
          detail: `1 çapa (t2i) + ${slides - 1} referanslı (kontext)`,
          usd: PRICES.falImageEach + (slides - 1) * PRICES.falImageRefEach,
        },
        {
          vendor: "fal",
          detail: `${baked} slide × gpt-image-2/edit (tipografi, fiyat TAHMİNİ)`,
          usd: baked * PRICES.gptImageEditEach,
        },
      ];

  // Planner ve copywriter aynı MOCK_SCRIPT bayrağını kullanıyor (ikisi de LLM ajanı).
  const llmMocked = isMock("script");
  const llmLine = (detail: string) =>
    llmMocked
      ? [{ vendor: "claude" as const, detail: `[MOCK] ${detail} — maliyet yok`, usd: 0 }]
      : [{ vendor: "claude" as const, detail: `claude CLI · ${detail}`, usd: PRICES.claudeCliCall }];

  const konseptMocked = isMock("konsept");
  const konsept: CostLine[] = konseptMocked
    ? [{ vendor: "claude", detail: "[MOCK] stratejist + muhalif — maliyet yok", usd: 0 }]
    : [
        { vendor: "claude", detail: "claude CLI · stratejist", usd: PRICES.claudeCliCall },
        { vendor: "claude", detail: "claude CLI · kreatif muhalif", usd: PRICES.claudeCliCall },
      ];

  return {
    konsept,
    plan: llmLine("sanat yönetmeni"),
    copy: llmLine("copywriter"),
    visual,
    compose: [{ vendor: "compute", detail: "Remotion lokal still render", usd: 0 }],
    qc: isMock("qc")
      ? [{ vendor: "claude", detail: "[MOCK] QC — maliyet yok", usd: 0 }]
      : [
          {
            vendor: "claude",
            detail: `claude CLI · ${slides} slide görsel incelemesi`,
            usd: PRICES.claudeCliVisionCall,
          },
        ],
  };
}
