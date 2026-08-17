import fsp from "node:fs/promises";
import path from "node:path";
import { generateClip } from "../../agents/video/generateClip";
import { aspectSpec } from "../../config/aspect";
import { isMock } from "../../config/mock";
import { PRICES } from "../../cost/prices";
import { OperatorRequiredError } from "../../orchestrator/operatorError";
import { runAssetsDir } from "../../orchestrator/paths";
import type { AgentResult, FootageClip, RunState } from "../../orchestrator/types";
import { aiVideoPayload } from "../../orchestrator/types";
import { hasGenerationProvider } from "../../providers/generation";
import { runAspect } from "../descriptors";
import { measureClipsIn, type SubmittedClip } from "../real-video/footage";

/**
 * SAHNE ÜRETİMİ — karakter çapasına referans veren i2i, sonra i2v.
 *
 * Yıldız topolojisi `carousel/visual.ts`'in birebir uyarlaması: HER sahne
 * AYNI karakter çapasına referans verir, bir öncekine ASLA — zincirlemede
 * sapma birikip yüz yavaşça başka birine dönüşürdü (kullanıcının "zorunlu"
 * dediği tek şeyin ihlali). `generateClip` iki hop'u (t2i/i2i → i2v) tek
 * yerde topluyor; ölçüm `measureClipsIn` ile real-video'nunkiyle AYNI yoldan
 * geçiyor — ikinci bir ölçüm yazmak iki kaynağın zamanla ayrışması demekti.
 */

export function sceneDir(state: RunState): string {
  return path.join(runAssetsDir(state.projectSlug, state.runId), "scenes");
}

function buildOperatorInstructions(state: RunState): string {
  const payload = aiVideoPayload(state);
  const sceneLines = payload.scenes
    .map((s) => `  - ${s.id} (${s.durationSec}sn, ortam: ${s.environment}): "${s.shotIdea.split("\n")[0]}"`)
    .join("\n");
  const reason = state.assets.characterRef?.url
    ? "HTTP ile üretecek anahtar yok (HIGGSFIELD_API_KEY ve FAL_KEY ikisi de boş)."
    : "Karakter çapasının hosted url'i yok (operatör yerel dosya bildirmiş olabilir) — i2i referansı için url gerekiyor.";

  return (
    `${reason}\n\n` +
    `Bir Claude Code operatörü Higgsfield MCP araçlarıyla (generate_image, ardından ` +
    `generate_video/motion_control) karakter çapasına REFERANS VEREREK şu sahneleri ` +
    `üretmeli:\n${sceneLines}\n\n` +
    `Üretilen dosyaları şu klasöre koy:\n   ${sceneDir(state)}\n\n` +
    `Sonra POST /api/runs/${state.runId}/submit-scene ile bildir ` +
    `(gövde: { projectSlug, clips: [{ sceneId, file, inSec?, outSec? }] } — ölçüm ffprobe ile yapılır).`
  );
}

/** Mock'ta gerçek dosya yok — sahte FootageClip, aşağı akış (kurgu/compose) uçtan uca test edilebilsin diye. */
function buildMockFootage(state: RunState): FootageClip[] {
  const payload = aiVideoPayload(state);
  return payload.scenes.map((s) => ({
    sceneId: s.id,
    file: `[MOCK]/${s.id}.mp4`,
    inSec: 0,
    outSec: s.durationSec,
    probe: { durationSec: s.durationSec, width: 1080, height: 1920, fps: 30, hasAudio: false, rotation: 0 },
  }));
}

export async function runSceneStage(state: RunState): Promise<AgentResult> {
  const payload = aiVideoPayload(state);
  const dir = sceneDir(state);
  await fsp.mkdir(dir, { recursive: true });

  if (isMock("sahne")) {
    const footage = buildMockFootage(state);
    return {
      patch: { payload: { ...payload, footage } },
      note: `[MOCK] ${footage.length} sahne için sahte üretim kaydı oluşturuldu (gerçek dosya yok).`,
    };
  }

  const refUrl = state.assets.characterRef?.url;
  if (!hasGenerationProvider() || !refUrl) {
    throw new OperatorRequiredError(buildOperatorInstructions(state));
  }

  const { getGenerationProvider } = await import("../../providers/generation");
  const { downloadTo } = await import("../../providers/download");
  const provider = await getGenerationProvider();
  const aspect = aspectSpec(runAspect(state));

  const submitted: SubmittedClip[] = [];
  const failures: string[] = [];
  let generatedSec = 0;

  for (const scene of payload.scenes) {
    try {
      const { videoUrl } = await generateClip(provider, {
        prompt: scene.shotIdea,
        durationSec: scene.durationSec,
        aspect,
        refUrl,
      });

      const file = `${scene.id}.mp4`;
      await downloadTo(videoUrl, path.join(dir, file));
      submitted.push({ sceneId: scene.id, file });
      generatedSec += scene.durationSec;
    } catch (err) {
      failures.push(`${scene.id}: ${(err as Error).message}`);
    }
  }

  if (submitted.length === 0) {
    throw new Error(`Hiçbir sahne üretilemedi (${provider.name}).\n` + failures.join("\n"));
  }

  const measured = await measureClipsIn(dir, payload.scenes, submitted);
  const warnings = [...measured.warnings, ...failures];

  return {
    patch: {
      payload: { ...payload, footage: measured.footage },
    },
    note:
      `${measured.footage.length}/${payload.scenes.length} sahne ${provider.name} ile ` +
      `üretildi (~${generatedSec.toFixed(1)}sn, karakter çapasına referanslı), ffprobe ile ölçüldü.` +
      (warnings.length > 0 ? `\nUYARILAR:\n  - ${warnings.join("\n  - ")}` : ""),
    cost: {
      vendor: provider.name === "higgsfield" ? "higgsfield" : "fal",
      detail: `${submitted.length} klip video üretimi (~${generatedSec.toFixed(1)}sn)`,
      costUsd: generatedSec * PRICES.falVideoPerSec,
    },
  };
}
