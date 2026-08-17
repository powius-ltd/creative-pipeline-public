import type { CSSProperties } from "react";
import type { CaptionStyleId } from "./timeline";

/**
 * ALTYAZI STİLİ SÖZLÜĞÜ — kapalı dağarcık.
 *
 * Kreatif direktör `"capcut-bold"` üretir, ASLA CSS üretmez. Sebebi
 * `CameraAnimation` union'ının sebebiyle aynı: LLM'in serbest metinle stil
 * tarif etmesi render katmanının icra edemeyeceği bir çıktıdır. Yeni bir görünüm
 * isteniyorsa buraya yeni bir id eklenir, prompt'a değil.
 */

export interface CaptionStyleSpec {
  /** Tüm kelimeler büyük harfe çevrilsin mi (CapCut hook'larının imzası). */
  uppercase: boolean;
  fontWeight: number;
  letterSpacingEm: number;
  lineHeight: number;
  /** Kelime aralığı — em cinsinden, punto ile ölçeklensin diye. */
  wordGapEm: number;
  /** Aktif olmayan kelimelerin opaklığı. 1 = hepsi eşit görünür. */
  inactiveOpacity: number;
  /** Aktif kelime bu kadar büyür (1 = büyümez). */
  activeScale: number;
  /** Aktif kelimenin arkasına kutu çizilsin mi. */
  highlightBox: boolean;
  /** Kontur kalınlığı çarpanı — 0 ise kontur yok. */
  strokeScale: number;
  /** Altına düşen sert gölge (CapCut'ın "3D" hissi). */
  hardShadow: boolean;
  /** Kelime kelime mi belirsin, yoksa blok hâlinde mi dursun. */
  revealPerWord: boolean;
}

export const CAPTION_STYLES: Record<CaptionStyleId, CaptionStyleSpec> = {
  /** Varsayılan CapCut görünümü: kalın, konturlu, aktif kelime renk değiştirir. */
  "capcut-bold": {
    uppercase: true,
    fontWeight: 900,
    letterSpacingEm: -0.01,
    lineHeight: 1.12,
    wordGapEm: 0.28,
    inactiveOpacity: 1,
    activeScale: 1.06,
    highlightBox: false,
    strokeScale: 1,
    hardShadow: true,
    revealPerWord: false,
  },

  /** Karaoke: kelimeler tek tek yaylanarak belirir, geçmişler soluklaşır. */
  "karaoke-pop": {
    uppercase: false,
    fontWeight: 800,
    letterSpacingEm: -0.005,
    lineHeight: 1.18,
    wordGapEm: 0.3,
    inactiveOpacity: 0.55,
    activeScale: 1.14,
    highlightBox: false,
    strokeScale: 0.7,
    hardShadow: false,
    revealPerWord: true,
  },

  /** Aktif kelimenin arkasında vurgu dikdörtgeni. */
  "highlight-box": {
    uppercase: true,
    fontWeight: 800,
    letterSpacingEm: 0,
    lineHeight: 1.25,
    wordGapEm: 0.22,
    inactiveOpacity: 1,
    activeScale: 1,
    highlightBox: true,
    strokeScale: 0,
    hardShadow: false,
    revealPerWord: false,
  },

  /** Sakin alt yazı — bilgi videoları, konturuz. */
  "clean-sub": {
    uppercase: false,
    fontWeight: 600,
    letterSpacingEm: 0,
    lineHeight: 1.35,
    wordGapEm: 0.25,
    inactiveOpacity: 1,
    activeScale: 1,
    highlightBox: false,
    strokeScale: 0,
    hardShadow: false,
    revealPerWord: false,
  },
};

/**
 * Konturu `-webkit-text-stroke` ile çiziyoruz ama `paintOrder: "stroke fill"`
 * ŞART: varsayılan sırada kontur harfin İÇİNE doğru çizilir ve ince puntoda
 * harfleri yer. "stroke fill" konturu dışa iter.
 */
export function strokeStyle(widthPx: number, spec: CaptionStyleSpec): CSSProperties {
  const w = widthPx * spec.strokeScale;
  if (w <= 0.1) return {};
  return {
    WebkitTextStroke: `${w.toFixed(2)}px #000`,
    paintOrder: "stroke fill",
  } as CSSProperties;
}

export function shadowStyle(fontSizePx: number, spec: CaptionStyleSpec): CSSProperties {
  if (!spec.hardShadow) return {};
  const offset = Math.max(2, fontSizePx * 0.055);
  return { textShadow: `0 ${offset.toFixed(1)}px 0 rgba(0,0,0,0.42)` };
}
