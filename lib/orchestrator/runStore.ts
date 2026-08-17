import fs from "node:fs/promises";
import path from "node:path";
import type { AspectRatioId } from "../config/aspect";
import { DEFAULT_LANGUAGE, type Language } from "../config/language";
import { estimateRun } from "../cost/estimate";
import { getMode } from "../modes";
import { getDescriptor, resolveAspect } from "../modes/descriptors";
import {
  TEMPLATE_SLUG,
  projectDir,
  projectsRoot,
  runAssetsDir,
  runDir,
  runStatePath,
  runsDir,
} from "./paths";
import { emptyPayload } from "./types";
import type { ModeId, ProjectConfig, RunState, Platform } from "./types";

// NOT: yol yardımcıları buradan yeniden dışa AKTARILMIYOR. Ajanlar onları
// ./paths.ts'ten import etmeli — aksi halde runStore → cost/estimate → modes →
// ajanlar → runStore döngüsü geri gelir.

async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function listProjects(): Promise<ProjectConfig[]> {
  const root = projectsRoot();
  if (!(await pathExists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const slugs = entries
    .filter((e) => e.isDirectory() && e.name !== TEMPLATE_SLUG)
    .map((e) => e.name);
  const configs: ProjectConfig[] = [];
  for (const slug of slugs) {
    const configPath = path.join(projectDir(slug), "config.json");
    if (await pathExists(configPath)) {
      configs.push(JSON.parse(await fs.readFile(configPath, "utf-8")));
    }
  }
  return configs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getProject(slug: string): Promise<ProjectConfig | null> {
  const configPath = path.join(projectDir(slug), "config.json");
  if (!(await pathExists(configPath))) return null;
  return JSON.parse(await fs.readFile(configPath, "utf-8"));
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function createProjectFromTemplate(opts: {
  name: string;
  platform: Platform;
  defaultMode: ModeId;
  defaultAuto: boolean;
  language: Language;
}): Promise<ProjectConfig> {
  const slug = slugify(opts.name) || `project-${Date.now()}`;
  const dir = projectDir(slug);
  if (await pathExists(dir)) {
    throw new Error(`Proje zaten var: ${slug}`);
  }
  await fs.mkdir(path.join(dir, "runs"), { recursive: true });
  await fs.mkdir(path.join(dir, "brand-memory"), { recursive: true });

  const config: ProjectConfig = {
    slug,
    name: opts.name,
    platform: opts.platform,
    defaultMode: opts.defaultMode,
    defaultAuto: opts.defaultAuto,
    language: opts.language,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(dir, "config.json"),
    JSON.stringify(config, null, 2),
  );

  const brandMemory = {
    projectSlug: slug,
    tone: "",
    history: [],
    reservedVariants: [],
    performance: [],
  };
  await fs.writeFile(
    path.join(dir, "brand-memory", "memory.json"),
    JSON.stringify(brandMemory, null, 2),
  );

  return config;
}

export async function listRuns(slug: string): Promise<RunState[]> {
  const dir = runsDir(slug);
  if (!(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const runs: RunState[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const statePath = runStatePath(slug, e.name);
    if (await pathExists(statePath)) {
      runs.push(JSON.parse(await fs.readFile(statePath, "utf-8")));
    }
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readRun(
  slug: string,
  runId: string,
): Promise<RunState | null> {
  const statePath = runStatePath(slug, runId);
  if (!(await pathExists(statePath))) return null;
  return JSON.parse(await fs.readFile(statePath, "utf-8"));
}

export async function writeRun(state: RunState): Promise<RunState> {
  state.updatedAt = new Date().toISOString();
  const dir = runDir(state.projectSlug, state.runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(runAssetsDir(state.projectSlug, state.runId), {
    recursive: true,
  });
  await fs.writeFile(
    runStatePath(state.projectSlug, state.runId),
    JSON.stringify(state, null, 2),
  );
  return state;
}

export async function createRun(opts: {
  projectSlug: string;
  mode: ModeId;
  platform: Platform;
  language?: Language;
  aspect?: AspectRatioId;
  watermark?: boolean;
  topic: string;
  notes?: string;
  auto: boolean;
}): Promise<RunState> {
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const descriptor = getDescriptor(opts.mode);
  const firstStage = descriptor.stages[0].id;

  const state: RunState = {
    runId,
    projectSlug: opts.projectSlug,
    createdAt: now,
    updatedAt: now,
    auto: opts.auto,
    mode: opts.mode,
    platform: opts.platform,
    language: opts.language ?? DEFAULT_LANGUAGE,
    aspect: resolveAspect(opts.mode, opts.platform, opts.aspect),
    watermark: opts.watermark ?? descriptor.watermarkDefault,
    stage: firstStage,
    status: "awaiting_approval",
    topic: opts.topic,
    notes: opts.notes ?? "",
    variants: [],
    chosenVariantId: null,
    // Yükün şekli modun KENDİ bildirdiği `payloadKind`'dan geliyor, descriptor'ın
    // sunum alanından türetilmiyor. Eskiden burada `output === "carousel" ? ... : ...`
    // ternary'si vardı ve her yeni mod buraya bir dal eklemek zorundaydı; bu satır
    // o bağlantı noktasını KALICI OLARAK kaldırıyor. runStore zaten estimateRun
    // üzerinden getMode'u import ediyor, yani yeni bir döngü oluşmuyor.
    payload: emptyPayload(getMode(opts.mode).payloadKind),
    assets: { voice: {}, visual: {} },
    qc: { verdict: "pending" },
    cost: { estimated: {}, actual: {} },
    history: [
      {
        at: now,
        stage: firstStage,
        action: "run_created",
        note: `Brief: "${opts.topic}" (mod: ${descriptor.label})`,
      },
    ],
  };
  state.cost = { estimated: estimateRun(state), actual: {} };
  await writeRun(state);
  return state;
}
