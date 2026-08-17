import { normalizeTr, type WordStamp } from "../audio/words";

/**
 * SEMBOLİK ÇAPA → SANİYE.
 *
 * Kreatif direktör mutlak timecode ÜRETMEZ. İki sebep:
 *   1. LLM zaman aritmetiği güvenilmez — "4.2'de kes" der, kelime 4.7'de biter,
 *      sesi ortasından kesersin.
 *   2. Sabit sayı kırılgandır — copy'de tek kelime değişince tüm kurgu bozulur.
 *
 * Bunun yerine direktör NİYETİ söyler ("bu kelimede zoom punch"), bu modül
 * sayıyı ÇÖZER. Copy düzeltilince timecode'lar kendiliğinden yeniden hesaplanır.
 *
 * İstisna: `{ at: "absolute" }`. Bunu yalnızca ÖLÇÜM ajanı yazabilir (ffprobe /
 * scdet / Gemini çıktısı gibi gözlenmiş değerler). LLM'in doğrudan yazdığı bir
 * plan içinde absolute görülürse bu bir hatadır — `resolveEvents` uyarı üretir.
 */

export interface SceneTiming {
  sceneId: string;
  /** Sahnenin GLOBAL eksendeki başlangıcı. */
  startSec: number;
  endSec: number;
  /** Sahne-göreli DEĞİL, global eksene kaydırılmış kelimeler. */
  words: WordStamp[];
}

export interface TimingContext {
  fps: number;
  scenes: SceneTiming[];
  /** Müzik vuruşları — Aşama B. */
  beats?: number[];
}

export type Anchor =
  | { at: "scene-start"; sceneId: string; offsetSec?: number }
  | { at: "scene-end"; sceneId: string; offsetSec?: number }
  | { at: "word"; sceneId: string; wordIndex: number; edge: "start" | "end"; offsetSec?: number }
  | {
      at: "phrase";
      sceneId: string;
      text: string;
      /** Aynı ifade birden çok geçiyorsa kaçıncısı (1 tabanlı). Varsayılan 1. */
      occurrence?: number;
      edge: "start" | "end";
      offsetSec?: number;
    }
  | { at: "beat"; index: number }
  | { at: "absolute"; sec: number };

export interface Resolution {
  sec: number;
  /** false ise geri düşüş kullanıldı — çağıran bunu uyarı olarak yükseltmeli. */
  exact: boolean;
  note: string;
}

function sceneOf(ctx: TimingContext, sceneId: string): SceneTiming | undefined {
  return ctx.scenes.find((s) => s.sceneId === sceneId);
}

/** Hiçbir sahne bulunamazsa bile geçerli bir sayı üretebilmek için. */
function globalEnd(ctx: TimingContext): number {
  return ctx.scenes.reduce((m, s) => Math.max(m, s.endSec), 0);
}

/**
 * İfadeyi sahnenin kelime dizisinde arar. Kelime kelime kayarak karşılaştırır
 * (n-gram), çünkü ifade birden çok kelimeden oluşabilir.
 */
function findPhrase(
  words: WordStamp[],
  phrase: string,
  occurrence: number,
): { first: WordStamp; last: WordStamp } | null {
  const needle = phrase.split(/\s+/).map(normalizeTr).filter(Boolean);
  if (needle.length === 0) return null;

  const hay = words.map((w) => normalizeTr(w.text));
  let seen = 0;

  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      seen++;
      if (seen === occurrence) {
        return { first: words[i], last: words[i + needle.length - 1] };
      }
    }
  }
  return null;
}

/**
 * Tam eşleşme yoksa TEK kelimelik en iyi kısmi eşleşmeyi dener — copy düzenlenmiş
 * ("üç ayda" → "3 ayda") ama niyet aynı olabilir. Bulursa exact:false döner.
 */
function findLooseWord(words: WordStamp[], phrase: string): WordStamp | null {
  const needle = normalizeTr(phrase.split(/\s+/)[0] ?? "");
  if (!needle) return null;
  return (
    words.find((w) => normalizeTr(w.text) === needle) ??
    words.find((w) => normalizeTr(w.text).startsWith(needle)) ??
    words.find((w) => needle.startsWith(normalizeTr(w.text))) ??
    null
  );
}

/**
 * ÇÖZÜMLEME ASLA THROW ETMEZ.
 *
 * Bir kelime değiştiği için run ölmemeli — sembolik çapanın bütün gerekçesi bu.
 * Bulunamayan her çapa en yakın makul zamana düşer ve `exact:false` + açıklayıcı
 * bir `note` ile döner; çağıran bunu ajanın `note`'una uyarı olarak ekler.
 */
export function resolveAnchor(a: Anchor, ctx: TimingContext): Resolution {
  const clamp = (sec: number): number => Math.max(0, sec);

  switch (a.at) {
    case "absolute":
      return { sec: clamp(a.sec), exact: true, note: "" };

    case "beat": {
      const beats = ctx.beats ?? [];
      const b = beats[a.index];
      if (b === undefined) {
        return {
          sec: 0,
          exact: false,
          note: `beat[${a.index}] yok (vuruş analizi Aşama B) — 0'a düşüldü.`,
        };
      }
      return { sec: clamp(b), exact: true, note: "" };
    }

    case "scene-start":
    case "scene-end": {
      const s = sceneOf(ctx, a.sceneId);
      if (!s) {
        return {
          sec: clamp(globalEnd(ctx)),
          exact: false,
          note: `Sahne '${a.sceneId}' bulunamadı — kurgu sonuna düşüldü.`,
        };
      }
      const base = a.at === "scene-start" ? s.startSec : s.endSec;
      return { sec: clamp(base + (a.offsetSec ?? 0)), exact: true, note: "" };
    }

    case "word": {
      const s = sceneOf(ctx, a.sceneId);
      if (!s) {
        return {
          sec: clamp(globalEnd(ctx)),
          exact: false,
          note: `Sahne '${a.sceneId}' bulunamadı — kurgu sonuna düşüldü.`,
        };
      }
      const w = s.words[a.wordIndex];
      if (!w) {
        // Kelime indeksi taştıysa sahnenin ucuna yaslıyoruz; copy kısalmış olabilir.
        const fallback = a.wordIndex <= 0 ? s.startSec : s.endSec;
        return {
          sec: clamp(fallback + (a.offsetSec ?? 0)),
          exact: false,
          note:
            `'${a.sceneId}' sahnesinde kelime #${a.wordIndex} yok ` +
            `(${s.words.length} kelime var) — sahne ${a.wordIndex <= 0 ? "başına" : "sonuna"} düşüldü.`,
        };
      }
      const base = a.edge === "start" ? w.startSec : w.endSec;
      return { sec: clamp(base + (a.offsetSec ?? 0)), exact: true, note: "" };
    }

    case "phrase": {
      const s = sceneOf(ctx, a.sceneId);
      if (!s) {
        return {
          sec: clamp(globalEnd(ctx)),
          exact: false,
          note: `Sahne '${a.sceneId}' bulunamadı — kurgu sonuna düşüldü.`,
        };
      }
      const hit = findPhrase(s.words, a.text, a.occurrence ?? 1);
      if (hit) {
        const base = a.edge === "start" ? hit.first.startSec : hit.last.endSec;
        return { sec: clamp(base + (a.offsetSec ?? 0)), exact: true, note: "" };
      }

      const loose = findLooseWord(s.words, a.text);
      if (loose) {
        const base = a.edge === "start" ? loose.startSec : loose.endSec;
        return {
          sec: clamp(base + (a.offsetSec ?? 0)),
          exact: false,
          note:
            `"${a.text}" birebir bulunamadı ('${a.sceneId}') — ` +
            `en yakın kelime "${loose.text}" kullanıldı. Copy düzenlenmiş olabilir.`,
        };
      }

      return {
        sec: clamp(s.startSec + (a.offsetSec ?? 0)),
        exact: false,
        note: `"${a.text}" '${a.sceneId}' sahnesinde hiç bulunamadı — sahne başına düşüldü.`,
      };
    }
  }
}

/**
 * Direktörün ürettiği olay listesi. `tip` kapalı bir sözcük dağarcığından gelir
 * (zoom-punch, altyazi, baslik, sfx...), `capa` ise sembolik zamanı taşır.
 */
export interface AnchoredEvent {
  tip: string;
  capa: Anchor;
  /** Olayın süresi — saniye. Zamanlamadan bağımsız olduğu için doğrudan geçer. */
  sure?: number;
  [k: string]: unknown;
}

export interface ResolvedEvent extends Omit<AnchoredEvent, "capa"> {
  startSec: number;
  /** Çözümleme kesin miydi — QC ve loglama için taşınıyor. */
  exact: boolean;
}

export function resolveEvents(
  events: AnchoredEvent[],
  ctx: TimingContext,
): { resolved: ResolvedEvent[]; warnings: string[] } {
  const resolved: ResolvedEvent[] = [];
  const warnings: string[] = [];

  for (const ev of events) {
    // `capa` burada ayrıştırılıyor: hem çözümlemeye girdi, hem de sonuçtan
    // çıkarılıyor — render katmanı çapa görmemeli, yalnızca sayı görmeli.
    const { capa, ...rest } = ev;

    const r = resolveAnchor(capa, ctx);
    if (!r.exact && r.note) warnings.push(`[${ev.tip}] ${r.note}`);

    // LLM planında absolute görülmemeli — gözlem ajanı dışında bu bir kaçak.
    if (capa.at === "absolute") {
      warnings.push(
        `[${ev.tip}] mutlak timecode (${capa.sec}s) kullanılmış — ` +
          `bu yalnızca ölçüm ajanına ait; LLM planındaysa sembolik çapaya çevrilmeli.`,
      );
    }

    resolved.push({ ...rest, startSec: r.sec, exact: r.exact });
  }

  // Zaman sırasına diz — direktör sırayı karıştırmış olabilir, render mutlak
  // zamana baktığı için sorun değil ama okunabilirlik ve QC için faydalı.
  resolved.sort((a, b) => a.startSec - b.startSec);

  return { resolved, warnings };
}
