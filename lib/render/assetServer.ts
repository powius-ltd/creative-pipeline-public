import { createReadStream } from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

/**
 * RUN ASSET'LERİNİ YEREL HTTP ÜZERİNDEN SERVİS EDER.
 *
 * Neden gerekli: `renderStill`/`renderMedia` bundle'ı headless Chrome'a `http://`
 * üzerinden veriyor, oradan yerel bir mutlak dosya yoluna erişilemiyor.
 * `staticFile()` ise asset'in `public/` altında olmasını isterdi — ama üretilen
 * asset'ler `projects/<slug>/runs/<id>/assets/` altında duruyor.
 *
 * Carousel bu sorunu `compose.ts:24-32`'de base64 data URI ile çözüyor. Video
 * için o yol KULLANILAMAZ: her klip için yüzlerce MB'lık base64 string
 * `inputProps` içine girer ve süreç OOM olur.
 *
 * Reddedilen alternatif: `bundle({ publicDir })`. Bundle süreç başına
 * cache'leniyor (`lib/render/bundle.ts`) ve `publicDir` bundle anında gömülüyor —
 * run başına değiştirilemez, her değişiklik 10-30sn'lik yeni bir bundle demek.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};

export interface AssetServer {
  baseUrl: string;
  /** Mutlak ya da cwd'ye göreli bir yolu, sunucunun verdiği URL'e çevirir. */
  urlFor(absOrRel: string): string;
  close(): Promise<void>;
}

/**
 * `Range` isteğini ayrıştırır. Yalnızca tek aralık destekliyoruz — Chromium
 * çoklu aralık istemiyor, gereksiz karmaşıklık olurdu.
 */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;

  const [, rawStart, rawEnd] = m;

  // "bytes=-500" → son 500 bayt
  if (rawStart === "") {
    if (rawEnd === "") return null;
    const len = Number(rawEnd);
    if (!Number.isFinite(len) || len <= 0) return null;
    return { start: Math.max(0, size - len), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return null;

  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return null;

  return { start, end };
}

export async function serveRunAssets(runRootAbs: string): Promise<AssetServer> {
  const runRoot = path.resolve(runRootAbs);

  const server = http.createServer(async (req, res) => {
    try {
      // `req.url` daima "/..." ile başlıyor; host kısmı önemsiz, yalnızca
      // pathname'i çözmek için sahte bir taban veriyoruz.
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");

      /**
       * Traversal koruması — `app/api/runs/[runId]/asset/route.ts:48-57`'deki
       * desenin aynısı: ÖNCE çöz, SONRA kapsama kontrolü yap. Sadece ".." arayan
       * bir kontrol sembolik bağlarla atlatılabilir.
       */
      const resolved = path.resolve(runRoot, rel);
      const within = resolved === runRoot || resolved.startsWith(runRoot + path.sep);
      if (!within) {
        res.writeHead(403).end("kapsam dışı");
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      const type = CONTENT_TYPES[ext];
      if (!type) {
        res.writeHead(415).end(`desteklenmeyen uzantı: ${ext}`);
        return;
      }

      const stat = await fsp.stat(resolved).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.writeHead(404).end("bulunamadı");
        return;
      }

      const common = {
        "Content-Type": type,
        // Chromium'un video için byte aralığı istemesini SAĞLAYAN başlık.
        // Bu olmadan seek yapamıyor ve OffthreadVideo kare çıkaramıyor —
        // sonuç siyah kareler veya dakikalar süren render.
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      };

      if (req.method === "HEAD") {
        res.writeHead(200, { ...common, "Content-Length": String(stat.size) }).end();
        return;
      }

      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const range = parseRange(rangeHeader, stat.size);
        if (!range) {
          res
            .writeHead(416, { ...common, "Content-Range": `bytes */${stat.size}` })
            .end();
          return;
        }
        res.writeHead(206, {
          ...common,
          "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
          "Content-Length": String(range.end - range.start + 1),
        });
        createReadStream(resolved, { start: range.start, end: range.end }).pipe(res);
        return;
      }

      res.writeHead(200, { ...common, "Content-Length": String(stat.size) });
      createReadStream(resolved).pipe(res);
    } catch (err) {
      // İstek başına hata sunucuyu düşürmemeli — render sırasında yüzlerce
      // istek geliyor, biri bozuksa diğerleri sürmeli.
      res.writeHead(500).end(`asset sunucu hatası: ${(err as Error).message}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Port 0 = efemer port. 127.0.0.1'e bağlıyoruz: dış ağa açılmasın.
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,

    urlFor(absOrRel: string): string {
      const abs = path.isAbsolute(absOrRel)
        ? absOrRel
        : path.resolve(process.cwd(), absOrRel);
      const rel = path.relative(runRoot, abs);
      if (rel.startsWith("..")) {
        throw new Error(
          `Asset run kökünün dışında: ${absOrRel}\n` +
            `Kök: ${runRoot}\n` +
            `Tüm render girdileri run'ın assets/ klasörü altında olmalı.`,
        );
      }
      // Yol ayırıcıyı URL'e çevir ve her parçayı ayrı kodla — boşluklu dosya
      // adları (telefon çekimlerinde sık) aksi halde bozuk URL üretiyor.
      const encoded = rel.split(path.sep).map(encodeURIComponent).join("/");
      return `${baseUrl}/${encoded}`;
    },

    close(): Promise<void> {
      return new Promise((resolve) => {
        // Açık bağlantıları da kapat: Chromium keep-alive bırakıyor ve
        // close() tek başına asılı kalabiliyor.
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}
