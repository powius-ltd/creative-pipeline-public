import { isMock } from "../../config/mock";
import {
  CLAUDE_STAGE_TOKENS,
  PRICES,
  SCENE_DEFAULTS,
  claudeCostUsd,
} from "../../cost/prices";
import type { CostLine, RunState, StageId } from "../../orchestrator/types";
import { videoScenes } from "../../orchestrator/types";

/**
 * Bu dosya eskiden lib/cost/estimate.ts içindeydi; aşama isimleri (brief/voice/…)
 * moda özel olduğu için modun yanına taşındı. Fiyat tablosu (lib/cost/prices.ts)
 * paylaşılan tek kaynak olarak kaldı.
 */

/** Görsel üretim yolu: fal (HTTP, tam otomatik) mı, yoksa Higgsfield/operatör mü? */
function visualMode(): "fal" | "operator" {
  return process.env.FAL_KEY ? "fal" : "operator";
}

interface SceneShape {
  count: number;
  totalChars: number;
  totalDuration: number;
}

function sceneShape(state: RunState): SceneShape {
  const scenes = videoScenes(state);
  if (scenes.length > 0) {
    return {
      count: scenes.length,
      totalChars: scenes.reduce((s, sc) => s + sc.voiceLine.length, 0),
      totalDuration: scenes.reduce((s, sc) => s + sc.durationSec, 0),
    };
  }
  return {
    count: SCENE_DEFAULTS.count,
    totalChars: SCENE_DEFAULTS.count * SCENE_DEFAULTS.charsPerScene,
    totalDuration: SCENE_DEFAULTS.count * SCENE_DEFAULTS.durationSec,
  };
}

function estimateBrief(): CostLine[] {
  if (isMock("script")) {
    return [{ vendor: "claude", detail: "[MOCK] senaryo — maliyet yok", usd: 0 }];
  }
  const { in: i, out: o } = CLAUDE_STAGE_TOKENS.brief;
  return [
    {
      vendor: "claude",
      detail: `senaryo asistı ~${i / 1000}K girdi / ${o / 1000}K çıktı`,
      usd: claudeCostUsd(i, o),
    },
  ];
}

function estimateVoice(shape: SceneShape): CostLine[] {
  if (isMock("voice")) {
    return [{ vendor: "elevenlabs", detail: "[MOCK] ses — maliyet yok", usd: 0 }];
  }
  return [
    {
      vendor: "elevenlabs",
      detail: `${shape.totalChars} kar × $${PRICES.elevenLabsPerKChar}/1k`,
      usd: (shape.totalChars / 1000) * PRICES.elevenLabsPerKChar,
    },
  ];
}

function estimateVisual(shape: SceneShape): CostLine[] {
  if (isMock("visual")) {
    return [{ vendor: "fal", detail: "[MOCK] görsel — maliyet yok", usd: 0 }];
  }
  if (visualMode() === "fal") {
    return [
      {
        vendor: "fal",
        detail: `${shape.count} görsel × $${PRICES.falImageEach}`,
        usd: shape.count * PRICES.falImageEach,
      },
      {
        vendor: "fal",
        detail: `${shape.totalDuration}s video × $${PRICES.falVideoPerSec}/s`,
        usd: shape.totalDuration * PRICES.falVideoPerSec,
      },
    ];
  }
  // Operatör (Higgsfield MCP): kredi + Claude orkestrasyon tokenları
  const base = CLAUDE_STAGE_TOKENS.visualBase;
  const per = CLAUDE_STAGE_TOKENS.visualPerScene;
  const claudeIn = base.in + shape.count * per.in;
  const claudeOut = base.out + shape.count * per.out;
  return [
    {
      vendor: "higgsfield",
      detail: `${shape.count} sahne × $${PRICES.higgsfieldPerScene} (kredi, tahmini)`,
      usd: shape.count * PRICES.higgsfieldPerScene,
    },
    {
      vendor: "claude",
      detail: `operatör orkestrasyon ~${Math.round(claudeIn / 1000)}K/${Math.round(
        claudeOut / 1000,
      )}K token`,
      usd: claudeCostUsd(claudeIn, claudeOut),
    },
  ];
}

function estimateMontage(): CostLine[] {
  return [{ vendor: "compute", detail: "Remotion lokal render", usd: 0 }];
}

function estimateQc(): CostLine[] {
  if (isMock("qc")) {
    return [{ vendor: "gemini", detail: "[MOCK] QC — maliyet yok", usd: 0 }];
  }
  const { in: i, out: o } = CLAUDE_STAGE_TOKENS.qc;
  return [
    { vendor: "gemini", detail: "gemini CLI (OAuth) — doğrudan maliyet yok", usd: 0 },
    {
      vendor: "claude",
      detail: `operatör değerlendirme ~${i / 1000}K/${o / 1000}K token`,
      usd: claudeCostUsd(i, o),
    },
  ];
}

export function estimateFullAiVideo(state: RunState): Record<StageId, CostLine[]> {
  const shape = sceneShape(state);
  return {
    brief: estimateBrief(),
    voice: estimateVoice(shape),
    visual: estimateVisual(shape),
    montage: estimateMontage(),
    qc: estimateQc(),
  };
}
