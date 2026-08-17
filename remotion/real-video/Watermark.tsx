import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { DISPLAY_FONT } from "../fonts";
import type { WatermarkSpec } from "./timeline";

/**
 * "AI ile üretildi" beyanı — TÜM SÜRE boyunca sabit, animasyonsuz.
 *
 * Bilerek `<Sequence>` İÇİNDE DEĞİL: `RealVideoComposition` bunu overlay
 * track'lerinden SONRA, koşulsuz çiziyor. Zamanlı bir öğe olsaydı
 * `timelineDurationSec` onu da hesaba katardı — bkz. `WatermarkSpec`'in
 * üstündeki süre tuzağı notu (`timeline.ts`).
 */

const POSITION: Record<WatermarkSpec["position"], { x: number; y: number; align: string }> = {
  "alt-orta": { x: 0.5, y: 0.96, align: "center" },
  "alt-sag": { x: 0.95, y: 0.96, align: "right" },
  "ust-sag": { x: 0.95, y: 0.04, align: "right" },
};

export function Watermark({ spec }: { spec: WatermarkSpec }) {
  const { height } = useVideoConfig();
  const pos = POSITION[spec.position];
  const fontSize = spec.fontSizePct * height;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${pos.x * 100}%`,
          top: `${pos.y * 100}%`,
          transform:
            pos.align === "center"
              ? "translate(-50%, -100%)"
              : pos.align === "right"
                ? "translate(-100%, 0)"
                : "translate(0, 0)",
          fontFamily: DISPLAY_FONT,
          fontSize,
          fontWeight: 600,
          letterSpacing: "0.02em",
          color: "#ffffff",
          opacity: spec.opacity,
          textAlign: pos.align as React.CSSProperties["textAlign"],
          // Gerçek görüntünün üstünde düz beyaz yazı okunmaz — Title.tsx'teki
          // kontur deseninin aynısı, burada opacity ile birlikte hafif tutuldu.
          WebkitTextStroke: `${(fontSize * 0.03).toFixed(2)}px rgba(0,0,0,0.5)`,
          paintOrder: "stroke fill",
        }}
      >
        {spec.text}
      </div>
    </AbsoluteFill>
  );
}
