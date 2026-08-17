import fs from "node:fs/promises";
import path from "node:path";
import { isMock } from "../config/mock";
import { runAssetsDir } from "../orchestrator/paths";
import { voiceableScenes, type AgentResult, type RunState } from "../orchestrator/types";
import { wordsFromCharAlignment } from "../audio/words";

async function requireKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voiceId) {
    throw new Error(
      "ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID tanımlı değil (.env.local).",
    );
  }
  return { key, voiceId };
}

async function callElevenLabs(text: string, key: string, voiceId: string) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    },
  );
  if (!res.ok) {
    // Gövdeyi OKUYORUZ: ElevenLabs hatanın sebebini burada anlatıyor ve durum
    // kodu tek başına yanıltıcı. Örnek (canlı testte yaşandı): geçersiz anahtar
    // 401 değil 400 döndürüyor ve "API key ID used as API key" açıklaması
    // yalnızca gövdede. Yalnızca status yazan bir hata mesajı, saatlerce yanlış
    // yerde (kota? model adı? endpoint?) arattırır.
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 500);
    try {
      const parsed = JSON.parse(body);
      const d = parsed?.detail;
      if (d) detail = typeof d === "string" ? d : (d.message ?? JSON.stringify(d));
    } catch {
      // JSON değilse ham metin zaten yukarıda.
    }
    throw new Error(
      `ElevenLabs hata: ${res.status} ${res.statusText}` +
        (detail ? ` — ${detail}` : ""),
    );
  }
  return res.json() as Promise<{
    audio_base64: string;
    alignment: { characters: string[]; character_start_times_seconds: number[] };
  }>;
}

export async function runVoiceAgent(state: RunState): Promise<AgentResult> {
  const assetsDir = path.join(runAssetsDir(state.projectSlug, state.runId), "voice");
  await fs.mkdir(assetsDir, { recursive: true });

  const voiceAssets: Record<string, string> = {};
  const wordAssets: Record<string, string> = {};
  // Moddan bağımsız sahne listesi — bkz. types.ts voiceableScenes(). Eskiden
  // burada videoScenes() vardı ve real-video modunda BOŞ dönüyordu.
  const scenes = voiceableScenes(state);

  if (scenes.length === 0) {
    throw new Error(
      `Seslendirilecek sahne yok (mod: ${state.mode}, yük: ${state.payload.kind}). ` +
        `Senaryo/copy aşaması önce koşmalı.`,
    );
  }

  if (isMock("voice")) {
    for (const scene of scenes) {
      const p = path.join(assetsDir, `${scene.id}.json`);
      await fs.writeFile(
        p,
        JSON.stringify(
          {
            mock: true,
            sceneId: scene.id,
            text: scene.voiceLine,
            durationSec: scene.durationSec,
            timecodes: "MOCK — gerçek modda ElevenLabs karakter-zaman hizalaması burada olur.",
          },
          null,
          2,
        ),
      );
      voiceAssets[scene.id] = path.relative(process.cwd(), p);
    }
    return {
      patch: { assets: { ...state.assets, voice: voiceAssets } },
      note: `[MOCK] ${scenes.length} sahne için placeholder ses kaydı üretildi.`,
    };
  }

  const { key, voiceId } = await requireKey();
  let totalWords = 0;
  for (const scene of scenes) {
    const result = await callElevenLabs(scene.voiceLine, key, voiceId);
    const audioPath = path.join(assetsDir, `${scene.id}.mp3`);
    await fs.writeFile(audioPath, Buffer.from(result.audio_base64, "base64"));
    const timecodesPath = path.join(assetsDir, `${scene.id}.timecodes.json`);
    await fs.writeFile(timecodesPath, JSON.stringify(result.alignment, null, 2));

    /**
     * Karakter hizalamasını KELİMEYE çevirip ayrıca yazıyoruz.
     *
     * Eskiden yalnızca `.timecodes.json` yazılıyordu ve kod tabanında onu okuyan
     * tek satır yoktu — CapCut görünümünün en zor girdisi üretilip çöpe
     * atılıyordu. Kelime damgaları altyazı katmanının ve çapa çözücünün doğrudan
     * tükettiği şey.
     */
    const words = wordsFromCharAlignment(result.alignment);
    const wordsPath = path.join(assetsDir, `${scene.id}.words.json`);
    await fs.writeFile(wordsPath, JSON.stringify(words, null, 2));
    totalWords += words.length;

    voiceAssets[scene.id] = path.relative(process.cwd(), audioPath);
    wordAssets[scene.id] = path.relative(process.cwd(), wordsPath);
  }

  return {
    patch: {
      assets: {
        ...state.assets,
        voice: voiceAssets,
        words: { ...(state.assets.words ?? {}), ...wordAssets },
      },
    },
    note: `${scenes.length} sahne için ElevenLabs sesi üretildi — ${totalWords} kelime damgası çıkarıldı.`,
  };
}
