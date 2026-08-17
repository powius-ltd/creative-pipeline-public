import fs from "node:fs/promises";
import path from "node:path";
import { runClaude } from "../../agents/claude-cli";
import { languageSpec } from "../../config/language";
import { isMock } from "../../config/mock";
import { readBrandMemory } from "../../brand-memory/store";
import { projectDir } from "../../orchestrator/paths";
import { OperatorRequiredError } from "../../orchestrator/operatorError";
import { getDescriptor } from "../descriptors";
import { channelPreset, channelVoiceNote } from "./channels";
import type { AgentResult, KreatifBrief, RunState, VariantIdea } from "../../orchestrator/types";

/**
 * KONSEPT AŞAMASI — Stratejist × Kreatif Muhalif.
 *
 * Pipeline'ın önüne çekilen karar katmanı: tema/hook/açı artık planner'ın kendi
 * sezgisiyle değil, burada üretilen KreatifBrief'e göre kurulur. Planner ve
 * copywriter bu aşamadan SONRA çalışır ve brief varsa onu UYGULAR (bkz. planner.ts,
 * copy.ts) — karar verici değil uygulayıcı olurlar. Tasarım kaynağı:
 * powius-pazarlama/KREATIF-DIREKTORLUK-ARGE.md §6, strateji-referansi.md.
 *
 * İKİ AYRI ÇAĞRI bilinçli: Stratejist ve Muhalif aynı çağrıya konursa model kendi
 * kendine nazik bir sentez yapar, muhalefet ölür (arge dokümanı §6.2, "Ayrı kalmak
 * zorunda olan tek çift").
 */

const ANAYASA_FILES = [
  "00-urun-gercegi.md",
  "01-deger-matrisi.md",
  "02-segment-funnel.md",
  "03-angle-matrix.md",
  "04-ses-tonu.md",
];

async function readAnayasa(slug: string): Promise<string> {
  const dir = path.join(projectDir(slug), "anayasa");
  let exists = true;
  try {
    await fs.access(dir);
  } catch {
    exists = false;
  }
  if (!exists) {
    throw new OperatorRequiredError(
      `Konsept aşaması için '${slug}' markasının anayasası eksik (projects/${slug}/anayasa/).\n` +
        `Bir Claude Code operatörü powius-pazarlama/KREATIF-DIREKTORLUK-ARGE.md §2 ve ` +
        `strateji-referansi.md'yi kullanarak anayasa dosyalarını kurmalı, sonra bu run'ı ` +
        `yeniden dene.`,
    );
  }

  const parts: string[] = [];
  for (const file of ANAYASA_FILES) {
    const p = path.join(dir, file);
    try {
      parts.push(`### ${file}\n${await fs.readFile(p, "utf-8")}`);
    } catch {
      // Dosya yoksa atla — kısmi anayasa da işe yarar, tam eksiklik yukarıda yakalandı.
    }
  }

  const angleDir = path.join(dir, "angle");
  try {
    const angleFiles = await fs.readdir(angleDir);
    for (const file of angleFiles.filter((f) => f.endsWith(".md"))) {
      parts.push(
        `### angle/${file}\n${await fs.readFile(path.join(angleDir, file), "utf-8")}`,
      );
    }
  } catch {
    // angle/ klasörü yoksa atla.
  }

  return parts.join("\n\n---\n\n");
}

const STRATEJIST_SCHEMA = {
  type: "object",
  properties: {
    funnelKatmani: { type: "integer", enum: [1, 2, 3, 4, 5] },
    segment: { type: "string", description: "Anayasadaki segment id'lerinden biri." },
    aci: { type: "string", enum: ["sonuc-kazanim", "aci-korku", "kimlik", "sosyal-kanit"] },
    degerBileseni: {
      type: "string",
      enum: [
        "islevsel", "duygusal", "statu", "guven",
        "parasal", "zaman-caba", "psikolojik-risk", "sosyal-risk",
      ],
    },
    cerceve: { type: "string", enum: ["olumlu", "ters"] },
    icerikTipi: {
      type: "string",
      enum: ["donusum", "kurgu", "how-to", "lifestyle", "podcast", "ugc"],
    },
    hookAmaci: { type: "string", enum: ["beklendik", "soru-ac"] },
    anatomikKanal: { type: "string", enum: ["gorsel", "yazi", "isitsel"] },
    tetikleyici: {
      type: "string",
      enum: ["merak", "zaman-tasarrufu", "para-tasarrufu", "sosyal-kanit", "otorite"],
    },
    hucreGerekcesi: { type: "string", description: "Bu hücreyi neden seçtin — kısa gerekçe." },
    copyYonu: { type: "string", description: "Ton, CTA hedefi, kanıt noktaları." },
    temaYonu: { type: "string", description: "Görsel dünya, duygu, referanslar." },
    yasaklar: { type: "array", items: { type: "string" } },
    variants: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          hook: { type: "string" },
          cta: { type: "string" },
        },
        required: ["label", "hook", "cta"],
        additionalProperties: false,
      },
      description:
        "3-5 hook önerisi, ilki en güçlü bulduğun. Hook Mimarisi algoritmasını " +
        "(strateji-referansi.md §6.7) uygula, her öneri için 3 saniye testini kendi " +
        "kendine sor.",
    },
  },
  required: [
    "funnelKatmani", "segment", "aci", "degerBileseni", "cerceve", "icerikTipi",
    "hookAmaci", "anatomikKanal", "tetikleyici", "hucreGerekcesi", "copyYonu",
    "temaYonu", "yasaklar", "variants",
  ],
  additionalProperties: false,
};

interface StrategistOutput {
  funnelKatmani: 1 | 2 | 3 | 4 | 5;
  segment: string;
  aci: KreatifBrief["aci"];
  degerBileseni: KreatifBrief["degerBileseni"];
  cerceve: KreatifBrief["cerceve"];
  icerikTipi: KreatifBrief["icerikTipi"];
  hookAmaci: KreatifBrief["hookAmaci"];
  anatomikKanal: KreatifBrief["anatomikKanal"];
  tetikleyici: KreatifBrief["tetikleyici"];
  hucreGerekcesi: string;
  copyYonu: string;
  temaYonu: string;
  yasaklar: string[];
  variants: { label: string; hook: string; cta: string }[];
}

const MUHALIF_SCHEMA = {
  type: "object",
  properties: {
    itiraz: {
      type: "string",
      description:
        "Bu konseptin 'kategori duvar kağıdı' olma riski nerede? Beklenti nerede " +
        "kırılabilir? Stratejistin doğru ama sıkıcı olduğu yer neresi?",
    },
    karsiHookOnerisi: {
      type: "string",
      description: "Alternatif bir hook önerisi — Stratejistin listesinde olmayan bir açı.",
    },
    katiliyorMu: {
      type: "boolean",
      description: "Konsept gerçekten güçlüyse itiraz yerine onay da verebilirsin.",
    },
  },
  required: ["itiraz", "karsiHookOnerisi", "katiliyorMu"],
  additionalProperties: false,
};

interface MuhalifOutput {
  itiraz: string;
  karsiHookOnerisi: string;
  katiliyorMu: boolean;
}

function mockBrief(topic: string): { brief: KreatifBrief; variants: VariantIdea[] } {
  const variants: VariantIdea[] = [
    { id: "variant-1", label: "[MOCK] Acı/korku", hook: `${topic} — bunu kaçırıyor olabilirsin`, cta: "Şimdi dene" },
    { id: "variant-2", label: "[MOCK] Sonuç", hook: `${topic} ile saniyeler içinde sonuç`, cta: "Ücretsiz dene" },
    { id: "variant-3", label: "[MOCK] Kimlik", hook: `${topic} kullanan biri sensin`, cta: "Katıl" },
  ];
  const brief: KreatifBrief = {
    funnelKatmani: 2,
    segment: "mod-shop",
    aci: "aci-korku",
    degerBileseni: "psikolojik-risk",
    cerceve: "ters",
    icerikTipi: "ugc",
    hookAmaci: "soru-ac",
    anatomikKanal: "gorsel",
    tetikleyici: "merak",
    hucreGerekcesi: "[MOCK] öncelikli hücre — anayasa gerçek çağrıda okunur.",
    copyYonu: "[MOCK] doğrudan, klişesiz.",
    temaYonu: "[MOCK] koyu zemin, tek vurgu rengi.",
    yasaklar: ["[MOCK] rakip adı anma"],
    muhalifNotu: "[MOCK] Muhalif itirazı — gerçek çağrıda claude CLI çalışır.",
    secilenHook: variants[0].hook,
    ucSaniyeTesti: "belirsiz",
  };
  return { brief, variants };
}

export async function runKonsept(state: RunState): Promise<AgentResult> {
  if (isMock("konsept")) {
    const { brief, variants } = mockBrief(state.topic);
    return {
      patch: { brief, variants, chosenVariantId: variants[0].id },
      note: `[MOCK] Konsept: ${brief.segment} × ${brief.aci} (claude CLI çağrılmadı).`,
    };
  }

  const anayasa = await readAnayasa(state.projectSlug);
  const memory = await readBrandMemory(state.projectSlug);
  // Bu ajan MODDAN BAĞIMSIZ (carousel ve real-video ortak kullanıyor), ama
  // ürettiği `copyYonu` mecraya göre yazılmak zorunda: "1. slayt" talimatı bir
  // videoda anlamsız. Teslimatın ne olduğunu söylemezsek model carousel varsayıyor.
  const descriptor = getDescriptor(state.mode);
  const voiceNote = channelVoiceNote(state.platform, state.mode);

  const reservedSection =
    memory.reservedVariants.length > 0
      ? `Daha önce üretilip kullanılmamış rezerv hook'lar (Faz 8 ölçekleme — önce bunları düşün):\n` +
        memory.reservedVariants
          .slice(-8)
          .map((v) => `  - [${v.label}] "${v.hook}" / CTA: ${v.cta}`)
          .join("\n")
      : "";

  const stratejistPrompt = [
    "Bir markanın kreatif STRATEJİSTİsin. Aşağıdaki anayasayı (değer matrisi, angle",
    "matrix, segment×funnel, ses tonu, angle kütüphanesi) oku ve bu konu için bir",
    "konsept kur: hangi hücre (segment×açı), hangi değer bileşeni, hangi hook",
    "mimarisi (içerik tipi/amaç/kanal/tetikleyici), ve 3-5 hook önerisi.",
    "",
    `Konu: ${state.topic}`,
    state.notes ? `Ek notlar: ${state.notes}` : "",
    `Kanal: ${channelPreset(state.platform).label} — ${voiceNote}`,
    `TESLİMAT: ${descriptor.label}. ${descriptor.description}`,
    "`copyYonu` ve `temaYonu` alanlarını BU TESLİMAT BİÇİMİNE göre yaz — başka bir",
    "formatın (slayt/carousel/video) diliyle değil.",
    "",
    "=== ANAYASA ===",
    anayasa,
    "=== /ANAYASA ===",
    "",
    reservedSection,
    "",
    "Hook Mimarisi algoritmasını (strateji-referansi.md §6.7) uygula: funnel katmanını",
    "belirle, açıyı seç, içerik tipini seç, amacı belirle, anatomik kanalı seç,",
    "tetikleyiciyi yaz. Her öneri için kendi kendine 3 saniye testini sor.",
    // `variants[].hook` ve `.cta` doğrudan izleyiciye giden copy; gerekçe/yön
    // alanları operatöre gidiyor. Ayrımı languageSpec anlatıyor.
    languageSpec(state.language).writeInstruction,
  ]
    .filter(Boolean)
    .join("\n");

  const { data: strategy, cost: cost1 } = await runClaude<StrategistOutput>(
    { prompt: stratejistPrompt, schema: STRATEJIST_SCHEMA, model: "sonnet", maxBudgetUsd: 1 },
    "stratejist",
  );

  const muhalifPrompt = [
    "Sen bir KREATİF MUHALİFSİN — Bernbach/Hegarty damarının vekili. Tek işin:",
    "stratejistin konseptine itiraz etmek. Doğru ama sıkıcı olan yeri bul: bu konsept",
    "'kategori duvar kağıdı' olur mu? Beklenti nerede kırılabilir? Gerçekten güçlüyse",
    "itiraz etmek yerine katılabilirsin — ama önce zorla.",
    "",
    `Konu: ${state.topic}`,
    "",
    "Stratejistin konsepti:",
    `  Hücre: ${strategy.segment} × ${strategy.aci}`,
    `  Gerekçe: ${strategy.hucreGerekcesi}`,
    `  İçerik tipi: ${strategy.icerikTipi} · amaç: ${strategy.hookAmaci} · tetikleyici: ${strategy.tetikleyici}`,
    "  Hook önerileri:",
    ...strategy.variants.map((v, i) => `    ${i + 1}. [${v.label}] "${v.hook}"`),
  ].join("\n");

  const { data: muhalif, cost: cost2 } = await runClaude<MuhalifOutput>(
    { prompt: muhalifPrompt, schema: MUHALIF_SCHEMA, model: "sonnet", maxBudgetUsd: 1 },
    "kreatif muhalif",
  );

  const variants: VariantIdea[] = strategy.variants.map((v, i) => ({
    id: `variant-${i + 1}`,
    label: v.label,
    hook: v.hook,
    cta: v.cta,
  }));

  const brief: KreatifBrief = {
    funnelKatmani: strategy.funnelKatmani,
    segment: strategy.segment,
    aci: strategy.aci,
    degerBileseni: strategy.degerBileseni,
    cerceve: strategy.cerceve,
    icerikTipi: strategy.icerikTipi,
    hookAmaci: strategy.hookAmaci,
    anatomikKanal: strategy.anatomikKanal,
    tetikleyici: strategy.tetikleyici,
    hucreGerekcesi: strategy.hucreGerekcesi,
    copyYonu: strategy.copyYonu,
    temaYonu: strategy.temaYonu,
    yasaklar: strategy.yasaklar,
    muhalifNotu: muhalif.katiliyorMu
      ? `Muhalif katılıyor: ${muhalif.itiraz}`
      : `İtiraz: ${muhalif.itiraz}\nKarşı hook önerisi: "${muhalif.karsiHookOnerisi}"`,
    // İlk varyant Stratejistin en güçlü bulduğu öneri — insan Kapı A'da değiştirebilir
    // (bkz. RunView "Konsept" paneli). Reject/kural mekanizması build planı takip işi.
    secilenHook: variants[0]?.hook ?? "",
    ucSaniyeTesti: "belirsiz",
  };

  return {
    patch: { brief, variants, chosenVariantId: variants[0]?.id ?? null },
    note:
      `Konsept: ${brief.segment} × ${brief.aci} (${brief.icerikTipi}/${brief.hookAmaci}). ` +
      `Muhalif ${muhalif.katiliyorMu ? "katıldı" : "itiraz etti"}.`,
    cost: {
      vendor: "claude",
      detail: "stratejist + muhalif",
      costUsd: (cost1.costUsd ?? 0) + (cost2.costUsd ?? 0),
      claudeInputTokens: (cost1.claudeInputTokens ?? 0) + (cost2.claudeInputTokens ?? 0),
      claudeOutputTokens: (cost1.claudeOutputTokens ?? 0) + (cost2.claudeOutputTokens ?? 0),
    },
  };
}
