import type { VideoTimeline } from "./timeline";

/**
 * DİLE DUYARLI BÜYÜK HARF.
 *
 * `toUpperCase()` yerine locale'li çağrı ŞART çünkü Türkçe'nin noktalı/noktasız
 * i ayrımı var: "istanbul" → Türkçe'de "İSTANBUL", İngilizce'de "ISTANBUL".
 * Locale sabit "tr" olarak yazılmıştı ve İngilizce copy ekrana "LİFTED",
 * "TİNT", "FİRST-TIMERS" diye basılıyordu — sessiz bir bozulma, çünkü render
 * hatasız tamamlanıyor, yanlışlık yalnızca gözle görülüyor.
 *
 * Tek yerde toplanmasının sebebi: aynı dönüşüm hem altyazıda (Captions) hem
 * başlıkta (Title) yapılıyor ve ikisinin ayrışması, videoda yarısı doğru
 * yarısı yanlış bir metin üretirdi.
 */
export function upper(text: string, language: VideoTimeline["language"]): string {
  return text.toLocaleUpperCase(language === "en" ? "en-US" : "tr");
}
