import fs from "node:fs/promises";
import { readBrandMemory } from "../brand-memory/store";
import { buildCreativeKey, buildUtmQuery } from "../creative-key";
import { runKunyePath } from "./paths";
import { readRun } from "./runStore";
import type { PerformanceEntry, RunState } from "./types";

/**
 * Run künyesi — `runs/<runId>/kunye.md`.
 *
 * Bir creative'in kimliği (creative key), hangi kararla üretildiği (brief) ve yayından
 * sonra ne olduğu (performans) tek bir insan-okur dosyada birleşir. Reklam panelinde
 * `cariusb__aci-korku__mod-shop__run-1786549178449-8a9wx` görüp "bu neydi" diyen kişinin
 * gideceği tek yer burasıdır.
 *
 * **Bu dosya TÜRETİLMİŞTİR, kayıt değildir.** Kaynağı `state.json` + `brand-memory/
 * memory.json`; ikisi değiştikçe yeniden yazılır ve elle yapılan düzenleme kaybolur.
 * İkinci bir yazıcıya açık bırakmak, iki kaynaklı gerçek üretirdi.
 */

function tarih(iso: string): string {
  return iso.slice(0, 10);
}

/** Markdown tablo hücresinde `|` satırı bozar. */
function hucre(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v).replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function toplamMaliyet(run: RunState): number | null {
  if (!run.cost) return null;
  const satirlar = Object.values(run.cost.actual).flat();
  if (satirlar.length === 0) return null;
  return satirlar.reduce((t, l) => t + l.usd, 0);
}

/**
 * Performans kayıtlarını kanal + platform bazında ayırır ve **asla birleştirmez.**
 *
 * ads-analyst spec'inin 2. doğruluk kuralı: Meta ROAS'ı ile Google ROAS'ı toplanmaz,
 * atıf pencereleri farklıdır. Aynı gerekçe organik ile ücretliye de uygulanır —
 * organik "izlenme" ile ücretli "impressions" aynı şey değildir.
 */
function kanalaGoreAyir(entries: PerformanceEntry[]): Map<string, PerformanceEntry[]> {
  const gruplar = new Map<string, PerformanceEntry[]>();
  for (const e of entries) {
    const anahtar = e.platform ? `${e.kanal} / ${e.platform}` : e.kanal;
    const mevcut = gruplar.get(anahtar);
    if (mevcut) mevcut.push(e);
    else gruplar.set(anahtar, [e]);
  }
  return gruplar;
}

function performansTablosu(entries: PerformanceEntry[]): string[] {
  // Sütunlar kayıtlardan türer: metrik şeması kanala göre değişiyor ve sabitlenemez.
  const sutunlar = [...new Set(entries.flatMap((e) => Object.keys(e.metrics)))].sort();
  const satirlar: string[] = [];
  satirlar.push(`| tarih | ${sutunlar.join(" | ")} | not |`);
  satirlar.push(`|---|${sutunlar.map(() => "---").join("|")}|---|`);
  for (const e of [...entries].sort((a, b) => a.at.localeCompare(b.at))) {
    const degerler = sutunlar.map((s) =>
      e.metrics[s] === undefined ? "—" : hucre(e.metrics[s]),
    );
    satirlar.push(`| ${tarih(e.at)} | ${degerler.join(" | ")} | ${hucre(e.notes)} |`);
  }
  return satirlar;
}

export function renderKunye(
  run: RunState,
  entries: PerformanceEntry[],
  uretimZamani: string,
): string {
  const brief = run.brief ?? null;
  const secilen = run.variants.find((v) => v.id === run.chosenVariantId) ?? null;

  // Creative key ancak brief varsa üretilebilir: açı ve segment oradan gelir. Brief'siz
  // run'lar (eski run'lar, konsept aşaması olmayan modlar) key alamaz — uydurulmaz.
  let key: string | null = null;
  let keyHatasi: string | null = null;
  if (brief) {
    try {
      key = buildCreativeKey({
        projectSlug: run.projectSlug,
        aci: brief.aci,
        segment: brief.segment,
        runId: run.runId,
      });
    } catch (err) {
      keyHatasi = err instanceof Error ? err.message : String(err);
    }
  }

  const s: string[] = [];
  s.push(`# ${run.runId} — ${run.projectSlug}`);
  s.push("");
  s.push(
    `> **Bu dosya üretilir, elle düzenlenmez.** Kaynağı \`state.json\` ve ` +
      `\`brand-memory/memory.json\`; her performans girişinde yeniden yazılır.`,
  );
  s.push(`> Son üretim: ${uretimZamani}`);
  s.push("");

  s.push("## Creative key");
  s.push("");
  if (key) {
    s.push("```");
    s.push(key);
    s.push("```");
    s.push("");
    s.push(
      "Meta reklam adına, Google **reklam grubu** adına ve `utm_campaign`'e aynen bu " +
        "string girilir (bkz. lib/creative-key.ts).",
    );
    if (run.platform !== "other") {
      s.push("");
      s.push("Organik link:");
      s.push("");
      s.push("```");
      s.push(`?${buildUtmQuery(key, run.platform)}`);
      s.push("```");
    }
  } else if (keyHatasi) {
    s.push(`**Creative key üretilemedi:** ${keyHatasi}`);
    s.push("");
    s.push(
      "Bu run sözleşmeye uygun bir kimlik alamaz; yayınlanırsa performansı creative'e " +
        "geri bağlanamaz.",
    );
  } else {
    s.push(
      "**Creative key yok** — bu run'da konsept brief'i yok, açı ve segment bilinmiyor. " +
        "Uydurulmaz.",
    );
  }
  s.push("");

  s.push("## Künye");
  s.push("");
  s.push("| Alan | Değer |");
  s.push("|---|---|");
  s.push(`| Durum | ${hucre(run.status)} (aşama: ${hucre(run.stage)}) |`);
  s.push(`| Mod | ${hucre(run.mode)} |`);
  s.push(`| Platform | ${hucre(run.platform)} |`);
  s.push(`| Konu | ${hucre(run.topic)} |`);
  if (brief) {
    s.push(`| Açı | ${hucre(brief.aci)} |`);
    s.push(`| Segment | ${hucre(brief.segment)} |`);
    s.push(`| Funnel katmanı | ${hucre(brief.funnelKatmani)} |`);
    s.push(`| Değer bileşeni | ${hucre(brief.degerBileseni)} (${hucre(brief.cerceve)}) |`);
    s.push(`| İçerik tipi | ${hucre(brief.icerikTipi)} |`);
    s.push(`| Tetikleyici | ${hucre(brief.tetikleyici)} |`);
    s.push(`| 3 saniye testi | ${hucre(brief.ucSaniyeTesti)} |`);
  }
  s.push(`| Hook | ${hucre(secilen?.hook ?? brief?.secilenHook)} |`);
  s.push(`| CTA | ${hucre(secilen?.cta)} |`);
  s.push(`| QC | ${hucre(run.qc.verdict)} |`);
  const maliyet = toplamMaliyet(run);
  s.push(`| Gerçekleşen maliyet | ${maliyet === null ? "—" : `$${maliyet.toFixed(2)}`} |`);
  s.push(`| Oluşturma | ${tarih(run.createdAt)} |`);
  s.push("");

  if (brief && (brief.muhalifNotu || brief.yasaklar.length > 0)) {
    s.push("## Konsept notları");
    s.push("");
    if (brief.hucreGerekcesi) s.push(`**Hücre gerekçesi:** ${brief.hucreGerekcesi}`);
    if (brief.muhalifNotu) {
      s.push("");
      s.push(`**Muhalif notu:** ${brief.muhalifNotu}`);
    }
    if (brief.yasaklar.length > 0) {
      s.push("");
      s.push(`**Yasaklar:** ${brief.yasaklar.join(", ")}`);
    }
    s.push("");
  }

  s.push("## Performans");
  s.push("");
  if (entries.length === 0) {
    s.push("Henüz performans kaydı yok.");
    s.push("");
  } else {
    s.push(
      "> Kanallar ve platformlar **ayrı tablolarda** — toplanmaz. Meta ROAS'ı ile " +
        "Google ROAS'ı atıf pencereleri farklı olduğu için karşılaştırılamaz; organik " +
        "*izlenme* ile ücretli *impressions* de aynı şey değildir.",
    );
    s.push("");
    for (const [baslik, grup] of kanalaGoreAyir(entries)) {
      s.push(`### ${baslik}`);
      s.push("");
      s.push(...performansTablosu(grup));
      s.push("");
    }
  }

  return s.join("\n");
}

/**
 * Künyeyi diske yazar. Run bulunamazsa hata fırlatır; çağıranlar bunu yutmayı
 * seçebilir — künye bir görünümdür, yazılamaması asıl kaydı geçersiz kılmaz.
 */
export async function writeKunye(slug: string, runId: string): Promise<string> {
  const run = await readRun(slug, runId);
  if (!run) throw new Error(`Run bulunamadı: ${slug}/${runId}`);

  const memory = await readBrandMemory(slug);
  const entries = memory.performance.filter((e) => e.runId === runId);
  const icerik = renderKunye(run, entries, new Date().toISOString());

  const p = runKunyePath(slug, runId);
  await fs.writeFile(p, icerik, "utf-8");
  return p;
}
