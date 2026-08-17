import type { CameraAnimation } from "@/lib/orchestrator/types";

export interface TimelineScene {
  id: string;
  durationSec: number;
  voiceLine: string;
  cameraAnimation: CameraAnimation;
  transition: "fade";
  visual: { image: string; video: string } | null;
  voice: string | null;
}

export interface Timeline {
  fps: number;
  scenes: TimelineScene[];
  musicTrack: string | null;
  duckingRule: string;
}

export const SAMPLE_TIMELINE: Timeline = {
  fps: 30,
  scenes: [
    {
      id: "scene-1",
      durationSec: 5,
      voiceLine: "Örnek sahne — henüz üretim yapılmadı.",
      cameraAnimation: "zoom-in",
      transition: "fade",
      visual: null,
      voice: null,
    },
  ],
  musicTrack: null,
  duckingRule: "",
};
