/**
 * KARAKTER HİZALAMASI → KELİME DAMGASI.
 *
 * ElevenLabs'in `/with-timestamps` uç noktası karakter bazlı hizalama döndürüyor
 * ve `lib/agents/voice.ts` bunu `{sceneId}.timecodes.json` olarak zaten diske
 * yazıyor — ama kod tabanında okuyan kimse yoktu. CapCut görünümünün imzası olan
 * her şey (kelime kelime altyazı, vurgu anında zoom punch, ritmik kesme) bu
 * veriye bağlı; bu dosya onu kullanılabilir hale getiriyor.
 */

export interface CharAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  /** ElevenLabs veriyor ama sözleşmede garanti değil — savunmacı davranıyoruz. */
  character_end_times_seconds?: number[];
}

export interface WordStamp {
  index: number;
  /** Görüntülenecek hâli — noktalama dahil, Türkçe diakritikler korunur. */
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * Son kelimenin bitişi bilinmiyorsa ona verilen asgari süre. Sıfır bırakmak
 * altyazıyı görünmez yapardı.
 */
const TAIL_SEC = 0.05;

/**
 * Eşleştirme anahtarı. Çapa çözücü (`lib/timeline/anchors.ts`) copy'deki bir
 * ifadeyi seslendirilmiş kelimelerle karşılaştırırken bunu kullanır.
 *
 * Türkçe tuzağı: `toLowerCase()` İ→"i̇" (i + birleşen nokta) üretir ve I→"i"
 * yapar; ikisi de eşleşmeyi bozar. Bu yüzden İ ve I'yı ÖNCE elle eşliyoruz.
 * Unicode normalizasyonu (NFC) da şart — "ğ" tek kod noktası olarak da,
 * "g + birleşen breve" olarak da gelebilir.
 */
export function normalizeTr(s: string): string {
  return s
    .normalize("NFC")
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr")
    // Noktalama atılır ama harf/rakam ve kelime içi kesme işareti korunur
    // ("Türkiye'nin" tek kelimedir).
    .replace(/[^\p{L}\p{N}']/gu, "")
    .replace(/^'+|'+$/g, "");
}

/**
 * Karakter dizisini kelimelere böler.
 *
 * `\w` veya `\b` KULLANILMAZ — ikisi de ASCII tabanlı ve `ğüşıöçİ`'yi kelime
 * sınırı sanar, yani "güneş" üç parçaya bölünür. Sınır yalnızca BOŞLUKtur.
 * Tireli bileşikler ve kesme işaretli ekler tek kelime kalır.
 */
export function wordsFromCharAlignment(a: CharAlignment): WordStamp[] {
  const chars = a.characters ?? [];
  const starts = a.character_start_times_seconds ?? [];
  const ends = a.character_end_times_seconds;

  const out: WordStamp[] = [];
  let buf = "";
  let bufStart = -1;
  let bufLastIdx = -1;

  /** Biriken karakterleri bir kelime olarak kapatır. */
  const flush = (nextCharStart: number | undefined) => {
    if (!buf || bufStart < 0) {
      buf = "";
      bufStart = -1;
      bufLastIdx = -1;
      return;
    }
    // Bitiş önceliği: (1) gerçek karakter bitişi, (2) sonraki karakterin
    // başlangıcı — boşluk süresi kelimeye dahil olur ama boşluk kısa olduğu için
    // altyazıda sorun değil, (3) kuyruk payı.
    let end = ends?.[bufLastIdx];
    if (end === undefined || !Number.isFinite(end)) {
      end = nextCharStart !== undefined && Number.isFinite(nextCharStart)
        ? nextCharStart
        : bufStart + TAIL_SEC;
    }
    // Zaman geriye akamaz; bozuk hizalama gelirse kelimeyi yine de görünür tut.
    if (end <= bufStart) end = bufStart + TAIL_SEC;

    out.push({ index: out.length, text: buf, startSec: bufStart, endSec: end });
    buf = "";
    bufStart = -1;
    bufLastIdx = -1;
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const start = starts[i];

    if (/\s/.test(ch)) {
      flush(Number.isFinite(start) ? start : undefined);
      continue;
    }

    if (bufStart < 0) {
      // Hizalamada delik varsa (start tanımsız) kelimeyi düşürmüyoruz —
      // bir öncekinin bitişine yaslıyoruz ki altyazıda boşluk oluşmasın.
      bufStart = Number.isFinite(start) ? start : (out.at(-1)?.endSec ?? 0);
    }
    buf += ch;
    bufLastIdx = i;
  }
  flush(undefined);

  return out;
}

/** Kelimelerin kapsadığı toplam süre — sahne uzunluğu türetmek için. */
export function wordsSpanSec(words: WordStamp[]): number {
  if (words.length === 0) return 0;
  return Math.max(0, words[words.length - 1].endSec - words[0].startSec);
}
