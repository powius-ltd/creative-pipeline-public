import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OperatorRequiredError } from "../orchestrator/operatorError";
import type { ActualCostReport } from "../orchestrator/types";

/**
 * LLM ajanları `claude` CLI'sı üzerinden koşar — API key ile değil, kullanıcının
 * kendi oturumuyla (gemini QC'deki desenin aynısı, ama burada sunucu CLI'yi
 * kendisi spawn edebildiği için operatör devri gerekmiyor).
 *
 * MALİYET NOTU — ölçülmüş değerler:
 *   soğuk ilk çağrı : ~$0.18  (cache_creation ~30K token)
 *   sonraki çağrılar: ~$0.01  (cache_read)
 * Prompt cache CLI çağrıları ARASINDA yaşıyor, ama yalnızca istek öneki birebir
 * aynıysa. Bu yüzden SISTEM PROMPTU TÜM AJANLARDA AYNI — ajanın rolü sistem
 * promptuna değil, kullanıcı promptuna yazılır. Buradaki sabiti ajana özel hale
 * getirmek her ajanı ayrı bir cache soyuna sokar ve maliyeti ~18 katına çıkarır.
 */
const SHARED_SYSTEM_PROMPT =
  "Sen bir kreatif üretim hattında çalışan bir ajansın. Sana verilen görevi yap ve " +
  "SADECE istenen JSON şemasına uyan çıktıyı üret. Açıklama, önsöz veya yorum ekleme.";

/**
 * Bağlam izolasyonu: CLI'yi projenin kendi klasöründe spawn edersek projenin
 * CLAUDE.md/AGENTS.md'sini keşfeder ve ajanın kafasını karıştırır. `--bare` bunu
 * çözerdi ama auth'u ANTHROPIC_API_KEY'e zorluyor (OAuth okumuyor), yani CLI'yi
 * seçme sebebimizi iptal ediyor. Bu yüzden nötr bir çalışma dizini kullanıyoruz.
 */
function neutralCwd(): string {
  const dir = path.join(os.tmpdir(), "creative-pipeline-agent");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * CLI'nin yerini ADAYLARI SIRAYLA DENEYEREK buluyoruz, tek bir yol varsaymıyoruz.
 *
 * Sebep: claude kendini güncelliyor ve kurulum yeri değişebiliyor — npm global
 * kurulumdan (%APPDATA%/npm/...) native kuruluma (~/.local/bin) geçiş bu hattı
 * bir kez "spawn claude ENOENT" ile durdurdu. Ayrıca native kurulum dizini bu
 * süreçte PATH'te olmayabiliyor, o yüzden düz "claude" tek başına yeterli değil.
 *
 * Windows notu: npm shim'i `claude.cmd` ve Node 18.20+/20.12+ `.cmd` dosyalarını
 * `shell: true` olmadan spawn etmiyor. Bu yüzden `.exe`'leri doğrudan hedefliyoruz
 * ve shell'e hiç ihtiyaç duymuyoruz (prompt zaten stdin'den gidiyor).
 */
let cachedCli: string | null = null;

function candidatePaths(): string[] {
  const win = process.platform === "win32";
  const bin = win ? "claude.exe" : "claude";
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const out: string[] = [];

  if (process.env.CLAUDE_CLI_PATH) out.push(process.env.CLAUDE_CLI_PATH);
  // Native kurulum (güncel varsayılan)
  if (home) out.push(path.join(home, ".local", "bin", bin));
  // PATH taraması — kurulum nereye giderse gitsin yakalar
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir) out.push(path.join(dir, bin));
  }
  // npm global kurulum (eski düzen)
  if (win && process.env.APPDATA) {
    out.push(
      path.join(
        process.env.APPDATA,
        "npm",
        "node_modules",
        "@anthropic-ai",
        "claude-code",
        "bin",
        bin,
      ),
    );
  }
  return out;
}

function resolveCli(): string {
  if (cachedCli) return cachedCli;
  for (const candidate of candidatePaths()) {
    try {
      if (fs.existsSync(candidate)) {
        cachedCli = candidate;
        return candidate;
      }
    } catch {
      // erişilemeyen PATH girdisi — sıradakine geç
    }
  }
  // Hiçbiri bulunamadıysa PATH'e bırak; başarısız olursa çağıran taraf bunu
  // OperatorRequiredError'a çevirip run'ı operatör devrine düşürüyor.
  return process.platform === "win32" ? "claude.exe" : "claude";
}

export interface ClaudeCliOptions {
  /** Ajanın rolü + görevi. Sistem promptuna DEĞİL buraya yazılır (cache için). */
  prompt: string;
  /** JSON Schema — CLI çıktıyı buna göre doğrular. */
  schema: object;
  model?: "opus" | "sonnet" | "haiku";
  /** Varsayılan boş: planner/copywriter araç kullanmaz. QC için ["Read"]. */
  allowedTools?: string[];
  /** QC'nin slide PNG'lerini okuyabilmesi için run asset dizini. */
  addDirs?: string[];
  maxBudgetUsd?: number;
  timeoutMs?: number;
}

interface CliEnvelope {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

function buildArgs(opts: ClaudeCliOptions): string[] {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(opts.schema),
    "--system-prompt",
    SHARED_SYSTEM_PROMPT,
    // Bağlam (ve dolayısıyla maliyet) kısma: MCP sunucuları, skill'ler ve
    // kullanıcı/proje ayarları yüklenmesin.
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--setting-sources",
    "",
    "--allowedTools",
    (opts.allowedTools ?? []).join(" "),
  ];

  if (opts.model) args.push("--model", opts.model);
  if (opts.maxBudgetUsd) args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  for (const dir of opts.addDirs ?? []) args.push("--add-dir", dir);

  return args;
}

function toCostReport(env: CliEnvelope, detail: string): ActualCostReport {
  const usage = env.usage ?? {};
  return {
    vendor: "claude",
    detail,
    costUsd: env.total_cost_usd ?? 0,
    claudeInputTokens:
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    claudeOutputTokens: usage.output_tokens ?? 0,
  };
}

/**
 * CLI yoksa / oturum düşmüşse bu JENERİK hata değil OperatorRequiredError olarak
 * yükselir: run 'awaiting_operator'a düşer ve mevcut operatör devri devreye girer,
 * yani hat kırılmaz.
 */
function operatorFallback(reason: string, stageHint: string): never {
  throw new OperatorRequiredError(
    `claude CLI ile '${stageHint}' üretilemedi: ${reason}\n` +
      `Kontrol et: 'claude --version' çalışıyor mu, oturum açık mı ` +
      `(CLAUDE_CLI_PATH ile yol elle verilebilir).\n` +
      `Alternatif: Claude Code operatörü bu aşamanın çıktısını kendisi üretip ` +
      `ilgili submit-* route'una POST edebilir.`,
  );
}

export async function runClaude<T>(
  opts: ClaudeCliOptions,
  stageHint: string,
): Promise<{ data: T; cost: ActualCostReport }> {
  const cli = resolveCli();
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const raw = await new Promise<string>((resolve, reject) => {
    let child;
    try {
      child = spawn(cli, buildArgs(opts), {
        cwd: neutralCwd(),
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`claude CLI ${timeoutMs}ms içinde yanıt vermedi.`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI çıkış kodu ${code}: ${stderr.trim() || "(stderr boş)"}`));
        return;
      }
      resolve(stdout);
    });

    // Prompt argv yerine stdin'den: Windows'ta argv sınırı ~32K ve uzun
    // promptlarda tırnak kaçışı sorun çıkarıyor.
    child.stdin.write(opts.prompt);
    child.stdin.end();
  }).catch((err) => {
    operatorFallback(err instanceof Error ? err.message : String(err), stageHint);
  });

  let env: CliEnvelope;
  try {
    env = JSON.parse(raw);
  } catch {
    operatorFallback(`CLI çıktısı JSON değil: ${raw.slice(0, 200)}`, stageHint);
  }

  if (env.is_error) {
    operatorFallback(`CLI hata bildirdi (${env.subtype ?? "?"})`, stageHint);
  }

  // --json-schema kullanıldığında CLI doğrulanmış nesneyi structured_output'a
  // koyuyor; result ise aynı içeriğin string hali. Nesneyi tercih ediyoruz.
  let data = env.structured_output as T | undefined;
  if (data === undefined && typeof env.result === "string") {
    try {
      data = JSON.parse(env.result) as T;
    } catch {
      operatorFallback(`CLI yapısal çıktı döndürmedi: ${env.result.slice(0, 200)}`, stageHint);
    }
  }
  if (data === undefined) {
    operatorFallback("CLI yapısal çıktı döndürmedi.", stageHint);
  }

  return { data, cost: toCostReport(env, `claude CLI · ${stageHint}`) };
}
