import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { TimelineScene } from "./types";

function hashColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 32%)`;
}

function cameraTransform(
  animation: TimelineScene["cameraAnimation"],
  progress: number,
) {
  switch (animation) {
    case "zoom-in":
      return `scale(${1 + progress * 0.15})`;
    case "zoom-out":
      return `scale(${1.15 - progress * 0.15})`;
    case "pan-left":
      return `translateX(${-progress * 40}px) scale(1.1)`;
    case "pan-right":
      return `translateX(${progress * 40}px) scale(1.1)`;
    case "breathing":
      return `scale(${1 + Math.sin(progress * Math.PI * 2) * 0.03})`;
    case "static":
    default:
      return "none";
  }
}

export function Scene({ scene }: { scene: TimelineScene }) {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: hashColor(scene.id),
        alignItems: "center",
        justifyContent: "flex-end",
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          transform: cameraTransform(scene.cameraAnimation, progress),
        }}
      >
        {scene.visual ? (
          <AbsoluteFill
            style={{
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,0.5)",
              fontSize: 22,
              fontFamily: "sans-serif",
              textAlign: "center",
              padding: 40,
            }}
          >
            {scene.visual.image.endsWith(".json")
              ? "[MOCK GÖRSEL] " + scene.id
              : null}
          </AbsoluteFill>
        ) : null}
      </AbsoluteFill>

      <div
        style={{
          marginBottom: 80,
          maxWidth: "80%",
          padding: "16px 24px",
          backgroundColor: "rgba(0,0,0,0.55)",
          borderRadius: 12,
          color: "white",
          fontFamily: "sans-serif",
          fontSize: 32,
          textAlign: "center",
          lineHeight: 1.3,
        }}
      >
        {scene.voiceLine}
      </div>

      <div
        style={{
          position: "absolute",
          top: 24,
          left: 24,
          color: "rgba(255,255,255,0.6)",
          fontFamily: "monospace",
          fontSize: 14,
        }}
      >
        {scene.id} · {(durationInFrames / fps).toFixed(1)}s · {scene.cameraAnimation}
      </div>
    </AbsoluteFill>
  );
}
