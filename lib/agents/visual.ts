import fs from "node:fs/promises";
import path from "node:path";
import { isMock } from "../config/mock";
import { OperatorRequiredError } from "../orchestrator/operatorError";
import { runAssetsDir } from "../orchestrator/paths";
import { getGenerationProvider, hasGenerationProvider } from "../providers/generation";
import { videoScenes, type AgentResult, type RunState } from "../orchestrator/types";

function buildOperatorInstructions(state: RunState): string {
  const sceneLines = videoScenes(state)
    .map(
      (s) =>
        `  - ${s.id} (${s.durationSec}s, ${s.cameraAnimation}): "${s.visualPrompt}"`,
    )
    .join("\n");
  return (
    `Higgsfield programatik API/HIGGSFIELD_API_KEY yok, FAL_KEY de yok — bu sahneleri ` +
    `Higgsfield MCP araçlarıyla (generate_image, ardından generate_video/motion_control) ` +
    `Claude Code operatörü üretmeli:\n${sceneLines}\n` +
    `Sonra POST /api/runs/${state.runId}/submit-visual { projectSlug: "${state.projectSlug}", ` +
    `assets: { <sceneId>: { image, video } } } ile sonucu bildir.`
  );
}

export async function runVisualAgent(state: RunState): Promise<AgentResult> {
  const assetsDir = path.join(runAssetsDir(state.projectSlug, state.runId), "visual");
  await fs.mkdir(assetsDir, { recursive: true });

  const scenes = videoScenes(state);
  const visualAssets: Record<string, { image: string; video: string }> = {};

  if (isMock("visual")) {
    for (const scene of scenes) {
      const p = path.join(assetsDir, `${scene.id}.json`);
      const record = {
        mock: true,
        sceneId: scene.id,
        prompt: scene.visualPrompt,
        cameraAnimation: scene.cameraAnimation,
        note: "MOCK — gerçek modda burada Higgsfield (Claude Code operatör) veya fal.ai olur.",
      };
      await fs.writeFile(p, JSON.stringify(record, null, 2));
      const rel = path.relative(process.cwd(), p);
      visualAssets[scene.id] = { image: rel, video: rel };
    }
    return {
      patch: { assets: { ...state.assets, visual: visualAssets } },
      note: `[MOCK] ${scenes.length} sahne için placeholder görsel/video üretildi.`,
    };
  }

  // Real mode: an HTTP-capable provider (Higgsfield with a real API key, or fal.ai)
  // runs fully automatically. Without either, this is Higgsfield-MCP-only work —
  // hand off to a Claude Code operator instead of failing silently.
  if (!hasGenerationProvider()) {
    throw new OperatorRequiredError(buildOperatorInstructions(state));
  }

  const provider = await getGenerationProvider();
  for (const scene of scenes) {
    const image = await provider.generateImage(scene.visualPrompt);
    const video = await provider.generateVideo(scene.visualPrompt, {
      imageUrl: image.url,
      durationSec: scene.durationSec,
    });
    visualAssets[scene.id] = { image: image.url, video: video.url };
  }

  return {
    patch: { assets: { ...state.assets, visual: visualAssets } },
    note: `${scenes.length} sahne için ${provider.name} ile görsel/video üretildi.`,
  };
}
