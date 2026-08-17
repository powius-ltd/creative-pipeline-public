import { runClaude } from "../claude-cli";
import { languageSpec } from "../../config/language";
import { isMock } from "../../config/mock";
import { channelPreset, channelVoiceNote } from "../../modes/carousel/channels";
import type {
  ActualCostReport,
  RealSceneRole,
  RunState,
  VariantIdea,
} from "../../orchestrator/types";

/**
 * COPYWRITER ÇEKİRDEĞİ — seslendirme metni + ekran metni + caption.
 *
 * real-video ve ai-video PAYLAŞIYOR: ikisinin de "sahne" kavramı aynı şekle
 * sahip (id/role/intent/shotIdea/durationSec) ve copywriter'ın işi ikisinde de
 * birebir aynı — hangi sahnenin nasıl üretileceği (arama mı, üretim mi) bu
 * aşamayı ilgilendirmiyor, yalnızca NE SÖYLENECEĞİ ilgilendiriyor.
 *
 * Planner'dan AYRI bir aşama olması bilinçli, carousel'deki gerekçenin aynısı
 * (`carousel/copy.ts`): burada bir onay kapısı var. Bu aşamadan sonra
 * ElevenLabs karakter başına para almaya başlıyor (ve ai-video'da video
 * üretimi de bu metnin süresine göre kurulacak) — metin yanlışsa boşa gider.
 */

export interface CopySceneBase {
  id: string;
  role: RealSceneRole;
  intent: string;
  shotIdea: string;
  durationSec: number;
  voiceLine: string;
  onScreenText: string;
}

export interface CopyCoreResult<TScene> {
  scenes: TScene[];
  caption: string;
  hashtags: string[];
  variants: VariantIdea[];
  missingVoiceLineIds: string[];
  cost?: ActualCostReport;
  mocked: boolean;
}

function buildSchema(sceneIds: string[], captionMax: number, tagMin: number, tagMax: number) {
  return {
    type: "object",
    properties: {
      scenes: {
        type: "array",
        // Sahne sayısı SABİTLENİYOR: modelin sahne eklemesi/çıkarması planner'ın
        // kararını sessizce bozardı.
        minItems: sceneIds.length,
        maxItems: sceneIds.length,
        items: {
          type: "object",
          properties: {
            id: { type: "string", enum: sceneIds },
            voiceLine: {
              type: "string",
              description:
                "Seslendirilecek metin. Konuşma dili, kısa cümleler. " +
                "Kısaltma/sayı yazımı SESLİ OKUNACAK şekilde (örn '3' değil 'üç').",
            },
            onScreenText: {
              type: "string",
              description:
                "Ekranda yazacak KISA metin (en fazla 5 kelime) — söylenenin tekrarı " +
                "DEĞİL, onu güçlendiren şey. Gerek yoksa boş string.",
            },
          },
          required: ["id", "voiceLine", "onScreenText"],
          additionalProperties: false,
        },
      },
      caption: { type: "string", description: `Gönderi metni, en fazla ${captionMax} karakter` },
      hashtags: {
        type: "array",
        minItems: tagMin,
        maxItems: tagMax,
        items: { type: "string", description: "# İŞARETİ OLMADAN" },
      },
      variants: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            hook: { type: "string" },
            cta: { type: "string" },
          },
          required: ["id", "label", "hook", "cta"],
          additionalProperties: false,
        },
      },
    },
    required: ["scenes", "caption", "hashtags", "variants"],
    additionalProperties: false,
  };
}

export async function runCopyCore<TScene extends CopySceneBase>(
  state: RunState,
  scenes: TScene[],
): Promise<CopyCoreResult<TScene>> {
  if (scenes.length === 0) {
    throw new Error("Copywriter sahnesiz çalışamaz — 'plan' aşaması önce koşmalı.");
  }

  if (isMock("script")) {
    const written = scenes.map((s) => ({
      ...s,
      voiceLine: `[MOCK] ${s.intent} — "${state.topic}" için örnek replik.`,
      onScreenText: s.role === "hook" ? "[MOCK] kanca" : "",
    }));
    return {
      scenes: written,
      caption: `[MOCK] ${state.topic} için caption.`,
      hashtags: ["mock", "ornek"],
      variants: [],
      missingVoiceLineIds: [],
      mocked: true,
    };
  }

  const preset = channelPreset(state.platform);
  const lang = languageSpec(state.language);
  const sceneIds = scenes.map((s) => s.id);

  const sceneLines = scenes
    .map(
      (s) =>
        `  ${s.id} [${s.role}] ~${s.durationSec}sn — niyet: ${s.intent}\n` +
        `      aranan çekim: ${s.shotIdea.split("\n")[0]}`,
    )
    .join("\n");

  const briefSection = state.brief
    ? [
        "",
        "KONSEPT (buna uy):",
        `  copy yönü: ${state.brief.copyYonu}`,
        `  seçilen hook: ${state.brief.secilenHook}`,
        `  acı: ${state.brief.aci} · tetikleyici: ${state.brief.tetikleyici}`,
        state.brief.yasaklar.length > 0
          ? `  YASAKLAR: ${state.brief.yasaklar.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const prompt = [
    "Dikey kısa video için COPYWRITER'sın. Metin SESLENDİRİLECEK, okunmayacak.",
    "",
    `Konu: ${state.topic}`,
    state.notes ? `Ek notlar: ${state.notes}` : "",
    `Kanal: ${preset.label}. ${channelVoiceNote(state.platform, state.mode)}`,
    briefSection,
    "",
    "Sahneler:",
    sceneLines,
    "",
    "KURALLAR:",
    // Hız dile bağlı: aynı sahneye İngilizce ile Türkçe'den farklı sayıda
    // karakter sığıyor. Sabit 14 bırakılsaydı İngilizce metin sistematik olarak
    // kısa yazılır, sahne sessizlikle dolardı.
    `- Her sahnenin süresi belli: ~${lang.charsPerSecond} karakter/saniye hızında konuşulur.`,
    `  Yani 3.5 saniyelik sahne için ~${Math.round(3.5 * lang.charsPerSecond)} karakter. ` +
      "Bu sınırı AŞMA, sahne kesilir.",
    "- İlk sahne 3 saniyede dikkat çekmek zorunda; genel giriş cümlesi yazma.",
    "- Sayılar ve kısaltmalar SESLİ okunacak şekilde yazılsın ('%20' değil 'yüzde yirmi').",
    "- onScreenText söylenenin TEKRARI olmasın; gereksizse boş bırak.",
    "- Sonda net bir CTA olsun.",
    "",
    lang.writeInstruction,
  ]
    .filter(Boolean)
    .join("\n");

  const { data, cost } = await runClaude<{
    scenes: { id: string; voiceLine: string; onScreenText: string }[];
    caption: string;
    hashtags: string[];
    variants: VariantIdea[];
  }>(
    {
      prompt,
      schema: buildSchema(sceneIds, preset.captionMaxChars, preset.hashtagMin, preset.hashtagMax),
      model: "sonnet",
      maxBudgetUsd: 1,
    },
    "copywriter",
  );

  const byId = new Map(data.scenes.map((s) => [s.id, s]));
  const written = scenes.map((s) => {
    const w = byId.get(s.id);
    return { ...s, voiceLine: w?.voiceLine ?? "", onScreenText: w?.onScreenText ?? "" };
  });

  return {
    scenes: written,
    caption: data.caption,
    hashtags: data.hashtags,
    variants: data.variants,
    missingVoiceLineIds: written.filter((s) => !s.voiceLine).map((s) => s.id),
    cost,
    mocked: false,
  };
}
