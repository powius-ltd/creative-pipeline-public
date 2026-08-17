import { runClaude } from "../../agents/claude-cli";
import { languageSpec } from "../../config/language";
import { isMock } from "../../config/mock";
import { channelPreset, type ChannelPreset } from "./channels";
import type { AgentResult, RunState, VariantIdea } from "../../orchestrator/types";
import { carouselPayload } from "../../orchestrator/types";

/**
 * Copywriter, planner'dan AYRI bir aşama — sebebi onay kapısı:
 * metni tema değişmeden yeniden yazdırabilmek, ve asıl önemlisi GÖRSEL PARASI
 * HARCANMADAN ÖNCE durabilmek. Bu hattaki en değerli duraklama noktası burası.
 */

interface CopyResult {
  slides: { id: string; headline: string; body: string }[];
  caption: string;
  hashtags: string[];
  variants: { label: string; hook: string; cta: string }[];
}

function buildSchema(slideIds: string[], preset: ChannelPreset) {
  return {
    type: "object",
    properties: {
      slides: {
        type: "array",
        minItems: slideIds.length,
        maxItems: slideIds.length,
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: slideIds },
            headline: { type: "string" },
            body: { type: "string" },
          },
          required: ["id", "headline", "body"],
          additionalProperties: false,
        },
      },
      caption: {
        type: "string",
        description: `Post açıklaması — en fazla ${preset.captionMaxChars} karakter`,
      },
      hashtags: {
        type: "array",
        items: { type: "string" },
        minItems: preset.hashtagMin,
        maxItems: preset.hashtagMax,
        description: "# işareti OLMADAN, sadece kelimeler",
      },
      variants: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Bu hook yaklaşımının kısa adı" },
            hook: { type: "string" },
            cta: { type: "string" },
          },
          required: ["label", "hook", "cta"],
          additionalProperties: false,
        },
        description:
          "Alternatif açılış yaklaşımları. İlki üretilen carousel'in yaklaşımı olmalı; " +
          "kalanlar rezerve alınıp sonraki run'larda denenecek.",
      },
    },
    required: ["slides", "caption", "hashtags", "variants"],
    additionalProperties: false,
  };
}

export async function runCarouselCopy(state: RunState): Promise<AgentResult> {
  const payload = carouselPayload(state);
  if (payload.slides.length === 0) {
    throw new Error("Copywriter çalışamaz: plan aşaması slide üretmemiş.");
  }
  const preset = channelPreset(state.platform);

  if (isMock("script")) {
    const slides = payload.slides.map((s) => ({
      ...s,
      headline: `[MOCK] ${s.intent}`,
      body: `[MOCK] ${s.role} slide gövde metni — "${state.topic}".`,
    }));
    const variants: VariantIdea[] = [
      { id: "variant-1", label: "[MOCK] Doğrudan", hook: `${state.topic} hakkında...`, cta: "Keşfet" },
      { id: "variant-2", label: "[MOCK] Soru", hook: `${state.topic} için en iyisi bu mu?`, cta: "Bak" },
    ];
    return {
      patch: {
        payload: {
          ...payload,
          slides,
          caption: `[MOCK] "${state.topic}" için caption.`,
          hashtags: ["mock", "test", "carousel"],
        },
        variants,
        chosenVariantId: variants[0].id,
      },
      note: `[MOCK] ${slides.length} slide için metin yazıldı (claude CLI çağrılmadı).`,
    };
  }

  const theme = payload.theme;
  const slideLines = payload.slides
    .map(
      (s) =>
        `  ${s.id} · rol=${s.role} · textMode=${s.textMode}\n` +
        `      işi: ${s.intent}` +
        (s.textMode === "baked"
          ? "\n      DİKKAT: bu metin görselin İÇİNE çizilecek — headline en fazla 6 kelime, " +
            "body en fazla 12 kelime olsun, uzun metin görselde bozuluyor."
          : "\n      Bu metin görselin üstüne programatik bindirilecek — biraz daha uzun olabilir " +
            "(headline ~8 kelime, body ~30 kelime)."),
    )
    .join("\n");

  const brief = state.brief;
  const briefSection = brief
    ? [
        "KONSEPT UYGULA (kendi hook/ton kararını verme, aşağıdakini uygula):",
        `  Seçilen hook (slide-1'in headline'ı bu yaklaşımı taşımalı): "${brief.secilenHook}"`,
        `  Copy yönü: ${brief.copyYonu}`,
        `  Açı: ${brief.aci} (${brief.cerceve} çerçeve) — değer bileşeni: ${brief.degerBileseni}`,
        brief.yasaklar.length ? `  Yasaklar: ${brief.yasaklar.join(", ")}` : "",
        brief.muhalifNotu ? `  Kreatif Muhalif notu (dikkate al): ${brief.muhalifNotu}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const prompt = [
    `Bir markanın ${preset.label} carousel postu için COPYWRITER'sın.`,
    `Kanal karakteri: ${preset.voiceNote}`,
    "",
    `Konu: ${state.topic}`,
    state.notes ? `Ek notlar: ${state.notes}` : "",
    theme
      ? `Sanat yönetmeninin kurduğu tipografi yönü: ${theme.typography}`
      : "",
    briefSection,
    "",
    "Slide'lar ve her birinin anlatıdaki işi:",
    slideLines,
    "",
    "Her slide için headline ve body yaz. Sonra postun caption'ını ve hashtag'lerini üret.",
    `Caption en fazla ${preset.captionMaxChars} karakter, hashtag sayısı ${preset.hashtagMin}-${preset.hashtagMax}.`,
    brief
      ? "Ayrıca alternatif hook yaklaşımları öner — ilki KONSEPT'teki seçilen hook'un " +
        "varyasyonu olsun (aynı açıyı koru, cümleyi iyileştirebilirsin)."
      : "Ayrıca alternatif hook yaklaşımları öner — ilki bu carousel'in kullandığı yaklaşım olsun.",
    languageSpec(state.language).writeInstruction,
  ]
    .filter(Boolean)
    .join("\n");

  const { data, cost } = await runClaude<CopyResult>(
    {
      prompt,
      schema: buildSchema(payload.slides.map((s) => s.id), preset),
      model: "sonnet",
      maxBudgetUsd: 1,
    },
    "copywriter",
  );

  const byId = new Map(data.slides.map((s) => [s.id, s]));
  const slides = payload.slides.map((s) => {
    const written = byId.get(s.id);
    return {
      ...s,
      headline: written?.headline ?? s.headline,
      body: written?.body ?? s.body,
    };
  });

  const variants: VariantIdea[] = data.variants.map((v, i) => ({
    id: `variant-${i + 1}`,
    label: v.label,
    hook: v.hook,
    cta: v.cta,
  }));

  return {
    patch: {
      payload: {
        ...payload,
        slides,
        caption: data.caption,
        hashtags: data.hashtags,
      },
      variants,
      // İlk varyant üretilen carousel'in yaklaşımı; kalanlar completeStage
      // tarafından brand-memory'ye rezerv olarak yazılır.
      chosenVariantId: variants[0]?.id ?? null,
    },
    note: `${slides.length} slide için metin, caption ve ${data.hashtags.length} hashtag yazıldı.`,
    cost,
  };
}
