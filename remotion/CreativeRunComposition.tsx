import React from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Scene } from "./Scene";
import { MusicTrack } from "./MusicTrack";
import type { Timeline } from "./types";

const TRANSITION_FRAMES = 12;

export function CreativeRunComposition({ timeline }: { timeline: Timeline }) {
  const { fps, scenes, musicTrack } = timeline;

  if (scenes.length === 0) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#111",
          color: "white",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
        }}
      >
        Henüz sahne yok.
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <TransitionSeries>
        {scenes.map((scene, i) => (
          <React.Fragment key={scene.id}>
            <TransitionSeries.Sequence
              durationInFrames={Math.round(scene.durationSec * fps)}
            >
              <Scene scene={scene} />
            </TransitionSeries.Sequence>
            {i < scenes.length - 1 ? (
              <TransitionSeries.Transition
                presentation={fade()}
                timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
              />
            ) : null}
          </React.Fragment>
        ))}
      </TransitionSeries>
      <MusicTrack src={musicTrack} />
    </AbsoluteFill>
  );
}

export function timelineDurationInFrames(timeline: Timeline): number {
  const transitionsCount = Math.max(timeline.scenes.length - 1, 0);
  const raw = timeline.scenes.reduce(
    (sum, s) => sum + Math.round(s.durationSec * timeline.fps),
    0,
  );
  return Math.max(raw - transitionsCount * TRANSITION_FRAMES, timeline.fps);
}
