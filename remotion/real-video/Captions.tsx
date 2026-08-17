import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { DISPLAY_FONT } from "../fonts";
import { CAPTION_STYLES, shadowStyle, strokeStyle } from "./captionStyles";
import { upper } from "./textCase";
import type { CaptionItem, VideoTimeline } from "./timeline";

/**
 * KELİME KELİME ALTYAZI — CapCut görünümünün tek başına en büyük payı.
 *
 * Zamanlar `CaptionItem.words` içinde ÇÖZÜLMÜŞ olarak geliyor (ElevenLabs
 * karakter hizalamasından `lib/audio/words.ts` ile türetilmiş, `lib/timeline/
 * anchors.ts` ile global eksene oturtulmuş). Bu bileşen çapa görmez, hesap
 * yapmaz — yalnızca hangi kelimenin aktif olduğunu bulur ve çizer.
 *
 * Tüm ölçüler yüksekliğe ORANLI: `SlideComposition.tsx:67`'deki `k = height/1360`
 * disiplininin aynısı. Aksi halde 9:16 karede 4:5 için ayarlanmış punto boğuk
 * kalıyor.
 */

/**
 * Aktif kelimeyi ikili aramayla bulur. Doğrusal tarama 200 kelimede bile
 * ucuz olurdu ama bu fonksiyon KARE BAŞINA çağrılıyor (30fps × kelime sayısı),
 * o yüzden logaritmik tutuyoruz.
 *
 * Kelimeler arası boşlukta (bir kelime bitti, sonraki başlamadı) SON aktif
 * kelimeyi döndürüyoruz — aksi halde altyazı her kelime arasında sönüp yanardı.
 */
function activeWordIndex(words: CaptionItem["words"], t: number): number {
  if (words.length === 0) return -1;
  if (t < words[0].startSec) return -1;

  let lo = 0;
  let hi = words.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].startSec <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function Captions({
  item,
  language,
}: {
  item: CaptionItem;
  language: VideoTimeline["language"];
}) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const spec = CAPTION_STYLES[item.styleId];

  // Sequence içindeyiz; kelime zamanları ise GLOBAL. Yerel kareyi öğenin mutlak
  // başlangıcıyla toplayarak global zamana dönüyoruz.
  const t = item.startSec + frame / fps;

  const active = activeWordIndex(item.words, t);

  const fontSize = item.fontSizePct * height;
  const strokePx = item.strokeWidthPct * height;

  return (
    <AbsoluteFill
      style={{
        // position 0..1 normalize; kareden bağımsız olsun diye yüzdeye çeviriyoruz.
        justifyContent: "center",
        alignItems: "center",
        padding: `0 ${(1 - item.maxWidthPct) * 50}%`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: `${item.position.x * 100}%`,
          top: `${item.position.y * 100}%`,
          transform: "translate(-50%, -50%)",
          width: `${item.maxWidthPct * 100}%`,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
          columnGap: `${spec.wordGapEm}em`,
          rowGap: `${(spec.lineHeight - 1) * 0.9}em`,
          fontFamily: DISPLAY_FONT,
          fontSize,
          fontWeight: spec.fontWeight,
          letterSpacing: `${spec.letterSpacingEm}em`,
          lineHeight: spec.lineHeight,
          textAlign: "center",
          color: item.color,
          ...strokeStyle(strokePx, spec),
          ...shadowStyle(fontSize, spec),
        }}
      >
        {item.words.map((w, i) => {
          const isActive = i === active;
          const isPast = i < active;

          // revealPerWord: kelime henüz söylenmediyse hiç çizilmez (karaoke).
          // Aksi halde blok hâlinde durur ve yalnızca aktif olan vurgulanır —
          // CapCut'ın varsayılan davranışı bu.
          if (spec.revealPerWord && i > active) return null;

          // Yaylanan giriş: kelimenin kendi başlangıç karesinden itibaren.
          const wordStartFrame = Math.round((w.startSec - item.startSec) * fps);
          const pop =
            isActive && spec.activeScale > 1
              ? spring({
                  frame: frame - wordStartFrame,
                  fps,
                  config: { damping: 12, mass: 0.4, stiffness: 200 },
                  durationInFrames: Math.max(4, Math.round(fps * 0.22)),
                })
              : 1;

          const scale = isActive ? 1 + (spec.activeScale - 1) * pop : 1;

          // Vurgu rengi iki sebepten uygulanır: kelime aktif, ya da direktör
          // `emphasis` işaretlemiş (zoom-punch ile aynı kelime).
          const useHighlight = isActive || w.emphasis === true;

          return (
            <span
              key={`${item.id}-${i}`}
              style={{
                display: "inline-block",
                transform: `scale(${scale.toFixed(4)})`,
                transformOrigin: "center bottom",
                opacity: isActive || isPast || !spec.revealPerWord ? 1 : spec.inactiveOpacity,
                ...(isPast && spec.inactiveOpacity < 1 ? { opacity: spec.inactiveOpacity } : {}),
                color: useHighlight ? item.highlightColor : item.color,
                ...(spec.highlightBox && isActive
                  ? {
                      backgroundColor: item.highlightColor,
                      color: item.color,
                      borderRadius: fontSize * 0.14,
                      padding: `0 ${fontSize * 0.12}px`,
                    }
                  : {}),
              }}
            >
              {spec.uppercase ? upper(w.text, language) : w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
