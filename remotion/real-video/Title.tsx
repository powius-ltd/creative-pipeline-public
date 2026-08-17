import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { DISPLAY_FONT } from "../fonts";
import { upper } from "./textCase";
import type { TitleItem, VideoTimeline } from "./timeline";

/**
 * BAŞLIK / LOWER-THIRD / CTA — altyazıdan ayrı, çünkü zamanlaması kelimeye
 * değil sahneye bağlı ve tipografisi daha büyük.
 *
 * Altyazı "söylenen"i yazar, başlık "gösterilen"i. CapCut'ta ikisi aynı anda
 * ekranda olabilir (hook başlığı üstte, altyazı altta), bu yüzden ayrı öğe
 * tipleri ve ayrı overlay kanalları.
 */

const STYLE_SPECS: Record<
  TitleItem["styleId"],
  { weight: number; uppercase: boolean; letterSpacingEm: number; boxPadEm: number }
> = {
  hook: { weight: 900, uppercase: true, letterSpacingEm: -0.02, boxPadEm: 0 },
  "lower-third": { weight: 700, uppercase: false, letterSpacingEm: 0, boxPadEm: 0.35 },
  cta: { weight: 800, uppercase: true, letterSpacingEm: 0.06, boxPadEm: 0.45 },
  stat: { weight: 900, uppercase: false, letterSpacingEm: -0.03, boxPadEm: 0 },
};

export function Title({
  item,
  language,
}: {
  item: TitleItem;
  language: VideoTimeline["language"];
}) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const spec = STYLE_SPECS[item.styleId];
  const fontSize = item.fontSizePct * height;

  const enter = spring({
    frame,
    fps,
    config: { damping: 14, mass: 0.5, stiffness: 180 },
    durationInFrames: Math.max(6, Math.round(fps * 0.35)),
  });

  // Çıkışta da sönsün — sert kesme başlıkta ucuz görünüyor (altyazıda sorun değil,
  // çünkü orada kelime akışı zaten devam ediyor).
  const totalFrames = Math.max(1, Math.round(item.durationSec * fps));
  const fadeOut = interpolate(
    frame,
    [totalFrames - Math.round(fps * 0.25), totalFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  let transform = "translate(-50%, -50%)";
  let opacity = fadeOut;

  switch (item.animation) {
    case "pop":
      transform += ` scale(${(0.86 + 0.14 * enter).toFixed(4)})`;
      opacity *= Math.min(1, enter * 1.6);
      break;
    case "slide-up":
      transform += ` translateY(${((1 - enter) * 28).toFixed(2)}%)`;
      opacity *= Math.min(1, enter * 1.8);
      break;
    case "typewriter":
      // Harf harf açılım aşağıda karakter kırpmasıyla yapılıyor.
      break;
    case "none":
    default:
      break;
  }

  const shown =
    item.animation === "typewriter"
      ? item.text.slice(0, Math.max(0, Math.round(item.text.length * enter)))
      : item.text;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${item.position.x * 100}%`,
          top: `${item.position.y * 100}%`,
          transform,
          opacity,
          maxWidth: "86%",
          fontFamily: DISPLAY_FONT,
          fontSize,
          fontWeight: spec.weight,
          letterSpacing: `${spec.letterSpacingEm}em`,
          lineHeight: 1.1,
          textAlign: "center",
          color: item.color,
          textWrap: "balance",
          ...(item.boxColor
            ? {
                backgroundColor: item.boxColor,
                padding: `${spec.boxPadEm * 0.6}em ${spec.boxPadEm}em`,
                borderRadius: fontSize * 0.22,
              }
            : {
                // Kutu yoksa okunabilirliği kontur taşıyor — gerçek footage'ın
                // üstünde düz beyaz yazı sık sık kayboluyor.
                WebkitTextStroke: `${(fontSize * 0.022).toFixed(2)}px #000`,
                paintOrder: "stroke fill",
              }),
        }}
      >
        {spec.uppercase ? upper(shown, language) : shown}
      </div>
    </AbsoluteFill>
  );
}
