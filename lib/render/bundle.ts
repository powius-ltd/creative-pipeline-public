import path from "node:path";

/**
 * @remotion/bundler ve @remotion/renderer BİLİNÇLİ OLARAK tembel import ediliyor.
 *
 * Statik import edilirlerse şu zincir oluşuyor:
 *   app/page.tsx → runStore → cost/estimate → modes → carousel/compose → renderer
 * ve Next, sadece proje listesini gösteren bir sayfa için bile renderer'ı modül
 * grafiğine alıyor. Renderer platforma özel native compositor binary'lerini koşullu
 * require ettiği için derleyici HEPSİNİ (darwin/linux/win32) çözmeye kalkıyor ve bu
 * platformda kurulu olmayanlarda "Module not found" üretiyor. Tembel import zinciri
 * kökten kesiyor: modüller yalnızca gerçekten render yapılırken yükleniyor.
 * (next.config.ts'teki serverExternalPackages ikinci savunma hattı olarak duruyor.)
 *
 * Bu dosya `still.ts`'ten ÇIKARILDI çünkü artık iki tüketicisi var: `renderSlideStill`
 * (carousel, tek kare PNG) ve `renderRunVideo` (real-video, mp4). Bundle'ın süreç
 * başına TEK olması şart — iki ayrı cache iki ayrı 10-30sn'lik kurulum demekti.
 */

/**
 * Bundle PROCESS BAŞINA BİR KEZ kuruluyor ve promise olarak cache'leniyor.
 * Slide/video başına bundle etmek kabul edilemez yavaş olurdu (bundle ~10-30sn).
 *
 * İlk render'da Remotion headless Chrome indirir (~150MB, tek seferlik) — o çağrı
 * dakikalar sürebilir; hata değil.
 */
let bundlePromise: Promise<string> | null = null;

export function getServeUrl(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({
        entryPoint: path.resolve(process.cwd(), "remotion", "index.ts"),
      });
    })().catch((err) => {
      // Başarısız bundle'ı cache'te bırakmayalım; sonraki deneme yeniden kursun.
      bundlePromise = null;
      throw err;
    });
  }
  return bundlePromise;
}
