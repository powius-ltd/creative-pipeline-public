import { readBrandMemory } from "../../brand-memory/store";
import { runClaude } from "../claude-cli";
import type { ActualCostReport, RunState, VisualTheme } from "../../orchestrator/types";

/**
 * Sanat yönetmeni ajanının ORTAK ÇEKİRDEĞİ.
 *
 * Marka teması (palet/ışık/çekim stili/tipografi + stil sözleşmesi) her modda aynı
 * şekilde üretilir; anlatı yapısı (carousel'de slide sayısı ve rolleri, video modunda
 * sahne sayısı ve süreleri) moda özeldir ve eklenti olarak gelir.
 *
 * Tema ve yapı TEK CLI çağrısında üretilir — ikiye bölmek hem maliyeti hem gecikmeyi
 * ikiye katlardı, ayrıca yapının temadan habersiz kurulmasına yol açardı.
 */

const THEME_SCHEMA = {
  type: "object",
  properties: {
    palette: {
      type: "string",
      description: "3-5 renk, hex kodlarıyla ve kısa gerekçesiyle",
    },
    lighting: { type: "string", description: "Işık kurulumu ve atmosferi" },
    shotStyle: {
      type: "string",
      description: "Çekim/kadraj stili, lens hissi, derinlik",
    },
    typography: {
      type: "string",
      description: "Tipografi yönü: ağırlık, kontrast, yerleşim mantığı",
    },
    styleContract: {
      type: "string",
      description:
        "Her görsel prompt'una harfiyen eklenecek, kendi başına anlamlı tek paragraflık " +
        "stil bloğu. Konuya değil YALNIZCA görsel dile dair olmalı.",
    },
  },
  required: ["palette", "lighting", "shotStyle", "typography", "styleContract"],
  additionalProperties: false,
};

export interface PlannerPlugin {
  /** Moda özel görev tarifi — çekirdek görevin altına eklenir. */
  taskSection: string;
  /** Moda özel şema alanları (tema alanının yanına konur). */
  schemaProperties: Record<string, unknown>;
  schemaRequired: string[];
  /**
   * "Ton: gerçekçi. Sci-fi veya CGI değil." satırının üzerine YAZAR — ai-video
   * modunun absürt konsepti (aynı kadın ay'da, sonra denizin altında) bu sabit
   * satırla doğrudan çelişiyordu. Belirtilmezse çekirdek varsayılana (gerçekçi)
   * düşer, yani carousel/real-video davranışı değişmez.
   */
  toneLine?: string;
}

export async function runPlannerCore<TExtra>(
  state: RunState,
  plugin: PlannerPlugin,
): Promise<{ theme: VisualTheme; extra: TExtra; cost: ActualCostReport }> {
  const memory = await readBrandMemory(state.projectSlug);

  const toneSection = memory.tone
    ? `Markanın yerleşik tonu: ${memory.tone}`
    : "Markanın yerleşik bir tonu henüz kayıtlı değil — konuya uygun bir ton kur.";

  const historySection =
    memory.history.length > 0
      ? `Bu markada daha önce üretilenlerden notlar:\n` +
        memory.history
          .slice(-5)
          .map((h) => `  - ${h.note}`)
          .join("\n")
      : "";

  const prompt = [
    "Bir markanın kısa-form içeriği için SANAT YÖNETMENİsin.",
    "",
    `Konu: ${state.topic}`,
    state.notes ? `Ek notlar: ${state.notes}` : "",
    toneSection,
    historySection,
    "",
    "GÖREV 1 — Görsel tema kur:",
    "Palet, ışık, çekim stili ve tipografi yönünü belirle. Ardından bunları tek bir",
    "paragrafta 'styleContract' olarak topla. Bu sözleşme her görsel prompt'una",
    "harfiyen eklenecek ve tüm görselleri tek bir seri gibi gösterecek tek mekanizma —",
    "konudan bağımsız, yalnızca görsel dili tarif etmeli.",
    plugin.toneLine ?? "Ton: gerçekçi. Sci-fi veya CGI değil.",
    "",
    plugin.taskSection,
  ]
    .filter(Boolean)
    .join("\n");

  const schema = {
    type: "object",
    properties: { theme: THEME_SCHEMA, ...plugin.schemaProperties },
    required: ["theme", ...plugin.schemaRequired],
    additionalProperties: false,
  };

  const { data, cost } = await runClaude<{ theme: VisualTheme } & TExtra>(
    { prompt, schema, model: "sonnet", maxBudgetUsd: 1 },
    "sanat yönetmeni",
  );

  const { theme, ...extra } = data;
  return { theme, extra: extra as unknown as TExtra, cost };
}
