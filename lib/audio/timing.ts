import fsp from "node:fs/promises";
import path from "node:path";
import { languageSpec, type Language } from "../config/language";
import { probe } from "../media/ffmpeg";
import type { SceneTiming, TimingContext } from "../timeline/anchors";
import { wordsFromCharAlignment, type CharAlignment, type WordStamp } from "./words";

/**
 * SAHNE SESLERİNİ TEK GLOBAL ZAMAN EKSENİNE DİZER.
 *
 * Kurgu ajanı da, çapa çözücü de, altyazı katmanı da aynı ofsetleri görmek
 * zorunda — iki yerde ayrı hesaplanırsa altyazı sese göre kayar ve bu hata
 * sessizce ilerler. Bu yüzden ofset hesabı TEK FONKSİYONDA toplanıyor.
 *
 * RunState almıyoruz bilerek: modun payload tipine bağlanmak bu modülü
 * real-video'ya kilitlerdi. Çağıran taraf kendi payload'ını bu girdi şekline
 * çevirir (ince adaptör), böylece donmuş video modu da aynı boru hattını
 * kullanabilir.
 */

export interface TimingSceneInput {
  sceneId: string;
  /** Seslendirilecek metin — timecode yoksa oransal dağıtım için gerekli. */
  voiceLine: string;
  /** `state.assets.voice[sceneId]` — cwd'ye göreli. */
  voicePath?: string;
  /**
   * `{sceneId}.words.json`. Yoksa `voicePath`in yanındaki
   * `{sceneId}.timecodes.json`'dan türetilir.
   */
  wordsPath?: string;
  /** Ses hiç yoksa (mock) kullanılacak süre. */
  fallbackDurationSec?: number;
}

export interface BuildTimingOptions {
  fps: number;
  /** Sahneler arası nefes payı. CapCut'ta kesme serttir; varsayılan 0. */
  gapSec?: number;
  /** Yalnızca ses ölçülemediğinde devreye giren süre tahmini için. */
  language?: Language;
}

/** Ses de metin de yoksa sahnenin görünmez olmaması için asgari süre. */
const MIN_SCENE_SEC = 1.2;

function absOf(rel: string): string {
  return path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Kelimeleri üç kademeli olarak elde eder:
 *   1. `.words.json` (voice ajanının yazdığı hazır damgalar)
 *   2. `.timecodes.json` (ElevenLabs karakter hizalaması) → kelimeye çevir
 *   3. Hiçbiri yoksa → null (çağıran oransal dağıtıma düşer)
 */
async function loadWords(input: TimingSceneInput): Promise<WordStamp[] | null> {
  if (input.wordsPath) {
    const direct = await readJson<WordStamp[]>(absOf(input.wordsPath));
    if (direct && direct.length > 0) return direct;
  }

  if (input.voicePath) {
    const abs = absOf(input.voicePath);
    const dir = path.dirname(abs);
    const base = path.basename(abs, path.extname(abs));

    const sidecar = await readJson<WordStamp[]>(path.join(dir, `${base}.words.json`));
    if (sidecar && sidecar.length > 0) return sidecar;

    const align = await readJson<CharAlignment>(path.join(dir, `${base}.timecodes.json`));
    if (align?.characters?.length) {
      const words = wordsFromCharAlignment(align);
      if (words.length > 0) return words;
    }
  }

  return null;
}

/**
 * Timecode yoksa kelimeleri süreye ORANTILI dağıtır.
 *
 * Doğru değil ama BOŞ liste döndürmekten iyi: aşağı akış (altyazı, çapa çözücü)
 * hiçbir zaman kelimesiz sahne görmemeli, yoksa mock koşularda altyazı katmanı
 * tamamen kaybolur ve hata ancak gerçek seste fark edilir.
 *
 * Karakter sayısına göre paylaştırıyoruz — uzun kelime uzun sürer varsayımı,
 * eşit paylaştırmadan belirgin şekilde daha iyi.
 */
function distributeWords(voiceLine: string, durationSec: number): WordStamp[] {
  const tokens = voiceLine.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const weights = tokens.map((t) => Math.max(1, t.length));
  const total = weights.reduce((a, b) => a + b, 0);

  let cursor = 0;
  return tokens.map((text, index) => {
    const span = (weights[index] / total) * durationSec;
    const startSec = cursor;
    cursor += span;
    return { index, text, startSec, endSec: cursor };
  });
}

/** Sahnenin süresi: ses > kelime kapsamı > metinden tahmin > asgari. */
async function sceneDuration(
  input: TimingSceneInput,
  words: WordStamp[] | null,
  charsPerSecond: number,
): Promise<number> {
  if (input.voicePath) {
    try {
      // probe video akışı ister; ses dosyasında patlar. Bu yüzden hata yutuluyor
      // ve diğer kademelere düşülüyor — ses süresi "olsa iyi", "şart" değil.
      const p = await probe(absOf(input.voicePath));
      if (p.durationSec > 0) return p.durationSec;
    } catch {
      // sıradaki kademe
    }
  }

  if (words && words.length > 0) {
    const span = words[words.length - 1].endSec;
    if (span > 0) return span;
  }

  if (input.fallbackDurationSec && input.fallbackDurationSec > 0) {
    return input.fallbackDurationSec;
  }

  // Son çare: metin uzunluğundan tahmin. Hız dile göre değişiyor
  // (lib/config/language.ts) — gerçek ses ölçülebildiği anda bu satır zaten
  // devreden çıkıyor, o yüzden kabalığı sorun değil.
  const est = input.voiceLine.length / charsPerSecond;
  return Math.max(MIN_SCENE_SEC, est);
}

export async function buildTimingContext(
  scenes: TimingSceneInput[],
  opts: BuildTimingOptions,
): Promise<TimingContext> {
  const gap = opts.gapSec ?? 0;
  const charsPerSecond = languageSpec(opts.language).charsPerSecond;
  const out: SceneTiming[] = [];
  let cursor = 0;

  for (const input of scenes) {
    const loaded = await loadWords(input);
    const durationSec = await sceneDuration(input, loaded, charsPerSecond);

    // Kelimeler sahne-göreli geliyor; GLOBAL eksene kaydırıyoruz. Çapa çözücü
    // ve altyazı katmanı yalnızca global zaman görür.
    const words = (loaded ?? distributeWords(input.voiceLine, durationSec)).map((w, i) => ({
      index: i,
      text: w.text,
      startSec: cursor + w.startSec,
      endSec: cursor + w.endSec,
    }));

    out.push({
      sceneId: input.sceneId,
      startSec: cursor,
      endSec: cursor + durationSec,
      words,
    });

    cursor += durationSec + gap;
  }

  return { fps: opts.fps, scenes: out };
}
