import { isMock } from "../../config/mock";
import { PRICES } from "../../cost/prices";
import type { CostLine, RunState, StageId } from "../../orchestrator/types";

/**
 * Maliyet satırları — `real-video/cost.ts` deseninin aynısı, ama para profili
 * TAMAMEN FARKLI: burada materyal seçimi diye bir şey yok, hepsi üretim.
 * `sahne` bu modun en pahalı kalemi (fal video ~$0.07/sn); `karakter` ucuz
 * ama ZORUNLU bir ön adım (tek görsel, ~$0.03).
 */

function shape(state: RunState) {
  const payload = state.payload.kind === "ai-video" ? state.payload : null;
  const scenes = payload?.scenes ?? [];

  const sceneCount = scenes.length > 0 ? scenes.length : 4;
  const chars =
    scenes.length > 0
      ? scenes.reduce((a, s) => a + (s.voiceLine?.length ?? 0), 0)
      : sceneCount * 120;
  const durationSec =
    scenes.length > 0 ? scenes.reduce((a, s) => a + s.durationSec, 0) : sceneCount * 3.5;

  return { sceneCount, chars, durationSec };
}

export function estimateAiVideo(state: RunState): Record<StageId, CostLine[]> {
  const { sceneCount, chars, durationSec } = shape(state);
  const frames = Math.round(durationSec * 30);
  const renderSec = Math.round(frames / PRICES.renderFramesPerSec);
  const vendor = process.env.HIGGSFIELD_API_KEY ? "higgsfield" : "fal";

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

  const voice: CostLine[] = isMock("voice")
    ? [{ vendor: "elevenlabs", detail: "[MOCK] seslendirme — maliyet yok", usd: 0 }]
    : [
        {
          vendor: "elevenlabs",
          detail: `ElevenLabs ~${chars} karakter (${sceneCount} sahne, timecode'lu)`,
          usd: (chars / 1000) * PRICES.elevenLabsPerKChar,
        },
      ];

  const karakter: CostLine[] = isMock("karakter")
    ? [{ vendor, detail: "[MOCK] karakter çapası — maliyet yok", usd: 0 }]
    : [{ vendor, detail: "karakter çapası (1 görsel)", usd: PRICES.falImageEach }];

  // Bu modun en pahalı kalemi: video üretimi süreyle orantılı.
  const sahne: CostLine[] = isMock("sahne")
    ? [{ vendor, detail: "[MOCK] sahne üretimi — maliyet yok", usd: 0 }]
    : [
        {
          vendor,
          detail: `AI video üretimi ~${durationSec.toFixed(1)}sn (${sceneCount} sahne, karakter referanslı)`,
          usd: durationSec * PRICES.falVideoPerSec,
        },
      ];

  const kurgu: CostLine[] = [
    { vendor: "compute", detail: "kurgu — deterministik (LLM yok)", usd: 0 },
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
    voice,
    karakter,
    sahne,
    kurgu,
    compose,
    finish,
    qc,
  };
}
