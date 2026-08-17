import fs from "node:fs/promises";
import path from "node:path";
import { projectDir } from "../orchestrator/paths";
import type {
  BrandMemory,
  PerformanceEntry,
  ReservedVariant,
  VariantIdea,
} from "../orchestrator/types";

function memoryPath(slug: string) {
  return path.join(projectDir(slug), "brand-memory", "memory.json");
}

async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function emptyMemory(slug: string): BrandMemory {
  return {
    projectSlug: slug,
    tone: "",
    history: [],
    reservedVariants: [],
    performance: [],
  };
}

export async function readBrandMemory(slug: string): Promise<BrandMemory> {
  const p = memoryPath(slug);
  if (!(await pathExists(p))) return emptyMemory(slug);
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

export async function writeBrandMemory(memory: BrandMemory): Promise<void> {
  const p = memoryPath(memory.projectSlug);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(memory, null, 2));
}

export async function addReservedVariants(
  slug: string,
  runId: string,
  variants: VariantIdea[],
  chosenVariantId: string | null,
): Promise<void> {
  const memory = await readBrandMemory(slug);
  const now = new Date().toISOString();
  const reserved: ReservedVariant[] = variants
    .filter((v) => v.id !== chosenVariantId)
    .map((v) => ({ ...v, runId, createdAt: now }));
  memory.reservedVariants.push(...reserved);
  memory.history.push({
    at: now,
    note: `Run ${runId}: ${variants.length} varyant üretildi, ${reserved.length} tanesi rezervde.`,
  });
  await writeBrandMemory(memory);
}

export async function addPerformanceEntry(
  slug: string,
  entry: PerformanceEntry,
): Promise<void> {
  if (!entry.kanal) {
    throw new Error(
      "PerformanceEntry.kanal zorunlu — organik/ücretli/site metrikleri aynı dizide " +
        "ayırt edilemeden karışamaz (bkz. powius-pazarlama/olcum/creative-key.md).",
    );
  }
  // Ücretli tarafta platform bilinmeden kayıt kabul edilmez: Meta ROAS'ı ile Google
  // ROAS'ı toplanamaz (atıf pencereleri farklı) ve hangi platform olduğu sonradan
  // türetilemez. Organikte platform faydalı ama zorunlu değil.
  if (entry.kanal === "ucretli" && !entry.platform) {
    throw new Error(
      "Ücretli kayıtta platform zorunlu (meta | google) — platform bilinmeden ROAS " +
        "karşılaştırması yapılamaz.",
    );
  }

  const memory = await readBrandMemory(slug);
  memory.performance.push(entry);
  const kaynak = entry.platform ? `${entry.kanal}/${entry.platform}` : entry.kanal;
  memory.history.push({
    at: entry.at,
    note: `Run ${entry.runId} / varyant ${entry.variantId} performans verisi eklendi (${kaynak}).`,
  });
  await writeBrandMemory(memory);
}
