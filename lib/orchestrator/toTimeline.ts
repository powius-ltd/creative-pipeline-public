import { videoScenes, type RunState } from "./types";
import type { Timeline } from "@/remotion/types";

// Mirrors the shape lib/agents/montage.ts writes to timeline.json — used client-side
// so the dashboard can feed the Remotion Player straight from run state without an
// extra fetch for the timeline file.
export function runToTimeline(run: RunState): Timeline {
  return {
    fps: 30,
    scenes: videoScenes(run).map((scene) => ({
      id: scene.id,
      durationSec: scene.durationSec,
      voiceLine: scene.voiceLine,
      cameraAnimation: scene.cameraAnimation,
      transition: "fade",
      visual: run.assets.visual[scene.id] ?? null,
      voice: run.assets.voice[scene.id] ?? null,
    })),
    musicTrack: run.assets.musicTrack ?? null,
    duckingRule: "",
  };
}
