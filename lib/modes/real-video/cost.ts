import { isMock } from "../../config/mock";
import { PRICES } from "../../cost/prices";
import type { CostLine, RunState, StageId } from "../../orchestrator/types";
import { footageSource } from "./footage";

/**
 * Maliyet satırları — `carousel/cost.ts` deseninin aynısı: her satır mock
 * farkındadır ve yapı bilindikçe keskinleşir (`completeStage` her aşamadan sonra
 * `estimate()`i yeniden koşuyor).
 *
 * Bu modun para profili carousel'den ÇOK farklı: görsel üretimi yok, o yüzden
 * en pahalı kalem ortadan kalkıyor. Geriye LLM çağrıları ve seslendirme kalıyor.
 * Render ve finisaj $0 ama ZAMAN pahalı — o yüzden satırları duruyor ve
 * `detail`lerinde süre tahmini var, aksi halde maliyet tablosu "bedava" yalanı
 * söylerdi.
 */

function shape(state: RunState) {
  const payload = state.payload.kind === "real-video" ? state.payload : null;
  const scenes = payload?.scenes ?? [];

  // Plan aşaması koşmadıysa varsayım; koştuysa gerçek yapı.
  const sceneCount = scenes.length > 0 ? scenes.length : 4;
  const chars =
    scenes.length > 0
      ? scenes.reduce((a, s) => a + (s.voiceLine?.length ?? 0), 0)
      : sceneCount * 120;
  const durationSec =
    scenes.length > 0
      ? scenes.reduce((a, s) => a + s.durationSec, 0)
      : sceneCount * 3.5;

  return { sceneCount, chars, durationSec };
}

export function estimateRealVideo(state: RunState): Record<StageId, CostLine[]> {
  const { sceneCount, chars, durationSec } = shape(state);
  const frames = Math.round(durationSec * 30);
  const renderSec = Math.round(frames / PRICES.renderFramesPerSec);

  const konsept: CostLine[] = isMock("konsept")
    ? [{ vendor: "claude", detail: "[MOCK] konsept — maliyet yok", usd: 0 }]
    : [
        {
          vendor: "claude",
          detail: "claude CLI × 2 (stratejist + kreatif muhalif)",
          usd: PRICES.claudeCliCall * 2,
        },
      ];

  const llmStage = (label: string): CostLine[] =>
    isMock("script")
      ? [{ vendor: "claude", detail: `[MOCK] ${label} — maliyet yok`, usd: 0 }]
      : [{ vendor: "claude", detail: `claude CLI (${label})`, usd: PRICES.claudeCliCall }];

  // Materyal kaynağı maliyet profilini KÖKTEN değiştiriyor: operatör seçimi
  // bedava, AI üretimi bu modun en pahalı kalemi. Tek satır bırakılsaydı
  // FOOTAGE_SOURCE=generate koşan biri tabloda "$0" görüp yanılırdı.
  const footage: CostLine[] = isMock("footage")
    ? [{ vendor: "compute", detail: "[MOCK] materyal — maliyet yok", usd: 0 }]
    : footageSource() === "generate"
      ? [
          {
            vendor: process.env.HIGGSFIELD_API_KEY ? "higgsfield" : "fal",
            detail: `AI video üretimi ~${durationSec.toFixed(1)}sn (${sceneCount} sahne)`,
            usd: durationSec * PRICES.falVideoPerSec,
          },
        ]
      : [
          {
            vendor: "compute",
            detail: `operatör materyal seçimi (${sceneCount} sahne) — doğrudan maliyet yok`,
            usd: 0,
          },
        ];

  const voice: CostLine[] = isMock("voice")
    ? [{ vendor: "elevenlabs", detail: "[MOCK] seslendirme — maliyet yok", usd: 0 }]
    : [
        {
          vendor: "elevenlabs",
          detail: `ElevenLabs ~${chars} karakter (${sceneCount} sahne, timecode'lu)`,
          usd: (chars / 1000) * PRICES.elevenLabsPerKChar,
        },
      ];

  // Kurgu Aşama A'da deterministik — LLM yok, o yüzden $0. Aşama B'de direktör
  // ajanı gelince burası claudeCliCall olacak.
  const kurgu: CostLine[] = [
    { vendor: "compute", detail: "kurgu — deterministik (Aşama A'da LLM yok)", usd: 0 },
  ];

  const compose: CostLine[] = isMock("render")
    ? [{ vendor: "compute", detail: "[MOCK] render — maliyet yok", usd: 0 }]
    : [
        {
          vendor: "compute",
          detail: `Remotion render ~${frames} kare — lokal GPU, ~${renderSec}sn (para değil ZAMAN)`,
          usd: 0,
        },
      ];

  const finish: CostLine[] = isMock("finish")
    ? [{ vendor: "compute", detail: "[MOCK] finisaj — maliyet yok", usd: 0 }]
    : [
        {
          vendor: "compute",
          detail: "ffmpeg karışım + encode (video kopyalanıyor, yeniden kodlanmıyor)",
          usd: 0,
        },
      ];

  const qc: CostLine[] = isMock("qc")
    ? [{ vendor: "gemini", detail: "[MOCK] QC — maliyet yok", usd: 0 }]
    : [
        {
          vendor: "gemini",
          detail: "gemini CLI (abonelik) — doğrudan $ maliyeti yok",
          usd: PRICES.geminiCliCall,
        },
        {
          vendor: "claude",
          detail: "claude CLI (ölçümlere dayalı yargı)",
          usd: PRICES.claudeCliVisionCall,
        },
      ];

  return {
    konsept,
    plan: llmStage("sanat yönetmeni"),
    copy: llmStage("copywriter"),
    footage,
    voice,
    kurgu,
    compose,
    finish,
    qc,
  };
}
