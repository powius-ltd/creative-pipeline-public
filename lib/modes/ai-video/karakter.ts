import fsp from "node:fs/promises";
import path from "node:path";
import { aspectSpec } from "../../config/aspect";
import { isMock } from "../../config/mock";
import { PRICES } from "../../cost/prices";
import { OperatorRequiredError } from "../../orchestrator/operatorError";
import { runAssetsDir } from "../../orchestrator/paths";
import type { AgentResult, RunState } from "../../orchestrator/types";
import { aiVideoPayload } from "../../orchestrator/types";
import { toRelative } from "../../providers/download";
import { hasGenerationProvider } from "../../providers/generation";
import { runAspect } from "../descriptors";

/**
 * KARAKTER ÇAPASI — carousel'in stil çapasının kimlik eşdeğeri.
 *
 * Ayrı bir AŞAMA (onay kapısı), sahne üretiminden ÖNCE: çapa yanlışsa
 * aşağıdaki HER sahne yanlış olur ve bu modun en pahalı kalemini (video
 * üretimi) baştan boşa harcatır. Tek bir görsel (~$0.03) burada, N video
 * üretimi bir sonraki aşamada.
 */

export function characterDir(state: RunState): string {
  return path.join(runAssetsDir(state.projectSlug, state.runId), "character");
}

function buildOperatorInstructions(state: RunState): string {
  const payload = aiVideoPayload(state);
  const c = payload.character;
  return (
    `HTTP ile üretecek anahtar yok (HIGGSFIELD_API_KEY ve FAL_KEY ikisi de boş).\n\n` +
    `Bir Claude Code operatörü Higgsfield MCP araçlarıyla (generate_image) karakter ` +
    `çapasını üretmeli:\n` +
    `  prompt: "${c?.anchorPrompt ?? "(planner önce koşmalı)"}"\n\n` +
    `Üretilen dosyayı şu klasöre koy:\n   ${characterDir(state)}\n` +
    `   (uzantı önemli değil: .png/.jpg/.webp)\n\n` +
    `Sonra POST /api/runs/${state.runId}/submit-character ile bildir:\n` +
    `   { "projectSlug": "${state.projectSlug}", "file": "dosya-adi.png", "url": "<varsa hosted url>" }\n` +
    `"url" OPSİYONEL ama önemli: sonraki 'sahne' aşaması i2i referansı için hosted URL ` +
    `tercih eder (yerel dosya fal'a yüklenemez). Yoksa sahne üretimi de operatöre düşer.`
  );
}

export async function runCharacterStage(state: RunState): Promise<AgentResult> {
  const payload = aiVideoPayload(state);
  if (!payload.character) {
    throw new Error("Karakter tarifi yok — 'plan' aşaması önce koşmalı.");
  }
  const dir = characterDir(state);
  await fsp.mkdir(dir, { recursive: true });

  if (isMock("karakter")) {
    const p = path.join(dir, "anchor.json");
    await fsp.writeFile(
      p,
      JSON.stringify(
        { mock: true, prompt: payload.character.anchorPrompt, note: "MOCK — gerçek görsel yok" },
        null,
        2,
      ),
    );
    return {
      patch: { assets: { ...state.assets, characterRef: { url: "", path: toRelative(p) } } },
      note: "[MOCK] Karakter çapası atlandı (gerçek görsel üretilmedi).",
    };
  }

  if (!hasGenerationProvider()) {
    throw new OperatorRequiredError(buildOperatorInstructions(state));
  }

  const { getGenerationProvider } = await import("../../providers/generation");
  const { downloadTo } = await import("../../providers/download");
  const provider = await getGenerationProvider();
  const aspect = aspectSpec(runAspect(state));

  const { url } = await provider.generateImage(payload.character.anchorPrompt, {
    width: aspect.still.width,
    height: aspect.still.height,
  });
  const abs = await downloadTo(url, path.join(dir, "anchor.png"));

  return {
    patch: { assets: { ...state.assets, characterRef: { url, path: toRelative(abs) } } },
    note: `Karakter çapası üretildi (${provider.name}).`,
    cost: {
      vendor: provider.name === "higgsfield" ? "higgsfield" : "fal",
      detail: "karakter çapası (1 görsel)",
      costUsd: PRICES.falImageEach,
    },
  };
}
