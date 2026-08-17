import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OperatorRequiredError } from "../orchestrator/operatorError";
import type { ActualCostReport } from "../orchestrator/types";

/**
 * GEMINI CLI SARMALAYICISI — video analizi için.
 *
 * `claude-cli.ts`'in kardeşi ama dört önemli farkla; hepsi kurulu CLI'nin
 * bundle'ı incelenerek doğrulandı (@google/gemini-cli):
 *
 *   1. WINDOWS'TA `gemini.exe` YOK. Yalnızca `gemini`, `gemini.cmd`, `gemini.ps1`
 *      var. claude-cli'deki ".exe'yi doğrudan hedefle" hilesi burada geçmiyor
 *      (Node `.cmd`'yi `shell:true` olmadan spawn etmiyor). Çözüm: `process.execPath`
 *      (node) ile `bundle/gemini.js`'i doğrudan çalıştırmak.
 *
 *   2. `--json-schema` MUADİLİ YOK. `-o json` yalnızca zarfı JSON yapıyor;
 *      `response` alanı DÜZ METİN. Bu yüzden şema prompt'la zorlanıp kodda
 *      doğrulanıyor ve bir kez onarma denemesi yapılıyor.
 *
 *   3. VİDEO OKUYABİLİYOR ama 20MB SERT SINIR var (`MAX_FILE_SIZE_MB`).
 *      Kaynak klip neredeyse hep bunun üstünde — `makeProxy` ile küçültülmeli.
 *
 *   4. ENV HİJYENİ ŞART. `GEMINI_API_KEY`/`GOOGLE_AI_API_KEY` child env'de
 *      varsa CLI auth'u `oauth-personal`dan koparıp API'yi FATURALANDIRIYOR.
 *      Abonelikle çalışmanın tek yolu bu değişkenleri silmek.
 *
 * Not: her başarısızlık yolu `OperatorRequiredError`'a yakınsıyor — API anahtarı
 * yoluna DÜŞÜLMÜYOR (bilinçli karar). Auth çalışmazsa aşama operatöre devrediyor,
 * hat kırılmıyor.
 */

const SHARED_SYSTEM_PROMPT =
  "Sen bir kreatif üretim hattında çalışan bir ÖLÇÜM ajanısın. Verilen medyayı " +
  "ölç, yorumlama. SADECE istenen JSON şemasına uyan çıktı üret; açıklama, " +
  "önsöz, kod bloğu işareti ekleme.";

/**
 * Bağlam izolasyonu — `claude-cli.ts:31-35` ile aynı gerekçe: proje klasöründe
 * spawn edersek CLI projenin `GEMINI.md`/`AGENTS.md`'sini keşfedip bağlama
 * karıştırıyor. (Bu yüzden kök nottaki dosyanın adı `GEMINI-NOTLARI.md`,
 * `GEMINI.md` DEĞİL — bkz. GEMINI-NOTLARI.md.)
 */
function neutralCwd(): string {
  const dir = path.join(os.tmpdir(), "creative-pipeline-gemini");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let cachedEntry: string | null = null;

function candidateEntries(): string[] {
  const out: string[] = [];
  if (process.env.GEMINI_CLI_PATH) out.push(process.env.GEMINI_CLI_PATH);

  const rel = path.join("node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
  if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, "npm", rel));

  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  if (home) {
    out.push(path.join(home, ".nvm", "current", "lib", rel));
    out.push(path.join(home, ".local", "lib", rel));
  }
  out.push(path.join("/usr", "local", "lib", rel));
  out.push(path.join("/usr", "lib", rel));
  return out;
}

function resolveEntry(): string | null {
  if (cachedEntry) return cachedEntry;
  for (const c of candidateEntries()) {
    try {
      if (fs.existsSync(c)) {
        cachedEntry = c;
        return c;
      }
    } catch {
      // erişilemeyen aday — sıradakine geç
    }
  }
  return null;
}

/**
 * API anahtarlarını child env'DEN SİLER. Bu fonksiyonun tek işi bu ve en kritik
 * satır burası: anahtar sızarsa abonelik yerine API faturalandırılır ve bu
 * SESSİZCE olur.
 */
function childEnv(model?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_AI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.GOOGLE_GENAI_USE_VERTEXAI;
  env.GEMINI_DEFAULT_AUTH_TYPE = "oauth-personal";
  if (model) env.GEMINI_MODEL = model;
  return env;
}

interface GeminiEnvelope {
  session_id?: string;
  response?: string;
  error?: { message?: string } | string;
  stats?: {
    models?: Record<
      string,
      { tokens?: { prompt?: number; candidates?: number; total?: number } }
    >;
  };
}

export interface GeminiCliOptions {
  prompt: string;
  /** Doğrulayıcı: çıktı beklenen şekle uyuyor mu. Uymazsa hata metni döner. */
  validate: (parsed: unknown) => string | null;
  /** CLI'nin okuyabilmesi için izin verilecek klasör (medya burada olmalı). */
  includeDir?: string;
  model?: string;
  timeoutMs?: number;
}

function operatorFallback(reason: string, stageHint: string): never {
  throw new OperatorRequiredError(
    `gemini CLI ile '${stageHint}' üretilemedi: ${reason}\n\n` +
      `Kontrol et:\n` +
      `  1. 'gemini --version' çalışıyor mu (GEMINI_CLI_PATH ile yol elle verilebilir).\n` +
      `  2. Oturum açık mı — 'gemini' çalıştırıp /auth ile giriş yap.\n` +
      `  3. IneligibleTierError alıyorsan hesabın Gemini Code Assist için uygun değil;\n` +
      `     bkz. GEMINI-NOTLARI.md.\n\n` +
      `Alternatif: operatör 'gemini' CLI'sını elle koşup çıktıyı ilgili submit-* ` +
      `route'una POST edebilir.`,
  );
}

/** ```json ... ``` sarmalını ve baş/son gevezeliği temizler. */
function stripFences(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const arrStart = body.indexOf("[");
  const from =
    start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart);
  if (from === -1) return body.trim();
  const lastObj = body.lastIndexOf("}");
  const lastArr = body.lastIndexOf("]");
  const to = Math.max(lastObj, lastArr);
  return body.slice(from, to + 1).trim();
}

function spawnGemini(
  entry: string,
  prompt: string,
  opts: GeminiCliOptions,
): Promise<GeminiEnvelope> {
  const args = [
    entry,
    "-o",
    "json",
    // "plan" onay modu: CLI dosya OKUYABİLİR ama yazamaz/komut çalıştıramaz.
    // Gözetimsiz koşan bir süreç için doğru varsayılan.
    "--approval-mode",
    "plan",
    "--skip-trust",
  ];
  if (opts.model) args.push("-m", opts.model);
  if (opts.includeDir) args.push("--include-directories", opts.includeDir);
  args.push("-p", prompt);

  return new Promise<GeminiEnvelope>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: neutralCwd(),
      env: childEnv(opts.model),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(
      () => {
        child.kill();
        reject(new Error(`zaman aşımı (${Math.round((opts.timeoutMs ?? 300_000) / 1000)}s)`));
      },
      opts.timeoutMs ?? 300_000,
    );

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`çıkış kodu ${code}: ${(stderr || stdout).trim().slice(-700)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as GeminiEnvelope);
      } catch {
        reject(new Error(`JSON zarfı ayrıştırılamadı: ${stdout.trim().slice(0, 300)}`));
      }
    });
  });
}

function toCostReport(env: GeminiEnvelope, detail: string): ActualCostReport {
  // Abonelik üzerinden koştuğu için doğrudan $ yok — ama token sayısını
  // `detail`e yazıyoruz ki tüketim maliyet tablosunda GÖRÜNÜR kalsın.
  let prompt = 0;
  let out = 0;
  for (const m of Object.values(env.stats?.models ?? {})) {
    prompt += m.tokens?.prompt ?? 0;
    out += m.tokens?.candidates ?? 0;
  }
  const tokenNote = prompt || out ? ` (${prompt} girdi / ${out} çıktı token)` : "";
  return { vendor: "gemini", detail: `${detail}${tokenNote}`, costUsd: 0 };
}

export async function runGemini<T>(
  opts: GeminiCliOptions,
  stageHint: string,
): Promise<{ data: T; cost: ActualCostReport }> {
  const entry = resolveEntry();
  if (!entry) {
    operatorFallback(
      "gemini CLI bulunamadı (aranan: %APPDATA%/npm/node_modules/@google/gemini-cli/bundle/gemini.js)",
      stageHint,
    );
  }

  const fullPrompt = `${SHARED_SYSTEM_PROMPT}\n\n${opts.prompt}`;

  let env: GeminiEnvelope;
  try {
    env = await spawnGemini(entry, fullPrompt, opts);
  } catch (err) {
    operatorFallback((err as Error).message, stageHint);
  }

  if (env.error) {
    const msg = typeof env.error === "string" ? env.error : (env.error.message ?? "bilinmeyen");
    operatorFallback(msg, stageHint);
  }

  const attempt = (raw: string): { ok: true; data: T } | { ok: false; why: string } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch (e) {
      return { ok: false, why: `JSON ayrıştırılamadı: ${(e as Error).message}` };
    }
    const problem = opts.validate(parsed);
    if (problem) return { ok: false, why: problem };
    return { ok: true, data: parsed as T };
  };

  const first = attempt(env.response ?? "");
  if (first.ok) return { data: first.data, cost: toCostReport(env, stageHint) };

  // ŞEMA ZORLAMASI OLMADIĞI İÇİN bir onarma turu: hatayı prompt'a ekleyip
  // yeniden soruyoruz. İki turdan fazlası maliyeti katlar, değmiyor.
  let retryEnv: GeminiEnvelope;
  try {
    retryEnv = await spawnGemini(
      entry,
      `${fullPrompt}\n\nÖNCEKİ DENEMEN GEÇERSİZDİ: ${first.why}\n` +
        `SADECE geçerli JSON döndür, kod bloğu işareti kullanma.`,
      opts,
    );
  } catch (err) {
    operatorFallback(`onarma denemesi de başarısız: ${(err as Error).message}`, stageHint);
  }

  const second = attempt(retryEnv.response ?? "");
  if (second.ok) return { data: second.data, cost: toCostReport(retryEnv, stageHint) };

  operatorFallback(
    `çıktı iki denemede de şemaya uymadı. Son hata: ${second.why}`,
    stageHint,
  );
}
