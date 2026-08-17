import { runPlannerCore } from "../../agents/planner/core";
import { isMock } from "../../config/mock";
import type { AgentResult, RealScene, RealSceneRole, RunState } from "../../orchestrator/types";
import { realVideoPayload } from "../../orchestrator/types";
import { channelPreset, channelVoiceNote } from "../carousel/channels";
import { runAspect } from "../descriptors";
import { footageSource } from "./footage";
import { runVideoFormat } from "./format";

/**
 * SANAT YÖNETMENİ — sahne yayını ve görsel temayı kurar.
 *
 * Carousel'den tek farkı `styleContract`'ın işlevi: orada her görsel prompt'una
 * eklenen bir ÜRETİM talimatıydı, burada bir MATERYAL SEÇİM brief'i. Gerçek
 * footage üretilmiyor, seçiliyor — sözleşme "hangi çekim bu seriye ait" sorusunu
 * yanıtlıyor. Mekanizma aynı kalıyor: N klibi tek video yapan şey bu.
 */

const ROLES: RealSceneRole[] = ["hook", "problem", "cozum", "kanit", "cta"];

function sceneSchema(min: number, max: number) {
  return {
    type: "array",
    minItems: min,
    maxItems: max,
    items: {
      type: "object",
      properties: {
        role: { type: "string", enum: ROLES },
        intent: {
          type: "string",
          description: "Bu sahnenin anlatıdaki işi — tek cümle, copywriter bunu okuyacak.",
        },
        shotIdea: {
          type: "string",
          description:
            "ARANACAK çekimin tarifi (üretilecek değil): kim/ne, hangi kadraj, " +
            "hangi hareket. Operatör bu tarifle kendi arşivinden klip seçecek.",
        },
        durationSec: {
          type: "number",
          description: "Tahmini süre, 1.5-6 saniye. Gerçek süre seslendirmeden gelir.",
        },
      },
      required: ["role", "intent", "shotIdea", "durationSec"],
      additionalProperties: false,
    },
  };
}

function buildMockScenes(topic: string, count: number): RealScene[] {
  const beats: { role: RealSceneRole; intent: string }[] = [
    { role: "hook", intent: "Dikkat çeken açılış" },
    { role: "problem", intent: "İzleyicinin sorununu göster" },
    { role: "cozum", intent: "Çözümü devreye sok" },
    { role: "kanit", intent: "Kanıt/sonuç göster" },
    { role: "cta", intent: "Harekete geçir" },
  ];
  return beats.slice(0, count).map((b, i) => ({
    id: `scene-${i + 1}`,
    index: i,
    role: b.role,
    intent: `[MOCK] ${b.intent}`,
    shotIdea: `[MOCK] ${topic} — ${b.intent.toLowerCase()}, dikey çekim`,
    durationSec: b.role === "cta" ? 2.5 : 3.5,
    voiceLine: "",
    onScreenText: "",
  }));
}

export async function runRealVideoPlanner(state: RunState): Promise<AgentResult> {
  const payload = realVideoPayload(state);
  // preset: caption/hashtag/kanal sesi gibi ORTAK alanlar için.
  // format : video'ya özel boyut, fps ve süre bandı için.
  const preset = channelPreset(state.platform);
  const format = runVideoFormat(state);
  // Sahne tarifinin ANLAMI kaynağa göre değişiyor — bkz. aşağıdaki taskSection.
  const generating = footageSource() === "generate";

  if (isMock("script")) {
    const scenes = buildMockScenes(state.topic, 4);
    return {
      patch: { payload: { ...payload, scenes } },
      note: `[MOCK] ${scenes.length} sahnelik yay kuruldu (gerçek sanat yönetmeni değil).`,
    };
  }

  const briefSection = state.brief
    ? [
        "",
        "KONSEPT (stratejistin kararı — buna uy):",
        `  içerik tipi: ${state.brief.icerikTipi}`,
        `  acı: ${state.brief.aci} · tetikleyici: ${state.brief.tetikleyici}`,
        `  çerçeve: ${state.brief.cerceve} · hook amacı: ${state.brief.hookAmaci}`,
        `  tema yönü: ${state.brief.temaYonu}`,
        `  seçilen hook: ${state.brief.secilenHook}`,
        state.brief.yasaklar.length > 0
          ? `  YASAKLAR: ${state.brief.yasaklar.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const { theme, extra, cost } = await runPlannerCore<{
    scenes: {
      role: RealSceneRole;
      intent: string;
      shotIdea: string;
      durationSec: number;
    }[];
  }>(state, {
    taskSection: [
      "GÖREV 2 — Sahne yayını kur:",
      // Oran carousel presetinden DEĞİL run'ın kendi seçtiği orandan geliyor —
      // sabit "9:16" yazılsaydı kullanıcı 4:5/1:1 seçtiğinde prompt yalan söylerdi.
      // Kanal sesi de videoya özel olanı: `preset.voiceNote` carousel'i tarif
      // ediyor ve buraya girerse planner slayt mantığıyla sahne kuruyor.
      `Kanal: ${preset.label} (${runAspect(state)}, ${format.width}×${format.height}). ` +
        channelVoiceNote(state.platform, state.mode),
      `Toplam süre ${format.minSec}-${format.maxSec} saniye arasında kalmalı — dikey kısa video.`,
      `3-6 sahne. Her sahne için rol, niyet, ${generating ? "ÜRETİLECEK ÇEKİM prompt'u" : "ARANACAK ÇEKİM tarifi"} ve tahmini süre yaz.`,
      "",
      // `shotIdea`nın ne olduğu materyal kaynağına göre DEĞİŞİYOR ve ikisi
      // birbirinin zıddı: arama tarifi erişilebilirlikle sınırlı ("telefon
      // arşivinde bulunabilecek"), üretim prompt'u ise tam tersine sahneyi
      // eksiksiz tarif etmek zorunda. Tek metin ikisine birden hizmet edemez —
      // arama diliyle üretim yapılırsa model eksik tarifle jenerik klip üretir.
      ...(generating
        ? [
            "ÖNEMLİ: bu run'da materyal AI ile ÜRETİLECEK (FOOTAGE_SOURCE=generate).",
            "Bu yüzden 'shotIdea' bir arama tarifi değil, bir ÜRETİM PROMPT'U olmalı:",
            "özne, kadraj, ışık, hareket ve doku eksiksiz yazılsın — modelin tahmin",
            "etmesi gereken bir şey kalmasın. Metin/yazı içeren kare İSTEME (yazıyı",
            "hat kendisi basıyor) ve tanınabilir gerçek kişi tarif etme.",
          ]
        : [
            "ÖNEMLİ: bu modda görsel ÜRETİLMİYOR, gerçek çekim/foto materyal SEÇİLİYOR.",
            "Bu yüzden 'shotIdea' bir üretim prompt'u değil, bir arama tarifi olmalı:",
            "operatör kendi arşivinde bu tarifle klip arayacak. Erişilemez şeyler istemeyin",
            "(drone, stüdyo, kalabalık) — sıradan bir telefon arşivinde bulunabilecek",
            "çekimler tarif et.",
          ]),
      "",
      generating
        ? "'styleContract' her üretim prompt'una EKLENECEK: tüm sahneleri tek görsel dilde tutan cümle."
        : "'styleContract' burada MATERYAL SEÇİM ÖLÇÜTÜ olarak da okunacak: hangi çekimin bu seriye ait olduğunu belirleyen görsel dil.",
      briefSection,
    ]
      .filter(Boolean)
      .join("\n"),
    schemaProperties: { scenes: sceneSchema(3, 6) },
    schemaRequired: ["scenes"],
  });

  const scenes: RealScene[] = extra.scenes.map((s, i) => ({
    id: `scene-${i + 1}`,
    index: i,
    role: s.role,
    intent: s.intent,
    // Stil sözleşmesi HARFİYEN ekleniyor — carousel'deki planner.ts:105-108 ile
    // aynı mekanizma. Operatör materyal seçerken bunu ölçüt olarak görecek.
    shotIdea: `${s.shotIdea}\n\n${theme.styleContract}`,
    durationSec: s.durationSec,
    voiceLine: "",
    onScreenText: "",
  }));

  const total = scenes.reduce((a, s) => a + s.durationSec, 0);

  return {
    patch: { payload: { ...payload, theme, scenes } },
    note: `${scenes.length} sahnelik yay kuruldu (~${total.toFixed(1)}sn), tema ve stil sözleşmesi yazıldı.`,
    cost,
  };
}
