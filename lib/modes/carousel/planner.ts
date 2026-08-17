import { runPlannerCore } from "../../agents/planner/core";
import { isMock } from "../../config/mock";
import { carouselAspect, channelPreset, type ChannelPreset } from "./channels";
import type {
  AgentResult,
  KreatifBrief,
  RunState,
  Slide,
  SlideRole,
  SlideTextMode,
  VisualTheme,
} from "../../orchestrator/types";
import { carouselPayload } from "../../orchestrator/types";

interface PlannedSlide {
  role: SlideRole;
  textMode: SlideTextMode;
  visualPrompt: string;
  intent: string;
}

const slidePlanSchema = (min: number, max: number) => ({
  type: "array",
  minItems: min,
  maxItems: max,
  items: {
    type: "object",
    properties: {
      role: { type: "string", enum: ["hook", "body", "cta"] },
      textMode: {
        type: "string",
        enum: ["baked", "overlay"],
        description:
          "baked = yazı görselin içine çizilir (tasarlanmış, dikkat çeken slide'lar için); " +
          "overlay = temiz görsel üretilir, yazı sonradan bindirilir (uzun/kesin metin için)",
      },
      visualPrompt: {
        type: "string",
        description:
          "Bu slide'ın görselini tarif eden prompt. Stil sözleşmesini TEKRARLAMA — " +
          "o ayrıca eklenecek. Yalnızca bu karenin içeriğini yaz.",
      },
      intent: {
        type: "string",
        description: "Bu slide'ın anlatıdaki işi — copywriter bunu okuyup metni yazacak.",
      },
    },
    required: ["role", "textMode", "visualPrompt", "intent"],
    additionalProperties: false,
  },
});

/**
 * Konsept aşaması bu run için brief üretmişse, planner artık tema/hook/açı kararı
 * VERMEZ — konsept aşamasının kararını UYGULAR. brief=null ise (konsept aşaması
 * olmayan eski run, ya da anayasa eksikken atlanmışsa) eski serbest davranış aynen
 * korunur — geriye dönük uyumluluk.
 */
const briefSection = (brief: KreatifBrief | null | undefined) =>
  brief
    ? [
        "GÖREV 0 — KONSEPT UYGULA (kendi hücre/açı kararını verme, aşağıdakini uygula):",
        `  Segment × açı: ${brief.segment} × ${brief.aci} (funnel katmanı ${brief.funnelKatmani})`,
        `  Gerekçe: ${brief.hucreGerekcesi}`,
        `  Tema yönü: ${brief.temaYonu}`,
        `  İçerik tipi: ${brief.icerikTipi} · hook amacı: ${brief.hookAmaci} · ` +
          `anatomik kanal: ${brief.anatomikKanal} · tetikleyici: ${brief.tetikleyici}`,
        `  Seçilen hook (ilk slide bunu taşımalı): "${brief.secilenHook}"`,
        brief.yasaklar.length ? `  Yasaklar: ${brief.yasaklar.join(", ")}` : "",
        brief.muhalifNotu ? `  Kreatif Muhalif notu (dikkate al): ${brief.muhalifNotu}` : "",
        "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

const taskSection = (
  preset: ChannelPreset,
  aspectId: string,
  brief: KreatifBrief | null | undefined,
) => [
  briefSection(brief),
  `GÖREV 2 — ${preset.label} için carousel'in anlatı yayını kur:`,
  `Kanal karakteri: ${preset.voiceNote}`,
  `Format: ${aspectId} dikey kare.`,
  "",
  `${preset.minSlides}-${preset.maxSlides} slide arasında, konunun`,
  "gerektirdiği kadar slide planla — basit bir duyuru az, bir rehber çok slide ister.",
  "İlk slide 'hook', son slide 'cta' olmalı; aradakiler 'body'.",
  "",
  "Her slide için textMode kararını sen ver:",
  "  - 'baked': yazı görselin içine çizilecek. Tasarlanmış görünür ama metin uzunsa",
  "    riskli ve sonradan düzeltilemez. Hook ve CTA için genelde doğru tercih.",
  "  - 'overlay': görsel temiz üretilir, yazı programatik bindirilir. Metin garanti",
  "    doğru ve düzenlenebilir. Uzun açıklama taşıyan body slide'ları için doğru tercih.",
  "'overlay' slide'ların visualPrompt'unda kompozisyonda metin için boşluk bırakılmasını iste.",
  "Hiçbir visualPrompt'ta görselin içine yazı/harf istemeyeceksin — yazıyı ayrı bir adım koyacak.",
].join("\n");

function toSlides(planned: PlannedSlide[], theme: VisualTheme): Slide[] {
  return planned.map((s, i) => ({
    id: `slide-${i + 1}`,
    index: i,
    role: s.role,
    textMode: s.textMode,
    intent: s.intent,
    headline: "",
    body: "",
    // Stil sözleşmesi her prompt'a HARFİYEN ekleniyor — N görseli tek carousel
    // yapan tek mekanizma bu (t2i modelinde referans görsel alanı yok).
    visualPrompt: `${s.visualPrompt}\n\n${theme.styleContract}`,
  }));
}

/** Mock: claude CLI'ye hiç gitmeden hattın şeklini bedavaya doğrulayabilmek için. */
function mockPlan(topic: string): { theme: VisualTheme; slides: PlannedSlide[] } {
  return {
    theme: {
      palette: "[MOCK] #1f2937 / #f4f4f5 / #f59e0b",
      lighting: "[MOCK] yumuşak tek kaynak",
      shotStyle: "[MOCK] orta plan, sığ alan derinliği",
      typography: "[MOCK] kalın sans-serif başlık",
      styleContract: `[MOCK] stil sözleşmesi — "${topic}" için tutarlı görsel dil.`,
    },
    slides: [
      { role: "hook", textMode: "baked", visualPrompt: `[MOCK] ${topic} açılış karesi`, intent: "Dikkat çek" },
      { role: "body", textMode: "overlay", visualPrompt: `[MOCK] ${topic} detay`, intent: "Sorunu göster" },
      { role: "body", textMode: "overlay", visualPrompt: `[MOCK] ${topic} çözüm`, intent: "Çözümü anlat" },
      { role: "cta", textMode: "baked", visualPrompt: `[MOCK] ${topic} kapanış`, intent: "Harekete geçir" },
    ],
  };
}

export async function runCarouselPlanner(state: RunState): Promise<AgentResult> {
  const payload = carouselPayload(state);
  const preset = channelPreset(state.platform);

  if (isMock("script")) {
    const { theme, slides: planned } = mockPlan(state.topic);
    return {
      patch: { payload: { ...payload, theme, slides: toSlides(planned, theme) } },
      note: `[MOCK] Tema ve ${planned.length} slide planlandı (claude CLI çağrılmadı).`,
    };
  }

  const { theme, extra, cost } = await runPlannerCore<{ slides: PlannedSlide[] }>(
    state,
    {
      taskSection: taskSection(preset, carouselAspect(state).id, state.brief),
      schemaProperties: {
        slides: slidePlanSchema(preset.minSlides, preset.maxSlides),
      },
      schemaRequired: ["slides"],
    },
  );

  const slides = toSlides(extra.slides, theme);
  const bakedCount = slides.filter((s) => s.textMode === "baked").length;

  return {
    patch: {
      payload: { ...payload, theme, slides },
    },
    note:
      `${preset.label} için tema kuruldu ve ${slides.length} slide planlandı ` +
      `(${bakedCount} baked, ${slides.length - bakedCount} overlay).`,
    cost,
  };
}
