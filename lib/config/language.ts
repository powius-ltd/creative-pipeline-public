/**
 * ÇIKTI DİLİ.
 *
 * Hat başlangıçta Türkçe'ye çivilenmişti ("Türkçe yaz" prompt'lara gömülüydü ve
 * karakter/saniye sabiti Türkçe'ye kalibreydi). Yurt dışındaki bir marka için
 * koşulduğunda bu sessizce yanlış dilde copy üretiyordu — hata vermeden, ki en
 * kötü kırılma biçimi bu.
 *
 * AYRIM ÖNEMLİ: dil YALNIZCA İZLEYİCİYE GİDEN metni bağlar (voiceLine,
 * onScreenText, caption, hashtag, hook, CTA, slide metni). Ajanların İÇ
 * ÜRETİMİ — sahne niyeti, aranan çekim tarifi, hücre gerekçesi, copy/tema yönü —
 * TÜRKÇE kalır, çünkü onları izleyici değil OPERATÖR okuyor (materyal seçerken
 * `shotIdea`'yı okuyan kişi Türkçe konuşuyor). İkisini tek bayrakla ezmek
 * operatörün kendi arayüzünü yabancı dile çevirirdi.
 */

export type Language = "tr" | "en";

/** Mevcut projelerin config.json'ında `language` alanı yok — onlar Türkçe kalır. */
export const DEFAULT_LANGUAGE: Language = "tr";

interface LanguageSpec {
  /** Arayüzde ve prompt'ta görünen ad. */
  label: string;
  /** Ajan prompt'larının sonuna eklenen yazım talimatı. */
  writeInstruction: string;
  /**
   * Seslendirme hızı tahmini — sahne süresi ile metin uzunluğu arasındaki köprü.
   * İki yerde kullanılıyor: copywriter'a "bu sahneye kaç karakter sığar" derken
   * ve gerçek ses ölçülemediğinde süre tahmininde.
   */
  charsPerSecond: number;
  /** "AI ile üretildi" watermark'ının izleyiciye giden metni. */
  watermarkText: string;
}

const SPECS: Record<Language, LanguageSpec> = {
  tr: {
    label: "Türkçe",
    writeInstruction:
      "İzleyiciye giden tüm metni TÜRKÇE yaz. Klişe pazarlama dilinden kaçın; " +
      "somut ve doğrudan ol.",
    charsPerSecond: 14,
    watermarkText: "AI ile üretildi",
  },
  en: {
    label: "İngilizce (ABD)",
    writeInstruction:
      "DİL KURALI — bu marka ABD'de faaliyet gösteriyor:\n" +
      "- İZLEYİCİYE GİDEN her metin İNGİLİZCE (ABD) olacak: seslendirme metni, " +
      "ekran metni, caption, hashtag'ler, hook ve CTA. Doğal, akıcı Amerikan " +
      "İngilizcesi — çeviri kokmasın, klişe pazarlama dilinden kaçın.\n" +
      "- SENİN İÇ ÜRETİMİN TÜRKÇE kalsın: hücre gerekçesi, copy yönü, tema yönü, " +
      "sahne niyeti ve aranacak çekim tarifi. Bunları izleyici değil, materyali " +
      "seçen Türk operatör okuyor.",
    charsPerSecond: 15,
    watermarkText: "Made with AI",
  },
};

export function languageSpec(lang: Language | undefined): LanguageSpec {
  return SPECS[lang ?? DEFAULT_LANGUAGE];
}

export function isLanguage(value: unknown): value is Language {
  return value === "tr" || value === "en";
}
