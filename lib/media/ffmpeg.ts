import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OperatorRequiredError } from "../orchestrator/operatorError";

/**
 * ffmpeg SARMALAYICISI — hattın UÇLARINDA çalışır, ortasında değil.
 *
 * İş bölümü (bilinçli): kesme, geçiş, tipografi ve animasyon Remotion'da kalır;
 * ffmpeg yalnızca giriş hazırlığı (probe, proxy, keyframe, sahne/bulanıklık
 * ölçümü) ve çıkış finisajı (ses karışımı, ducking, loudness, encode) yapar.
 *
 * Geçişleri ffmpeg'e almamanın sebebi somut: geçiş ffmpeg'de olursa video iki
 * ayrı geçişte üretilir (ffmpeg birleştirir, Remotion üstüne yazı bindirir) ve
 * o zaman BİR YAZI BİR GEÇİŞİN ÜZERİNDEN GEÇEMEZ. CapCut'ta bu sürekli yapılır,
 * o yüzden tek compose geçişi şart.
 *
 * Bu dosya şu an Dalga 0 kapsamında yalnızca `probe` + `makeProxy` içeriyor;
 * detectScenes/detectBlur/detectSilence/extractKeyframes/transcribe/finishVideo
 * Dalga 4'te aynı `runFf` altyapısı üzerine eklenecek.
 */

// ---- İkili çözümleme -------------------------------------------------------

/**
 * `claude-cli.ts:51-96` ile aynı desen: tek bir yol varsaymıyoruz, adayları
 * sırayla deneyip ilk var olanı cache'liyoruz.
 *
 * Windows notu: burada `.cmd` sorunu YOK — ffmpeg gerçek bir `.exe`, npm shim'i
 * değil. Yine de uzantıyı açıkça hedefliyoruz ki `shell: true`'ya hiç ihtiyaç
 * duymayalım (kabuk, filter_complex içindeki noktalı virgülleri bozar).
 */
const cached: Record<string, string> = {};

function candidatePaths(tool: "ffmpeg" | "ffprobe"): string[] {
  const win = process.platform === "win32";
  const bin = win ? `${tool}.exe` : tool;
  const out: string[] = [];

  const override = tool === "ffmpeg" ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  if (override) out.push(override);

  // FFMPEG_PATH tek başına verilmişse ffprobe'u kardeşi olarak da dene —
  // ikisi pratikte hep aynı klasörde kurulur.
  if (tool === "ffprobe" && process.env.FFMPEG_PATH) {
    out.push(path.join(path.dirname(process.env.FFMPEG_PATH), bin));
  }

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir) out.push(path.join(dir, bin));
  }
  return out;
}

function resolveTool(tool: "ffmpeg" | "ffprobe"): string {
  if (cached[tool]) return cached[tool];
  for (const candidate of candidatePaths(tool)) {
    try {
      if (fs.existsSync(candidate)) {
        cached[tool] = candidate;
        return candidate;
      }
    } catch {
      // erişilemeyen PATH girdisi — sıradakine geç
    }
  }
  // Bulunamadıysa PATH'e bırak; ENOENT `operatorFallback`'e düşer.
  return process.platform === "win32" ? `${tool}.exe` : tool;
}

/**
 * Her başarısızlık yolu OperatorRequiredError'a yakınsıyor, düz Error'a değil —
 * `claude-cli.ts:171-179`'daki ev deseni. Sebebi: aşama çökmek yerine operatöre
 * devrolsun, run kurtarılabilir kalsın.
 */
function operatorFallback(reason: string, stageHint: string): never {
  throw new OperatorRequiredError(
    `ffmpeg ile '${stageHint}' yapılamadı: ${reason}\n` +
      `Kontrol et: 'ffmpeg -version' ve 'ffprobe -version' çalışıyor mu ` +
      `(FFMPEG_PATH / FFPROBE_PATH ile yol elle verilebilir).\n` +
      `Alternatif: Claude Code operatörü bu adımı kendisi koşup ilgili ` +
      `submit-* route'una POST edebilir.`,
  );
}

interface FfResult {
  stdout: string;
  stderr: string;
}

/**
 * ffmpeg/ffprobe ÇOK ses çıkarır ve bunu stderr'e yazar — hata olmasa bile.
 * Bu yüzden `code !== 0` dışında stderr'i hata sayamayız; ölçüm filtreleri
 * (scdet, blurdetect, silencedetect) çıktısını zaten stderr'e basar.
 */
function runFf(
  bin: string,
  args: string[],
  stageHint: string,
  timeoutMs = 300_000,
): Promise<FfResult> {
  return new Promise<FfResult>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`zaman aşımı (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        // stderr'in SONU işe yarar kısım; başı sürüm/konfigürasyon dökümü.
        reject(new Error(`çıkış kodu ${code}: ${stderr.trim().slice(-800)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  }).catch((err: Error) => operatorFallback(err.message, stageHint));
}

// ---- probe -----------------------------------------------------------------

export interface MediaProbe {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  codec: string;
  /** bit/s — bilinmiyorsa 0. */
  bitrate: number;
  /** Derece: 0 | 90 | 180 | 270. Telefon çekimlerinde ŞART. */
  rotation: number;
  sizeBytes: number;
}

/** ffprobe kesir olarak verir ("30000/1001"); sayıya çeviriyoruz. */
function parseRational(raw: string | undefined): number {
  if (!raw) return 0;
  const [a, b] = raw.split("/");
  const num = Number(a);
  const den = b === undefined ? 1 : Number(b);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

/**
 * Rotasyon iki ayrı yerde saklanabiliyor: eski dosyalarda `tags.rotate`,
 * yenilerde `side_data_list[].rotation`. İkisini de okumazsak dikey telefon
 * çekimi yatay sanılır — kadraj tamamen kayar.
 *
 * İŞARET UYARISI (ölçüldü, ffmpeg 8.1.2): `-display_rotation 90` ile üretilen
 * dosyada ffprobe `side_data_list[].rotation = 90` (POZİTİF) bildiriyor. Eski
 * ffmpeg sürümlerinin aynı durumda -90 verdiği biliniyor, yani işaret
 * konvansiyonu sürüme göre değişiyor. Bu yüzden aşağı akış YALNIZCA 90/270
 * PARİTESİNE (boyut takası) güvenir — takas işaretten bağımsızdır. Dönüş
 * yönünün kendisine bağlı bir mantık yazılacaksa bu önce doğrulanmalı.
 */
function readRotation(stream: Record<string, unknown>): number {
  const tags = stream.tags as Record<string, string> | undefined;
  if (tags?.rotate) {
    const n = Number(tags.rotate);
    if (Number.isFinite(n)) return ((n % 360) + 360) % 360;
  }
  const sides = stream.side_data_list as Array<Record<string, unknown>> | undefined;
  for (const side of sides ?? []) {
    if (typeof side.rotation === "number") {
      return ((side.rotation % 360) + 360) % 360;
    }
  }
  return 0;
}

export async function probe(file: string): Promise<MediaProbe> {
  const { stdout } = await runFf(
    resolveTool("ffprobe"),
    [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ],
    `probe(${path.basename(file)})`,
    60_000,
  );

  let parsed: {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return operatorFallback("ffprobe JSON çıktısı ayrıştırılamadı", `probe(${file})`);
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const format = parsed.format ?? {};

  if (!video) {
    return operatorFallback(
      "dosyada video akışı yok (ses dosyası mı verildi?)",
      `probe(${path.basename(file)})`,
    );
  }

  // Süre stream'de eksik olabiliyor (özellikle .mov'da); format'a düşüyoruz.
  const durationSec =
    Number(video.duration) || Number(format.duration) || 0;

  // avg_frame_rate bazı dosyalarda "0/0" gelir — r_frame_rate yedeği.
  const fps =
    parseRational(video.avg_frame_rate as string) ||
    parseRational(video.r_frame_rate as string);

  const rotation = readRotation(video);
  const rawW = Number(video.width) || 0;
  const rawH = Number(video.height) || 0;
  // 90/270'te en-boy YER DEĞİŞTİRİR; aşağı akış (kadraj, fit, focus) döndürülmüş
  // hali görmek zorunda, yoksa 9:16 kaynak 16:9 sanılır.
  const swap = rotation === 90 || rotation === 270;

  let sizeBytes = Number(format.size) || 0;
  if (!sizeBytes) {
    try {
      sizeBytes = (await fsp.stat(file)).size;
    } catch {
      sizeBytes = 0;
    }
  }

  return {
    durationSec,
    width: swap ? rawH : rawW,
    height: swap ? rawW : rawH,
    fps,
    hasAudio: Boolean(audio),
    codec: String(video.codec_name ?? "bilinmiyor"),
    bitrate: Number(format.bit_rate) || 0,
    rotation,
    sizeBytes,
  };
}

// ---- makeProxy -------------------------------------------------------------

/**
 * Gemini'nin inline video sınırı SERT: gemini-cli bundle'ında
 * `MAX_FILE_SIZE_MB = 20`. Kaynak klip neredeyse her zaman bunun üstünde, o
 * yüzden analiz her zaman proxy üzerinden yapılır.
 *
 * Hedef boyutun ALTINA İNMEYİ GARANTİ ediyoruz: tek geçişte tutmazsa crf'i
 * kademeli artırıp yeniden deniyoruz. Boyutu çağırana kontrol ettirmek, sınırı
 * aşan bir dosyayı Gemini'ye gönderip anlamsız bir API hatası almak demekti.
 */
export interface ProxyOptions {
  /** Varsayılan 720 — ölçüm için yeterli, 20MB'a rahat sığar. */
  maxHeight?: number;
  /** Başlangıç crf'i. Yükseldikçe kalite düşer, dosya küçülür. */
  crf?: number;
  /** Varsayılan 19MB — 20MB sınırına pay bırakır. */
  maxBytes?: number;
  /** Sesi at (ölçüm için gereksiz, boyut kazandırır). Varsayılan true. */
  dropAudio?: boolean;
}

const CRF_LADDER = [30, 34, 38, 42];

export async function makeProxy(
  src: string,
  dest: string,
  o: ProxyOptions = {},
): Promise<string> {
  const maxHeight = o.maxHeight ?? 720;
  const maxBytes = o.maxBytes ?? 19 * 1024 * 1024;
  const dropAudio = o.dropAudio ?? true;
  const stageHint = `makeProxy(${path.basename(src)})`;

  await fsp.mkdir(path.dirname(dest), { recursive: true });

  // Verilen crf merdivenin başına eklenir; kullanıcı tercihi ilk denenen olur.
  const ladder = o.crf === undefined ? CRF_LADDER : [o.crf, ...CRF_LADDER.filter((c) => c > o.crf!)];

  let lastSize = 0;
  for (const crf of ladder) {
    await runFf(
      resolveTool("ffmpeg"),
      [
        "-y",
        "-i",
        src,
        // scale=-2 genişliği en-boya göre türetir ve ÇİFT sayıya yuvarlar;
        // libx264 tek sayılı boyut kabul etmiyor.
        "-vf",
        `scale=-2:'min(${maxHeight},ih)'`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        String(crf),
        "-pix_fmt",
        "yuv420p",
        ...(dropAudio ? ["-an"] : ["-c:a", "aac", "-b:a", "96k"]),
        "-movflags",
        "+faststart",
        dest,
      ],
      stageHint,
    );

    lastSize = (await fsp.stat(dest)).size;
    if (lastSize <= maxBytes) return dest;
  }

  return operatorFallback(
    `proxy ${Math.round(maxBytes / 1024 / 1024)}MB altına indirilemedi ` +
      `(son deneme ${Math.round(lastSize / 1024 / 1024)}MB, crf ${ladder.at(-1)}). ` +
      `Klip çok uzun olabilir — önce süreyi kırpmayı dene.`,
    stageHint,
  );
}

// ---- Ölçüm filtreleri ------------------------------------------------------

/**
 * Sahne sınırları. Modele SORULMAZ — `scdet` bunu deterministik ve bedava
 * hesaplıyor. Üç katmanlı analiz stratejisinin ilk katmanı: ölçülebilene model
 * parası ödenmiyor.
 */
export async function detectScenes(
  src: string,
  threshold = 0.4,
): Promise<{ sec: number; score: number }[]> {
  const { stderr } = await runFf(
    resolveTool("ffmpeg"),
    ["-i", src, "-vf", `scdet=threshold=${threshold * 100}`, "-f", "null", "-"],
    `detectScenes(${path.basename(src)})`,
  );

  const out: { sec: number; score: number }[] = [];
  // scdet stderr'e şu biçimde yazıyor:
  //   [scdet @ ...] lavfi.scd.score: 12.345, lavfi.scd.time: 3.4
  const re = /lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    out.push({ score: Number(m[1]), sec: Number(m[2]) });
  }
  return out;
}

/**
 * Bulanıklık ölçümü. "Kadraj odakta mı" sorusunu vision modeline sormak israf —
 * `blurdetect` sayı veriyor. Düşük değer = keskin.
 */
export async function detectBlur(
  src: string,
  everySec = 1,
): Promise<{ sec: number; blur: number }[]> {
  const { stderr } = await runFf(
    resolveTool("ffmpeg"),
    [
      "-i",
      src,
      "-vf",
      `fps=1/${everySec},blurdetect=block_pct=80`,
      "-f",
      "null",
      "-",
    ],
    `detectBlur(${path.basename(src)})`,
  );

  const out: { sec: number; blur: number }[] = [];
  const re = /blurdetect.*?blur:\s*([\d.]+)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(stderr)) !== null) {
    out.push({ sec: i * everySec, blur: Number(m[1]) });
    i++;
  }
  return out;
}

/** Konuşma boşlukları — kesme noktası adayları. */
export async function detectSilence(
  src: string,
  noiseDb = -32,
  minDurSec = 0.35,
): Promise<{ startSec: number; endSec: number }[]> {
  const { stderr } = await runFf(
    resolveTool("ffmpeg"),
    ["-i", src, "-af", `silencedetect=noise=${noiseDb}dB:d=${minDurSec}`, "-f", "null", "-"],
    `detectSilence(${path.basename(src)})`,
  );

  const out: { startSec: number; endSec: number }[] = [];
  const starts: number[] = [];
  const re = /silence_(start|end):\s*(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    if (m[1] === "start") starts.push(Number(m[2]));
    else {
      const s = starts.shift();
      if (s !== undefined) out.push({ startSec: s, endSec: Number(m[2]) });
    }
  }
  return out;
}

/** Vision katmanına verilecek aday kareler. */
export async function extractKeyframes(
  src: string,
  destDir: string,
  at: { everySec: number } | { atSec: number[] },
): Promise<string[]> {
  await fsp.mkdir(destDir, { recursive: true });
  const stageHint = `extractKeyframes(${path.basename(src)})`;

  if ("atSec" in at) {
    // Tek tek çıkarıyoruz: `-ss` girdiden ÖNCE gelirse ffmpeg keyframe'e atlayıp
    // hızlı arama yapıyor, tek bir select filtresiyle yapmaktan çok daha ucuz.
    const out: string[] = [];
    for (const [i, sec] of at.atSec.entries()) {
      const dest = path.join(destDir, `kf-${String(i).padStart(3, "0")}.jpg`);
      await runFf(
        resolveTool("ffmpeg"),
        ["-y", "-ss", String(sec), "-i", src, "-frames:v", "1", "-q:v", "3", dest],
        stageHint,
      );
      out.push(dest);
    }
    return out;
  }

  const pattern = path.join(destDir, "kf-%03d.jpg");
  await runFf(
    resolveTool("ffmpeg"),
    ["-y", "-i", src, "-vf", `fps=1/${at.everySec}`, "-q:v", "3", pattern],
    stageHint,
  );
  const files = await fsp.readdir(destDir);
  return files
    .filter((f) => f.startsWith("kf-") && f.endsWith(".jpg"))
    .sort()
    .map((f) => path.join(destDir, f));
}

/**
 * Transkript — ffmpeg'in whisper filtresiyle, YEREL.
 *
 * DİKKAT: gyan build'i `--enable-whisper` ile derlenmiş ama ggml model dosyası
 * GELMİYOR. `WHISPER_MODEL_PATH` yoksa operatör devrine düşüyoruz; Aşama A'nın
 * kritik yolunda değil (yalnızca gerçek çekim sesini yazıya dökmek için gerekli,
 * AI seslendirmede zaman damgaları ElevenLabs'ten zaten geliyor).
 */
export async function transcribe(
  src: string,
): Promise<{ startSec: number; endSec: number; text: string }[]> {
  const model = process.env.WHISPER_MODEL_PATH;
  if (!model) {
    return operatorFallback(
      "WHISPER_MODEL_PATH tanımlı değil. ffmpeg'in whisper filtresi harici bir " +
        "ggml model dosyası istiyor ve bu build'le gelmiyor.\n" +
        "İndir: https://huggingface.co/ggerganov/whisper.cpp (ggml-base.bin yeterli)\n" +
        "Sonra .env.local'e WHISPER_MODEL_PATH=... ekle.",
      `transcribe(${path.basename(src)})`,
    );
  }

  const dest = path.join(os.tmpdir(), `cp-transcript-${Date.now()}.srt`);
  await runFf(
    resolveTool("ffmpeg"),
    [
      "-y",
      "-i",
      src,
      "-vn",
      "-af",
      `whisper=model=${model}:language=tr:destination=${dest}:format=srt`,
      "-f",
      "null",
      "-",
    ],
    `transcribe(${path.basename(src)})`,
    900_000,
  );

  const srt = await fsp.readFile(dest, "utf8").catch(() => "");
  await fsp.rm(dest, { force: true });

  const out: { startSec: number; endSec: number; text: string }[] = [];
  const toSec = (t: string) => {
    const [h, m, rest] = t.split(":");
    const [s, ms] = rest.split(",");
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  };
  for (const block of srt.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) continue;
    const time = lines.find((l) => l.includes("-->"));
    if (!time) continue;
    const [a, b] = time.split("-->").map((x) => x.trim());
    out.push({
      startSec: toSec(a),
      endSec: toSec(b),
      text: lines.slice(lines.indexOf(time) + 1).join(" "),
    });
  }
  return out;
}

// ---- Finisaj ---------------------------------------------------------------

export interface FinishAudioInput {
  src: string;
  role: "voice" | "music" | "sfx";
  startSec: number;
  inSec: number;
  outSec: number;
  gain: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}

export interface FinishOptions {
  /** Remotion'ın bastığı SESSİZ montaj. */
  videoPath: string;
  audio: FinishAudioInput[];
  duck: { ratio: number; thresholdDb: number; releaseMs: number };
  loudnessLufs: number;
  outPath: string;
}

/** dB → 0..1 lineer (sidechaincompress threshold'u lineer istiyor). */
function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * SES KARIŞIMI VE NİHAİ ENCODE.
 *
 * Burada ffmpeg'in Remotion'a üstün olduğu üç şey var:
 *   - `sidechaincompress`: GERÇEK bir yan zincir kompresörü. Remotion'ın kare
 *     bazlı volume'ü ile "müzik VO altında insin" yapılabilir ama sert ve
 *     nefessiz olur; kompresör attack/release ile doğal iniyor.
 *   - `loudnorm I=-14`: Instagram/TikTok normalizasyonuna denk. Remotion'da yok.
 *   - `-c:v copy`: video YENİDEN KODLANMIYOR. Remotion zaten h264 üretti;
 *     yeniden encode dakikalar ve kalite kaybı demek, karşılığı sıfır.
 */
export async function finishVideo(o: FinishOptions): Promise<string> {
  const stageHint = `finishVideo(${path.basename(o.videoPath)})`;
  await fsp.mkdir(path.dirname(o.outPath), { recursive: true });

  // Hiç ses yoksa yalnızca kopyala — boş bir filtre grafiği kurup ffmpeg'i
  // şaşırtmanın anlamı yok.
  if (o.audio.length === 0) {
    await runFf(
      resolveTool("ffmpeg"),
      ["-y", "-i", o.videoPath, "-c:v", "copy", "-an", "-movflags", "+faststart", o.outPath],
      stageHint,
    );
    return o.outPath;
  }

  const args: string[] = ["-y", "-i", o.videoPath];
  for (const a of o.audio) args.push("-i", a.src);

  const filters: string[] = [];
  const voiceLabels: string[] = [];
  const bedLabels: string[] = [];

  o.audio.forEach((a, idx) => {
    const input = idx + 1; // 0 = video
    const label = `a${idx}`;
    const chain = [
      "aresample=48000",
      // Kaynak içi kırpma
      `atrim=${a.inSec}:${a.outSec}`,
      "asetpts=PTS-STARTPTS",
      `volume=${a.gain}`,
    ];
    if (a.fadeInSec) chain.push(`afade=t=in:st=0:d=${a.fadeInSec}`);
    if (a.fadeOutSec) {
      const dur = a.outSec - a.inSec;
      chain.push(`afade=t=out:st=${Math.max(0, dur - a.fadeOutSec)}:d=${a.fadeOutSec}`);
    }
    // Zaman çizelgesindeki yerine kaydır (adelay ms cinsinden, kanal başına)
    if (a.startSec > 0) {
      const ms = Math.round(a.startSec * 1000);
      chain.push(`adelay=${ms}:all=1`);
    }
    filters.push(`[${input}:a]${chain.join(",")}[${label}]`);
    (a.role === "voice" ? voiceLabels : bedLabels).push(label);
  });

  let mixLabel: string;

  if (voiceLabels.length > 0 && bedLabels.length > 0) {
    // Tüm VO'ları tek zincire topla — sidechain tek tetikleyici istiyor.
    const voiceMix = "vo";
    filters.push(
      voiceLabels.length === 1
        ? `[${voiceLabels[0]}]anull[${voiceMix}]`
        : `${voiceLabels.map((l) => `[${l}]`).join("")}amix=inputs=${voiceLabels.length}:normalize=0[${voiceMix}]`,
    );

    const bedMix = "bed";
    filters.push(
      bedLabels.length === 1
        ? `[${bedLabels[0]}]anull[${bedMix}]`
        : `${bedLabels.map((l) => `[${l}]`).join("")}amix=inputs=${bedLabels.length}:normalize=0[${bedMix}]`,
    );

    // VO'yu iki kopyaya böl: biri karışıma, biri sidechain tetikleyicisine.
    filters.push(`[${voiceMix}]asplit=2[vomix][vokey]`);
    filters.push(
      `[${bedMix}][vokey]sidechaincompress=` +
        `threshold=${dbToLinear(o.duck.thresholdDb).toFixed(5)}:` +
        `ratio=${o.duck.ratio}:attack=20:release=${o.duck.releaseMs}[ducked]`,
    );
    filters.push(`[ducked][vomix]amix=inputs=2:normalize=0:dropout_transition=0[mx]`);
    mixLabel = "mx";
  } else {
    const all = [...voiceLabels, ...bedLabels];
    filters.push(
      all.length === 1
        ? `[${all[0]}]anull[mx]`
        : `${all.map((l) => `[${l}]`).join("")}amix=inputs=${all.length}:normalize=0:dropout_transition=0[mx]`,
    );
    mixLabel = "mx";
  }

  filters.push(`[${mixLabel}]loudnorm=I=${o.loudnessLufs}:TP=-1.5:LRA=11[aout]`);

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v",
    "-map",
    "[aout]",
    // Video yeniden kodlanmıyor — gerekçe fonksiyon başlığında.
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    // Sesin videodan uzun olması siyah kuyruk yapmasın.
    "-shortest",
    "-movflags",
    "+faststart",
    o.outPath,
  );

  await runFf(resolveTool("ffmpeg"), args, stageHint, 600_000);
  return o.outPath;
}
