/**
 * EN-BOY ORANI — ortak kimlik, ayrı piksel tabloları.
 *
 * İki tarafın (carousel görselleri, real-video/ai-video render'ı) piksel
 * kısıtı BAMBAŞKA:
 *   - fal `image_size`: her iki kenar da 16'nın katı olmak ZORUNDA
 *     (1080 ÷ 16 = 67.5, kullanılamaz). Toplam piksel 655.360–8.294.400 bandında.
 *   - h264: yalnızca ÇİFT sayı ister, 16-katı kısıtı yok — sektör standardı 1080×1920.
 *
 * Bu yüzden tabloları BİRLEŞTİRMİYORUZ. Bunun yerine ortak bir *oran kimliği*
 * veriyoruz (`"9:16"` gibi) ve her tarafın kendi piksel karşılığını bu dosyada
 * bir kez tanımlıyoruz. Kimlik zaten fal kontext endpoint'inin istediği
 * `aspect_ratio` string'i — yani `ChannelPreset.aspectRatio`'nun elle senkronu
 * (eskiden width/height'tan bağımsız, ayrı bir alandı) burada yapısal olarak
 * ortadan kalkıyor: artık TÜRETİLEN değil, TÜRETEN alan.
 */

export type AspectRatioId = "9:16" | "4:5" | "1:1";

export interface AspectSpec {
  id: AspectRatioId;
  label: string;
  /** fal `image_size` — carousel görselleri, karakter/sahne referans üretimi. */
  still: { width: number; height: number };
  /** h264 — real-video/ai-video render çıktısı. */
  video: { width: number; height: number };
}

const SPECS: Record<AspectRatioId, AspectSpec> = {
  "9:16": {
    id: "9:16",
    label: "9:16 — dikey",
    still: { width: 1152, height: 2048 },
    video: { width: 1080, height: 1920 },
  },
  "4:5": {
    id: "4:5",
    label: "4:5 — dikey (Instagram gönderisi)",
    still: { width: 1088, height: 1360 },
    video: { width: 1080, height: 1350 },
  },
  "1:1": {
    id: "1:1",
    label: "1:1 — kare",
    still: { width: 1088, height: 1088 },
    video: { width: 1080, height: 1080 },
  },
};

/**
 * Tablonun doğruluğu MODÜL YÜKLENİRKEN bir kez sınanıyor — `assertModeConsistent`
 * ile aynı desen. Amaç: bir kısıt ihlali (yanlış piksel eklendi) burada AÇIK bir
 * başlangıç hatasına dönüşsün, üretimde sessiz bir fal 422'sine değil.
 */
function assertAspectTable() {
  const FAL_MIN_PX = 655_360;
  const FAL_MAX_PX = 8_294_400;

  for (const spec of Object.values(SPECS)) {
    const [rw, rh] = spec.id.split(":").map(Number);
    const targetRatio = rw / rh;

    if (spec.still.width % 16 !== 0 || spec.still.height % 16 !== 0) {
      throw new Error(
        `AspectSpec '${spec.id}': still boyutu (${spec.still.width}×${spec.still.height}) ` +
          `16'nın katı değil — fal image_size kuralını ihlal ediyor.`,
      );
    }
    const stillPx = spec.still.width * spec.still.height;
    if (stillPx < FAL_MIN_PX || stillPx > FAL_MAX_PX) {
      throw new Error(
        `AspectSpec '${spec.id}': still piksel sayısı (${stillPx}) fal bandının ` +
          `(${FAL_MIN_PX}–${FAL_MAX_PX}) dışında.`,
      );
    }
    if (spec.video.width % 2 !== 0 || spec.video.height % 2 !== 0) {
      throw new Error(
        `AspectSpec '${spec.id}': video boyutu (${spec.video.width}×${spec.video.height}) ` +
          `çift sayı değil — h264 tek sayılı boyut kabul etmiyor.`,
      );
    }
    for (const [kind, dim] of [
      ["still", spec.still],
      ["video", spec.video],
    ] as const) {
      const actualRatio = dim.width / dim.height;
      if (Math.abs(actualRatio - targetRatio) > 0.001) {
        throw new Error(
          `AspectSpec '${spec.id}': ${kind} boyutu (${dim.width}×${dim.height}) ` +
            `orana (${spec.id}) tam uymuyor.`,
        );
      }
    }
  }
}
assertAspectTable();

export function aspectSpec(id: AspectRatioId): AspectSpec {
  return SPECS[id];
}

export function isAspectRatioId(value: unknown): value is AspectRatioId {
  return typeof value === "string" && value in SPECS;
}

export const ASPECT_RATIO_IDS: AspectRatioId[] = Object.keys(SPECS) as AspectRatioId[];
