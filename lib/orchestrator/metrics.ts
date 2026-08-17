import { addPerformanceEntry } from "../brand-memory/store";
import { writeKunye } from "./kunye";
import { readRun } from "./runStore";
import type { PerformanceEntry, PerformanceKanal } from "./types";

export interface RecordMetricsInput {
  /** Zorunlu — bkz. powius-pazarlama/olcum/creative-key.md. */
  kanal: PerformanceKanal;
  /** Ücretlide zorunlu ("meta" | "google"), organikte önerilir. */
  platform?: string;
  metrics: Record<string, number>;
  notes?: string;
}

/**
 * Sonuç departmanının minimum girişi (bkz. powius-pazarlama/olcum/utm-standardi.md,
 * KREATIF-DIREKTORLUK-ARGE.md §11). Organik metrikler 48 saat sonra elle girilir;
 * ücretli metrikler ads-analyst'ten gelir. Faz 8 ölçekleme döngüsünü kapatan uç budur:
 * performans → brand-memory → bir sonraki konsept çağrısının "rezerv hook" bağlamı.
 */
export async function recordMetrics(
  projectSlug: string,
  runId: string,
  input: RecordMetricsInput,
): Promise<PerformanceEntry> {
  const run = await readRun(projectSlug, runId);
  if (!run) throw new Error("Run bulunamadı.");
  if (run.status !== "published") {
    throw new Error(
      `Run henüz yayınlanmadı (status: ${run.status}) — metrik girişi yalnızca ` +
        `yayınlanmış run'lar için anlamlı.`,
    );
  }

  const entry: PerformanceEntry = {
    at: new Date().toISOString(),
    runId,
    variantId: run.chosenVariantId ?? "unknown",
    kanal: input.kanal,
    ...(input.platform ? { platform: input.platform } : {}),
    metrics: input.metrics,
    notes: input.notes,
  };
  await addPerformanceEntry(projectSlug, entry);
  // Künye türetilmiş dosya: kaynak veri her değiştiğinde yeniden yazılır. Yazılamazsa
  // metrik kaydı geri alınmaz — künye bir görünüm, kayıt değil.
  await writeKunye(projectSlug, runId).catch(() => {});
  return entry;
}
