import { isMock } from "../config/mock";
import { OperatorRequiredError } from "../orchestrator/operatorError";
import { videoScenes, type AgentResult, type RunState } from "../orchestrator/types";

function buildOperatorInstructions(state: RunState): string {
  return (
    `Gemini QC, kullanıcının kendi OAuth ile giriş yaptığı 'gemini' CLI'sı üzerinden ` +
    `çalışıyor (API key yok) — Claude Code operatörü şunu yapmalı:\n` +
    `  1. 'gemini' CLI ile bu run'ın videosunu/sahnelerini analiz et ` +
    `(assets: ${state.assets.montage ?? "montaj timeline'ı henüz yok"}).\n` +
    `  2. gemini'nin analiz çıktısını oku, kendi değerlendirmenle birleştir ` +
    `(gemini'den gelen çıktıya körü körüne güvenme — sahne/marka uyumunu sen de kontrol et).\n` +
    `  3. POST /api/runs/${state.runId}/submit-qc { projectSlug: "${state.projectSlug}", ` +
    `verdict: "approved"|"rejected", notes, flaggedScenes? } ile sonucu bildir.\n` +
    `Not: gerçek mp4 render'ı henüz bağlanmadı (açık madde) — mevcut sahne/asset bilgisiyle değerlendir.`
  );
}

export async function runQcAgent(state: RunState): Promise<AgentResult> {
  if (isMock("qc")) {
    const scenes = videoScenes(state);
    const missingVoice = scenes.some((s) => !state.assets.voice[s.id]);
    const missingVisual = scenes.some((s) => !state.assets.visual[s.id]);
    const verdict = missingVoice || missingVisual ? "rejected" : "approved";
    return {
      patch: {
        qc: {
          verdict,
          notes:
            verdict === "approved"
              ? "[MOCK] Tüm sahneler mevcut, otomatik onaylandı (gerçek Gemini analizi değil)."
              : "[MOCK] Eksik sahne asset'i tespit edildi, reddedildi.",
          flaggedScenes: [],
        },
      },
      note: `[MOCK] Final QC: ${verdict}.`,
    };
  }

  // Real mode: gemini CLI is OAuth-login (the user's own session), not an API key —
  // a Claude Code operator has to run it and interpret the output, not the server.
  throw new OperatorRequiredError(buildOperatorInstructions(state));
}
