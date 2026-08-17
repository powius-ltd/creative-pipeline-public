import fs from "node:fs/promises";
import path from "node:path";
import { runAssetsDir } from "../orchestrator/paths";
import { videoScenes, type AgentResult, type RunState } from "../orchestrator/types";

// Builds the Remotion composition's input props (a "timeline") from the run's scenes
// and assets. Real mp4 rendering via @remotion/renderer is an open item — the Player
// component in the dashboard can preview this timeline live in the browser without it.
export async function runMontageAgent(state: RunState): Promise<AgentResult> {
  const assetsDir = runAssetsDir(state.projectSlug, state.runId);
  await fs.mkdir(assetsDir, { recursive: true });

  const timeline = {
    fps: 30,
    scenes: videoScenes(state).map((scene) => ({
      id: scene.id,
      durationSec: scene.durationSec,
      voiceLine: scene.voiceLine,
      cameraAnimation: scene.cameraAnimation,
      transition: "fade" as const,
      visual: state.assets.visual[scene.id] ?? null,
      voice: state.assets.voice[scene.id] ?? null,
    })),
    musicTrack: state.assets.musicTrack ?? null,
    duckingRule: "voice sahnesi başlarken müzik %20'ye düşer, bitince %100'e döner",
  };

  const timelinePath = path.join(assetsDir, "timeline.json");
  await fs.writeFile(timelinePath, JSON.stringify(timeline, null, 2));

  return {
    patch: {
      assets: {
        ...state.assets,
        montage: path.relative(process.cwd(), timelinePath),
      },
    },
    note: `Montaj timeline'ı üretildi (${timeline.scenes.length} sahne). Gerçek mp4 render'ı açık madde.`,
  };
}
