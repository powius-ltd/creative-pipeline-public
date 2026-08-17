import path from "node:path";

/**
 * Yol yardımcıları runStore'dan ayrı duruyor çünkü ajanlar bunlara ihtiyaç duyuyor
 * ama runStore maliyet tahmini için mod kayıt defterini import ediyor — ajanlar da
 * modların içinde. Aynı dosyada olsalardı şu döngü oluşurdu:
 *   runStore → cost/estimate → modes → carousel/visual → runStore
 */
const PROJECTS_ROOT = path.join(process.cwd(), "projects");

export const TEMPLATE_SLUG = "_template";

export function projectsRoot() {
  return PROJECTS_ROOT;
}

export function projectDir(slug: string) {
  return path.join(PROJECTS_ROOT, slug);
}

export function runsDir(slug: string) {
  return path.join(projectDir(slug), "runs");
}

export function runDir(slug: string, runId: string) {
  return path.join(runsDir(slug), runId);
}

export function runAssetsDir(slug: string, runId: string) {
  return path.join(runDir(slug, runId), "assets");
}

export function runStatePath(slug: string, runId: string) {
  return path.join(runDir(slug, runId), "state.json");
}

/** Türetilmiş insan-okur künye — kaynağı state.json + brand-memory, elle düzenlenmez. */
export function runKunyePath(slug: string, runId: string) {
  return path.join(runDir(slug, runId), "kunye.md");
}
