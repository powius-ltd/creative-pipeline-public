import { runPlannerCore } from "../../agents/planner/core";
import { isMock } from "../../config/mock";
import type {
  AgentResult,
  AiScene,
  CharacterSpec,
  RealSceneRole,
  RunState,
  SceneCamera,
} from "../../orchestrator/types";
import { aiVideoPayload } from "../../orchestrator/types";
import { channelPreset, channelVoiceNote } from "../carousel/channels";
import { runVideoFormat } from "../real-video/format";

/**
 * SANAT YÖNETMENİ (ai-video) — karakter çapası + sahne yayını + görsel tema.
 *
 * real-video'nun planner'ından İKİ noktada ayrışır:
 *   1. `runPlannerCore`'a `toneLine` veriyor — çekirdeğin varsayılan
 *      "Ton: gerçekçi" satırı bu modun tüm amacıyla çelişirdi.
 *   2. `shotIdea` her zaman ÜRETİM prompt'u (real-video'daki gibi kaynağa göre
 *      değişmiyor — bu mod hep üretiyor) VE üç ek karar alanı topluyor:
 *      `environment`/`environmentJump`/`camera`/`speaking`. Bunlar serbest
 *      metinden ÇIKARILAMAZ, kurgu.ts'in KurguPlugin'i bu kapalı sinyallere
 *      bakıyor (bkz. AiScene'in üstündeki tip yorumu).
 */

const ROLES: RealSceneRole[] = ["hook", "problem", "cozum", "kanit", "cta"];

const TONE_LINE =
  "Ton: BİLİNÇLİ OLARAK ABSÜRT VE AÇIKÇA-AI. Karakter aynı kişi kalırken ortam " +
  "mantık dışı biçimde sıçrayabilir (ay yüzeyi, okyanus dibi, bulutların üstü vb.) — " +
  "bunu gizleme, VURGULA. 'Sci-fi/CGI değil' kısıtı burada YOK, tam tersi teşvik ediliyor.";

function characterSchema() {
  return {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Kim bu kişi — yaş, görünüm, giysi, ayırt edici detay. Tek paragraf.",
      },
      anchorPrompt: {
        type: "string",
        description:
          "Çapa görseli için ÜRETİM prompt'u: orta-yakın plan, nötr/düz fon, yüz net, " +
          "düz ışık. Bu görsel tüm sahnelerin referans aldığı TEK kare — ortam burada olmasın.",
      },
      identityContract: {
        type: "string",
        description:
          "Her sahne prompt'una HARFİYEN eklenecek kimlik cümlesi: yüz hatları, saç, " +
          "ten tonu ve giysi referans görseldekiyle birebir aynı kalsın talimatı.",
      },
    },
    required: ["description", "anchorPrompt", "identityContract"],
    additionalProperties: false,
  };
}

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
            "ÜRETİM prompt'u: özne, kadraj, ışık, hareket eksiksiz. Metin/yazı içeren kare " +
            "isteme (hat kendisi basıyor). Karakterin kimliğini burada TEKRARLAMA — " +
            "identityContract zaten ekleniyor, yalnızca SAHNEYE özgü olanı yaz.",
        },
        environment: {
          type: "string",
          description: "Bu sahnenin ortamı — kısa net tanım (ör. 'ay yüzeyi', 'okyanus dibi').",
        },
        environmentJump: {
          type: "boolean",
          description:
            "Bir önceki sahneye göre ortam TAMAMEN değişti mi (kurgu bunu sert kesme sinyali " +
            "olarak okuyacak — ilk sahnede anlamı yok, false bırakılabilir).",
        },
        camera: {
          type: "string",
          enum: ["sabit", "hareketli"],
          description:
            "'sabit': klip zaten kendi hareketini getiriyor, render kamera hareketi EKLEMEMELİ " +
            "(ikisi bindirilirse görüntü yüzer gibi olur). 'hareketli': render kamera nefesi ekleyebilir.",
        },
        speaking: {
          type: "boolean",
          description: "Bu sahnede karakter konuşuyor mu (ağız hareketi/lip-sync gerektirir mi).",
        },
        durationSec: {
          type: "number",
          description: "Tahmini süre, 2-6 saniye (video modelleri kısa klip üretir). Gerçek süre seslendirmeden gelir.",
        },
      },
      required: [
        "role",
        "intent",
        "shotIdea",
        "environment",
        "environmentJump",
        "camera",
        "speaking",
        "durationSec",
      ],
      additionalProperties: false,
    },
  };
}

function buildMockCharacter(topic: string): CharacterSpec {
  return {
    description: `[MOCK] "${topic}" için karakter — 30'larında bir kadın, sade giyim.`,
    anchorPrompt: `[MOCK] Orta-yakın plan portre, nötr fon, düz ışık — "${topic}"`,
    identityContract: "[MOCK] Aynı kişi: yüz, saç, ten tonu, giysi referans görselle birebir.",
  };
}

function buildMockScenes(topic: string, count: number): AiScene[] {
  const beats: { role: RealSceneRole; intent: string; environment: string; camera: SceneCamera }[] = [
    { role: "hook", intent: "Dikkat çeken açılış", environment: "stüdyo", camera: "sabit" },
    { role: "problem", intent: "Beklenmedik sıçrama", environment: "ay yüzeyi", camera: "hareketli" },
    { role: "cozum", intent: "Bir sıçrama daha", environment: "okyanus dibi", camera: "sabit" },
    { role: "kanit", intent: "Kanıt/sonuç göster", environment: "bulutların üstü", camera: "hareketli" },
    { role: "cta", intent: "Harekete geçir", environment: "stüdyo", camera: "sabit" },
  ];
  return beats.slice(0, count).map((b, i) => ({
    id: `scene-${i + 1}`,
    index: i,
    role: b.role,
    intent: `[MOCK] ${b.intent}`,
    shotIdea: `[MOCK] ${topic} — ${b.environment}, ${b.intent.toLowerCase()}`,
    environment: b.environment,
    environmentJump: i > 0 && b.environment !== beats[i - 1].environment,
    camera: b.camera,
    speaking: b.role === "hook" || b.role === "cta",
    durationSec: b.role === "cta" ? 2.5 : 3.5,
    voiceLine: "",
    onScreenText: "",
  }));
}

export async function runAiVideoPlanner(state: RunState): Promise<AgentResult> {
  const payload = aiVideoPayload(state);
  const preset = channelPreset(state.platform);
  const format = runVideoFormat(state);

  if (isMock("script")) {
    const character = buildMockCharacter(state.topic);
    const scenes = buildMockScenes(state.topic, 5);
    return {
      patch: { payload: { ...payload, character, scenes } },
      note: `[MOCK] Karakter + ${scenes.length} sahnelik absürt yay kuruldu (gerçek sanat yönetmeni değil).`,
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
    character: CharacterSpec;
    scenes: {
      role: RealSceneRole;
      intent: string;
      shotIdea: string;
      environment: string;
      environmentJump: boolean;
      camera: SceneCamera;
      speaking: boolean;
      durationSec: number;
    }[];
  }>(state, {
    toneLine: TONE_LINE,
    taskSection: [
      "GÖREV 2 — Önce KARAKTERİ kur, sonra sahne yayını:",
      `Kanal: ${preset.label} (9:16, ${format.width}×${format.height}). ` +
        channelVoiceNote(state.platform, state.mode),
      `Toplam süre ${format.minSec}-${format.maxSec} saniye arasında kalmalı.`,
      "",
      "Bu mod TAMAMEN AI ÜRETİMİ — gerçek çekim yok. 'character' alanında tek bir",
      "kişiyi tarif et (çapa görseli bu kişiden üretilecek, tüm sahnelerde AYNI kalacak).",
      "",
      "3-6 sahne planla. Her sahnenin 'environment'ı önceki sahneden VAHŞİCE farklı",
      "olabilir/olmalı — asıl espri bu (aynı kişi, imkansız ortam sıçramaları).",
      "'environmentJump'ı doğru işaretle: kurgu bunu okuyup sert kesme uygulayacak.",
      "'camera': klip zaten hareketli üretileceği için çoğu sahnede 'sabit' seçmek",
      "daha güvenli — 'hareketli' yalnızca gerçekten sakin/statik bir kare planlıyorsan.",
      "",
      "'styleContract' her sahne prompt'una EKLENECEK: tüm sahneleri tek görsel dilde",
      "tutan cümle (karakterin kimliğinden AYRI — o 'identityContract'ta).",
      briefSection,
    ]
      .filter(Boolean)
      .join("\n"),
    schemaProperties: { character: characterSchema(), scenes: sceneSchema(3, 6) },
    schemaRequired: ["character", "scenes"],
  });

  const scenes: AiScene[] = extra.scenes.map((s, i) => ({
    id: `scene-${i + 1}`,
    index: i,
    role: s.role,
    intent: s.intent,
    // Stil sözleşmesi + kimlik sözleşmesi HARFİYEN ekleniyor — carousel'deki
    // planner.ts ile aynı mekanizma, artı kimlik satırı.
    shotIdea: `${s.shotIdea}\n\n${theme.styleContract}\n\n${extra.character.identityContract}`,
    environment: s.environment,
    environmentJump: i === 0 ? false : s.environmentJump,
    camera: s.camera,
    speaking: s.speaking,
    durationSec: s.durationSec,
    voiceLine: "",
    onScreenText: "",
  }));

  const total = scenes.reduce((a, s) => a + s.durationSec, 0);
  const jumps = scenes.filter((s) => s.environmentJump).length;

  return {
    patch: { payload: { ...payload, theme, character: extra.character, scenes } },
    note:
      `Karakter kuruldu, ${scenes.length} sahnelik yay (~${total.toFixed(1)}sn), ` +
      `${jumps} ortam sıçraması planlandı.`,
    cost,
  };
}
