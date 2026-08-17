/**
 * Creative key — reklam adı, reklam grubu adı ve `utm_campaign` için TEK isimlendirme
 * sözleşmesi.
 *
 *     <projectSlug>__<aci>__<segment>__<runId>
 *     cariusb__aci-korku__mod-shop__run-1786549178449-8a9wx
 *
 * Reklam analizi yapan ayrı bir sistem varsa bu string'i aynı sözleşmeyle parse
 * edebilir — iki taraf birbirini import etmez, paylaşılan tek şey sözleşmedir.
 */

/** taksonomi.json → aci.values ile aynı küme. Orada değişirse burada da değişir. */
export const ACI_DEGERLERI = [
  "sonuc-kazanim",
  "aci-korku",
  "kimlik",
  "sosyal-kanit",
] as const;

export type CreativeKeyAci = (typeof ACI_DEGERLERI)[number];

export const CREATIVE_KEY_AYRAC = "__";

export interface CreativeKeyParts {
  projectSlug: string;
  aci: CreativeKeyAci;
  segment: string;
  runId: string;
}

/**
 * Alan içeriği kuralı: küçük harf, rakam ve tire. Türkçe karakter/boşluk/nokta yok —
 * bunlar URL'de kodlanır ve reklam panellerinde sessizce kırpılabilir.
 */
const ALAN_DESENI = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function alanGecerli(deger: string): boolean {
  return ALAN_DESENI.test(deger);
}

/**
 * Creative key üretir. Alanlardan biri sözleşmeye uymuyorsa **hata fırlatır** —
 * bozuk bir key üretip yayına çıkmak, sessizce eşleşmeyen bir reklam demektir ve
 * geriye dönük telafisi yoktur.
 */
export function buildCreativeKey(parts: CreativeKeyParts): string {
  const { projectSlug, aci, segment, runId } = parts;

  if (!alanGecerli(projectSlug)) {
    throw new Error(`Geçersiz projectSlug: "${projectSlug}" (küçük harf, rakam, tire)`);
  }
  if (!ACI_DEGERLERI.includes(aci)) {
    throw new Error(`Geçersiz aci: "${aci}" — ${ACI_DEGERLERI.join(" | ")}`);
  }
  if (!alanGecerli(segment)) {
    throw new Error(`Geçersiz segment: "${segment}" (küçük harf, rakam, tire)`);
  }
  if (!runId.startsWith("run-") || !alanGecerli(runId)) {
    throw new Error(`Geçersiz runId: "${runId}" — "run-" ile başlamalı`);
  }

  return [projectSlug, aci, segment, runId].join(CREATIVE_KEY_AYRAC);
}

/**
 * Creative key'i çözer. Emin değilse **null döner — TAHMİN ETMEZ.** Bulanık eşleştirme
 * yok: sözleşmeye uymayan ad "eşleşmemiş" sayılır ve raporda ayrı listelenir. Tahminle
 * eşleştirmek, elde olmayan bilgiyi varmış gibi kullanmaktır.
 */
export function parseCreativeKey(adName: string): CreativeKeyParts | null {
  const parts = adName.trim().split(CREATIVE_KEY_AYRAC);
  if (parts.length !== 4) return null;

  const [projectSlug, aci, segment, runId] = parts;
  if (!alanGecerli(projectSlug)) return null;
  if (!ACI_DEGERLERI.includes(aci as CreativeKeyAci)) return null;
  if (!alanGecerli(segment)) return null;
  if (!runId.startsWith("run-") || !alanGecerli(runId)) return null;

  return { projectSlug, aci: aci as CreativeKeyAci, segment, runId };
}

/**
 * Organik yayın için tam UTM sorgu dizesi. `utm_medium` ücretlide "cpc" olur — o
 * tarafı reklam paneli üretir, burada yalnızca organik yol var.
 */
export function buildUtmQuery(
  key: string,
  platform: "instagram" | "tiktok" | "youtube_shorts",
): string {
  const p = new URLSearchParams({
    utm_source: platform,
    utm_medium: "organic",
    utm_campaign: key,
  });
  return p.toString();
}
