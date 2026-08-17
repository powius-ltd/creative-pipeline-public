import { aspectSpec, type AspectSpec } from "../../config/aspect";
import { runAspect } from "../descriptors";
import type { ModeId, Platform, RunState } from "../../orchestrator/types";

/**
 * Kanal başına carousel kuralları.
 *
 * Boyut BURADA DEĞİL — `lib/config/aspect.ts`'te, run'a bağlı (`state.aspect`,
 * kullanıcı kararı gereği run başına seçiliyor). Bu dosyada yalnızca kanalın
 * KARAKTERİ kalıyor: caption/hashtag sınırları, slide sayısı, ses tonu.
 */
export interface ChannelPreset {
  label: string;
  minSlides: number;
  maxSlides: number;
  /** Sahne verisi yokken maliyet tahmini için. */
  assumedSlides: number;
  captionMaxChars: number;
  hashtagMin: number;
  hashtagMax: number;
  /** Planner ve copywriter promptlarına giren kanal karakteri — CAROUSEL için. */
  voiceNote: string;
  /**
   * Aynı kanalın VİDEO karakteri.
   *
   * Ayrı durmak zorunda: bu dosya carousel için yazıldı ama `runKonsept` ve
   * real-video'nun planner/copywriter'ı da buradan besleniyor. Tek `voiceNote`
   * varken real-video run'ları prompt'a "Instagram carousel: kaydırma derinliği
   * ödüllendirilir" cümlesini alıyordu ve stratejist brief'i SLAYT diliyle
   * yazıyordu (canlı testte yakalandı) — sessiz bir bozulma, çünkü çıktı geçerli
   * görünüyor, yalnızca yanlış mecra için yazılmış oluyor.
   */
  videoVoiceNote: string;
}

const IG: ChannelPreset = {
  label: "Instagram",
  minSlides: 3,
  maxSlides: 10,
  assumedSlides: 6,
  captionMaxChars: 2200,
  hashtagMin: 5,
  hashtagMax: 15,
  voiceNote:
    "Instagram carousel: kaydırma derinliği ödüllendirilir, bilgi yoğunluğu taşınabilir. " +
    "Caption uzun olabilir ve kaydetmeye/paylaşmaya davet etmeli. Hashtag'ler sona toplanır.",
  videoVoiceNote:
    "Instagram Reels: dikey video. İlk 3 saniye kaydırmayı durdurmak zorunda. " +
    "Sessiz izlenme ihtimali yüksek — ekran metni tek başına anlaşılmalı, seslendirmenin " +
    "tekrarı olmamalı. Caption uzun olabilir ve kaydetmeye/paylaşmaya davet etmeli.",
};

const VERTICAL_SHORT: Omit<
  ChannelPreset,
  "label" | "voiceNote" | "videoVoiceNote"
> = {
  minSlides: 3,
  maxSlides: 8,
  assumedSlides: 5,
  captionMaxChars: 2200,
  hashtagMin: 3,
  hashtagMax: 6,
};

export const CHANNEL_PRESETS: Record<Platform, ChannelPreset> = {
  instagram: IG,
  tiktok: {
    ...VERTICAL_SHORT,
    label: "TikTok",
    voiceNote:
      "TikTok foto carousel: ilk kare 1 saniyede kavramalı, aksi halde kaydırılır. " +
      "Metin kısa ve konuşma dilinde; reklam tonundan kaçın. Hashtag az ve öz.",
    videoVoiceNote:
      "TikTok videosu: ilk saniyede kavramalı, aksi halde kaydırılır. Ses genelde " +
      "AÇIK izlenir, seslendirme anlatının taşıyıcısıdır. Konuşma dili; reklam " +
      "tonundan kaçın. Hashtag az ve öz.",
  },
  youtube_shorts: {
    ...VERTICAL_SHORT,
    maxSlides: 6,
    assumedSlides: 4,
    label: "YouTube Shorts",
    voiceNote:
      "YouTube Shorts dikey format: başlık ağırlıklı, arama odaklı okunur. " +
      "Metin açıklayıcı ve net olmalı, merak boşluğu bırakmadan bilgi vermeli.",
    videoVoiceNote:
      "YouTube Shorts videosu: arama odaklı izlenir, ilk cümle ne öğrenileceğini " +
      "net söylemeli. Açıklayıcı ve doğrudan; merak boşluğuyla oyalamadan bilgi ver.",
  },
  other: {
    ...IG,
    label: "Genel",
    voiceNote:
      "Belirli bir platforma bağlı değil: 4:5 güvenli oran, dengeli metin uzunluğu.",
    videoVoiceNote:
      "Belirli bir platforma bağlı değil: dikey 9:16 kısa video, ilk saniyeler kritik.",
  },
};

export function channelPreset(platform: Platform | undefined): ChannelPreset {
  // platform alanı olmayan eski run'lar için güvenli varsayılan.
  return CHANNEL_PRESETS[platform ?? "other"] ?? CHANNEL_PRESETS.other;
}

/**
 * Bu run'ın carousel görselleri için piksel/oran karşılığı. `runAspect` eski
 * run'larda (`state.aspect` yok) moda+platforma göre bugünkü davranışa (Instagram
 * 4:5, diğerleri 9:16) düşer — `channelPreset`'in kendi eski-run notuyla aynı
 * disiplin.
 */
export function carouselAspect(
  state: Pick<RunState, "mode" | "platform" | "aspect">,
): AspectSpec {
  return aspectSpec(runAspect(state));
}

/**
 * Kanal karakterini MODA GÖRE seçer.
 *
 * Prompt'a hangi cümlenin gireceği moda bağlı: aynı Instagram, carousel'de
 * "kaydırma derinliği", Reels'te "ilk 3 saniye". Çağıranların `mode`'a bakıp
 * doğru alanı seçmesi gerekseydi, yeni bir video modu eklendiğinde birinin
 * unutulması kaçınılmazdı.
 */
export function channelVoiceNote(
  platform: Platform | undefined,
  mode: ModeId,
): string {
  const preset = channelPreset(platform);
  return mode === "carousel" ? preset.voiceNote : preset.videoVoiceNote;
}
