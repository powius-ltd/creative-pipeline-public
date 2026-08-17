/**
 * ÇOK KANALLI ZAMAN ÇİZELGESİ — real-video modunun render sözleşmesi.
 *
 * `remotion/types.ts`'teki tek kanallı `Timeline`'a DOKUNULMUYOR: donmuş
 * full-ai-video modunun kompozisyonu, `SAMPLE_TIMELINE`'ı ve diskteki mevcut
 * `state.json` dosyaları onunla geçerli kalmalı. Bu tip yanında durur ve
 * `version: 2` ile ayrışır.
 *
 * Neden çok kanallı: CapCut katmanlıdır — yazı, b-roll, ana görüntü, ses efekti
 * ve müzik aynı zaman ekseninde ÜST ÜSTE durur. Tek kanallı `scenes[]` üstüne
 * bu inşa edilemez.
 */

export type Sec = number;

// ---- Video kanalı ----------------------------------------------------------

export interface MediaRef {
  /** Render anında yerel asset sunucusunun verdiği http:// URL (bkz. lib/render/assetServer.ts). */
  src: string;
  kind: "video" | "image";
  /** Kaynak klip İÇİNDEKİ giriş/çıkış. Foto için ikisi de 0. */
  inSec: Sec;
  outSec: Sec;
  /**
   * CapCut'taki "orijinal ses" anahtarı. Nihai karışım ffmpeg'de yapılsa da
   * Remotion önizlemesinin doğru duyulması için burada da taşınıyor.
   */
  useSourceAudio: boolean;
  /** 0..1 */
  sourceGain: number;
}

export interface KenBurns {
  from: { scale: number; x: number; y: number };
  to: { scale: number; x: number; y: number };
  easing: "linear" | "ease-out" | "ease-in-out";
}

export type TransitionKind = "cut" | "fade" | "dissolve" | "whip" | "zoom-punch";

export interface TransitionSpec {
  kind: TransitionKind;
  durationSec: Sec;
}

export interface ClipItem {
  id: string;
  /**
   * TIMELINE zamanı — MUTLAK. Geçiş bindirmesi, iki klibin startSec/durationSec
   * aralıklarının çakışmasıyla ifade edilir; süreyi kısaltarak DEĞİL.
   *
   * Bu, `CreativeRunComposition`'daki `TransitionSeries` yaklaşımından bilinçli
   * bir ayrılış: TransitionSeries geçiş karelerini TÜKETİR (bu yüzden
   * `timelineDurationInFrames` bindirmeyi çıkarmak zorunda). Çok kanallı modelde
   * bu ölümcül olurdu — overlay'in mutlak zamanı video kanalıyla eşleşmezdi.
   */
  startSec: Sec;
  durationSec: Sec;
  media: MediaRef;
  motion?: KenBurns;
  transitionIn?: TransitionSpec;
  fit: "cover" | "contain";
  /** 16:9 kaynağı 9:16'ya yeniden çerçeveleme — 0..1 normalize merkez. */
  focus?: { x: number; y: number };
  /** Aşama B. */
  speed?: number;
  /**
   * Lip-sync DİKİŞİ — henüz hiçbir model bağlı değil. `AiScene.speaking`den
   * taşınıyor (bkz. `lib/agents/video/kurguCore.ts`); render katmanı bu alanı
   * OKUMUYOR. Amaç: gelecekteki lip-sync entegrasyonunun iş listesini
   * (hangi klipler konuşma gerektiriyor) şimdiden hazır bırakmak.
   */
  lipSync?: boolean;
}

// ---- Overlay kanalı --------------------------------------------------------

export interface CaptionWord {
  text: string;
  startSec: Sec;
  endSec: Sec;
  /** Direktörün vurgu işareti — zoom-punch ve renk vurgusu bunu okur. */
  emphasis?: boolean;
}

export type CaptionStyleId = "capcut-bold" | "karaoke-pop" | "highlight-box" | "clean-sub";

export interface CaptionItem {
  kind: "caption";
  id: string;
  startSec: Sec;
  durationSec: Sec;
  /**
   * ÇÖZÜLMÜŞ zamanlar — çapa (Anchor) DEĞİL. Çapadan saniyeye çevirme
   * `lib/timeline/anchors.ts`'te, bu tip oluşturulmadan önce yapılır.
   * Render katmanı hiçbir zaman çapa görmez; yalnızca sayı görür.
   */
  words: CaptionWord[];
  styleId: CaptionStyleId;
  /** 0..1 normalize — kare boyutundan bağımsız. */
  position: { x: number; y: number };
  maxWidthPct: number;
  /** Yüksekliğe ORANLI (SlideComposition.tsx:67'deki k katsayısı deseni). */
  fontSizePct: number;
  color: string;
  highlightColor: string;
  strokeWidthPct: number;
}

export interface TitleItem {
  kind: "title";
  id: string;
  startSec: Sec;
  durationSec: Sec;
  text: string;
  styleId: "hook" | "lower-third" | "cta" | "stat";
  animation: "pop" | "slide-up" | "typewriter" | "none";
  position: { x: number; y: number };
  fontSizePct: number;
  color: string;
  boxColor?: string;
}

export interface StickerItem {
  kind: "sticker";
  id: string;
  startSec: Sec;
  durationSec: Sec;
  src: string;
  position: { x: number; y: number };
  scale: number;
}

export type OverlayItem = CaptionItem | TitleItem | StickerItem;

// ---- Watermark ---------------------------------------------------------

/**
 * "AI ile üretildi" gibi kalıcı bir beyan. BİLİNÇLİ OLARAK Track/overlay
 * DEĞİL, `VideoTimeline` KÖKÜNDE tek bir alan:
 *
 * 1. Süre tuzağı: `timelineDurationSec` en geç biten overlay'e bakıyor. Bir
 *    overlay olsaydı, watermark'ın süresi kliplerden bir kare bile uzun
 *    yazılırsa video uzar ve sonunda siyah kuyruk oluşurdu (tam olarak
 *    real-video/kurgu.ts'in ses için önlediği hata — burada da pusuda).
 *    Kökte durunca `timelineDurationSec` onu hiç görmüyor, tuzağa hiç girilmiyor.
 * 2. Watermark zamanlı bir OLAY değil, çıktının bir ÖZELLİĞİ. Track içinde
 *    olsaydı overlay'leri gezen her tüketici (compose.ts'in URL yazımı,
 *    qc.ts'in overlay sayımı) onu atlamayı bilmek zorunda kalırdı.
 */
export interface WatermarkSpec {
  text: string;
  position: "alt-orta" | "alt-sag" | "ust-sag";
  /** Yüksekliğe ORANLI — Captions/Title disiplini. */
  fontSizePct: number;
  opacity: number;
}

// ---- Ses kanalı ------------------------------------------------------------

export interface AudioItem {
  id: string;
  src: string;
  role: "voice" | "music" | "sfx";
  startSec: Sec;
  inSec: Sec;
  outSec: Sec;
  gain: number;
  fadeInSec?: Sec;
  fadeOutSec?: Sec;
}

// ---- Çizelge ---------------------------------------------------------------

export interface Track<T> {
  id: string;
  label: string;
  items: T[];
}

export interface VideoTimeline {
  version: 2;
  fps: number;
  width: number;
  height: number;
  /**
   * Metnin dili — BÜYÜK HARFE ÇEVİRME İÇİN ŞART, süsleme değil.
   *
   * Türkçe'de "i" → "İ", İngilizce'de "I". Locale sabit "tr" bırakıldığında
   * İngilizce copy "LİFTED", "TİNT", "FİRST" diye basılıyordu (canlı testte
   * ekrandan yakalandı). Çizelgede duruyor çünkü çizen taraf Remotion ve onun
   * proje config'ine erişimi yok — metinle birlikte seyahat etmesi gerekiyor.
   * Eski çizelgelerde alan yok; çizim tarafı "tr"ye düşüyor.
   */
  language?: "tr" | "en";
  /** Alttan üste çizim sırası: video[0] ana kurgu, video[1..] b-roll/PIP. */
  video: Track<ClipItem>[];
  /**
   * video'nun ÜSTÜNDE, aynı mutlak zaman ekseninde. Metnin bir geçişin
   * ÜZERİNDEN geçebilmesini sağlayan şey tam olarak bu ayrım.
   */
  overlays: Track<OverlayItem>[];
  /**
   * SES BURADA YALNIZCA ÖNİZLEME İÇİN. Nihai karışım (ducking, loudnorm,
   * limiter) ffmpeg'de — bkz. lib/media/ffmpeg.ts finishVideo(). compose aşaması
   * renderMedia'yı muteAudio:true ile çağırır. Tek karışım yetkisi olsun diye.
   */
  audio: Track<AudioItem>[];
  /** Kalıcı, tüm süre boyunca görünen beyan — bkz. WatermarkSpec üstündeki not. */
  watermark?: WatermarkSpec;
  durationSec: Sec;
  /** ffmpeg finisaj aşamasına taşınan BİLDİRİMSEL kurallar. */
  mix: {
    duck: {
      trigger: "voice";
      target: "music";
      ratio: number;
      thresholdDb: number;
      releaseMs: number;
    };
    loudnessLufs: number;
  };
}

// ---- Yardımcılar -----------------------------------------------------------

export const DEFAULT_MIX: VideoTimeline["mix"] = {
  duck: { trigger: "voice", target: "music", ratio: 8, thresholdDb: -26, releaseMs: 400 },
  loudnessLufs: -14,
};

/** Boş ama geçerli bir çizelge — mock ve testler için. */
export function emptyTimeline(width: number, height: number, fps = 30): VideoTimeline {
  return {
    version: 2,
    fps,
    width,
    height,
    video: [{ id: "v0", label: "Ana kurgu", items: [] }],
    overlays: [{ id: "o0", label: "Yazı", items: [] }],
    audio: [{ id: "a0", label: "Ses", items: [] }],
    durationSec: 0,
    mix: DEFAULT_MIX,
  };
}

/**
 * Süre, en geç biten öğeden türetilir — ayrı tutulan `durationSec` alanı
 * bununla tutarsız kalabilir, o yüzden tek doğrulama noktası burası.
 * `calculateMetadata` bunu kullanır.
 */
export function timelineDurationSec(t: VideoTimeline): Sec {
  let end = 0;
  for (const track of t.video) {
    for (const c of track.items) end = Math.max(end, c.startSec + c.durationSec);
  }
  for (const track of t.overlays) {
    for (const o of track.items) end = Math.max(end, o.startSec + o.durationSec);
  }
  // Ses videoyu UZATMAZ: müzik klibi kurgudan uzunsa video sonunda kesilir,
  // yoksa siyah kuyruk oluşurdu.
  return end;
}

export function timelineDurationInFrames(t: VideoTimeline): number {
  return Math.max(1, Math.round(timelineDurationSec(t) * t.fps));
}
