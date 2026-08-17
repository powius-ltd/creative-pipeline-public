import { continueRender, delayRender, staticFile } from "remotion";

/**
 * FONT YÜKLEME — render'ın ilk karesinden ÖNCE tamamlanmak zorunda.
 *
 * Neden var: `remotion/carousel/SlideComposition.tsx` bugüne kadar
 * `'"Segoe UI", system-ui, sans-serif'` kullanıyordu ve HİÇBİR font yüklemesi
 * yoktu. Headless Chromium'da Segoe UI kurulu değil — yani carousel PNG'leri
 * sessizce yedek fontla basılıyordu ve bu kimseye hata olarak görünmüyordu.
 *
 * `delayRender`/`continueRender` şart: onlarsız kare 0 yedek fontla basılır ve
 * videonun ilk ~200ms'i farklı metriklerde görünür (yazı zıplar).
 *
 * TÜRKÇE İÇİN İKİ ALT KÜME DE ZORUNLU (Google Fonts'un bölümlemesi):
 *   latin     → ç U+00E7, ö U+00F6, ü U+00FC ve — dikkat — ı U+0131
 *   latin-ext → ğ U+011F, İ U+0130, ş U+015F
 * Yalnızca latin-ext yüklenirse "ı" kaybolur; yalnızca latin yüklenirse
 * "ğ/İ/ş" kaybolur. İkisi aynı aileye farklı unicode-range ile ekleniyor.
 */

const SUBSETS: { file: string; unicodeRange: string }[] = [
  {
    file: "fonts/montserrat-latin.woff2",
    unicodeRange:
      "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC," +
      "U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193," +
      "U+2212,U+2215,U+FEFF,U+FFFD",
  },
  {
    file: "fonts/montserrat-latin-ext.woff2",
    unicodeRange:
      "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304," +
      "U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB," +
      "U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  },
];

export const FONT_FAMILY = "Montserrat";

/** Kompozisyonlarda `fontFamily` olarak bunu kullan — çıplak string değil. */
export const DISPLAY_FONT = `"${FONT_FAMILY}", system-ui, -apple-system, sans-serif`;

/**
 * Modül yüklenirken bir kez koşar. Tarayıcı dışı bir bağlamdan (SSR, test)
 * import edilirse sessizce atlanır — `delayRender` orada zaten anlamsız.
 */
if (typeof document !== "undefined" && typeof FontFace !== "undefined") {
  for (const subset of SUBSETS) {
    const handle = delayRender(`font yükleniyor: ${subset.file}`);
    const face = new FontFace(
      FONT_FAMILY,
      `url(${staticFile(subset.file)}) format("woff2")`,
      {
        // Değişken ağırlık: tek dosya 400-900 arasını karşılıyor, bu yüzden
        // hook için 800-900, altyazı için 700 ayrı dosya istemiyor.
        weight: "400 900",
        style: "normal",
        unicodeRange: subset.unicodeRange,
      },
    );

    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        continueRender(handle);
      })
      .catch(() => {
        // Font yüklenemese bile render'ı KİLİTLEME — yedek fontla çirkin bir
        // çıktı, hiç çıktı olmamasından iyidir. Sessiz kalmasın diye konsola not.
        console.warn(`[fonts] yüklenemedi: ${subset.file} — yedek fonta düşülüyor`);
        continueRender(handle);
      });
  }
}
