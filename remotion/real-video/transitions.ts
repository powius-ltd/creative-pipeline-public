import type { CSSProperties } from "react";
import type { KenBurns, TransitionKind } from "./timeline";

/**
 * GEÇİŞLER ELDE YAZILIYOR, `@remotion/transitions` KULLANILMIYOR.
 *
 * Sebep yapısal: `TransitionSeries` geçiş karelerini TÜKETİR — bu yüzden
 * `CreativeRunComposition`'daki `timelineDurationInFrames` bindirmeyi süreden
 * çıkarmak zorunda. Çok kanallı modelde bu ölümcül olurdu: overlay'in mutlak
 * zamanı video kanalının zamanıyla eşleşmez, altyazı kayardı.
 *
 * Burada her klip düz bir `<Sequence from={startSec*fps}>` içinde duruyor ve
 * geçişi KENDİ giriş animasyonu olarak yapıyor. Bindirme, iki klibin zaman
 * aralıklarının çakışmasıyla ifade ediliyor. Sonuç: yazı bir geçişin üzerinden
 * geçebiliyor — CapCut'ta sürekli yapılan şey.
 */

/** 0..1 aralığına kırp. */
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Yumuşak giriş — lineer geçiş dijital ve ucuz görünüyor. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function applyEasing(t: number, easing: KenBurns["easing"]): number {
  const p = clamp01(t);
  switch (easing) {
    case "ease-out":
      return easeOutCubic(p);
    case "ease-in-out":
      return easeInOutCubic(p);
    case "linear":
    default:
      return p;
  }
}

/**
 * Klibin GİRİŞ animasyonu.
 *
 * `progress` = geçişin ne kadarı tamamlandı (0 = geçiş başladı, 1 = bitti).
 * Geçiş süresi 0 veya kind "cut" ise çağıran bunu hiç çağırmaz.
 */
export function transitionInStyle(kind: TransitionKind, progress: number): CSSProperties {
  const p = clamp01(progress);

  switch (kind) {
    case "fade":
      return { opacity: p };

    case "dissolve":
      // Fade'den farkı: hafif ölçek nefesi eşlik ediyor, kesme daha organik.
      return { opacity: easeOutCubic(p), transform: `scale(${1.04 - 0.04 * easeOutCubic(p)})` };

    case "whip": {
      // Yatay savurma + bulanıklık. CapCut'ın "whip pan" hissi: hızlı girer,
      // son %30'da bulanıklık kalkar.
      const e = easeOutCubic(p);
      const shiftPct = (1 - e) * 60;
      const blurPx = (1 - e) * 14;
      return {
        opacity: Math.min(1, p * 2.2),
        transform: `translateX(${shiftPct}%)`,
        filter: blurPx > 0.2 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
      };
    }

    case "zoom-punch": {
      // Vurgu anında kullanılan sert giriş: büyükten normale çakar.
      const e = easeOutCubic(p);
      return { opacity: Math.min(1, p * 3), transform: `scale(${1.18 - 0.18 * e})` };
    }

    case "cut":
    default:
      return {};
  }
}

/**
 * Ken Burns — `Scene.tsx:12-31`'deki `cameraTransform`'un genelleştirilmiş hâli.
 * Orada animasyon adı sabit bir enum'du (zoom-in, pan-left...); burada from→to
 * serbest, çünkü gerçek footage'da kadraj klibe göre değişiyor.
 */
export function kenBurnsTransform(motion: KenBurns | undefined, progress: number): string {
  if (!motion) return "none";
  const t = applyEasing(progress, motion.easing);
  const scale = motion.from.scale + (motion.to.scale - motion.from.scale) * t;
  const x = motion.from.x + (motion.to.x - motion.from.x) * t;
  const y = motion.from.y + (motion.to.y - motion.from.y) * t;
  return `translate(${x.toFixed(3)}%, ${y.toFixed(3)}%) scale(${scale.toFixed(4)})`;
}
