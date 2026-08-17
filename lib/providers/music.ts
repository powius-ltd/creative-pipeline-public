export interface MusicProvider {
  name: string;
  generateTrack(opts: {
    mood: string;
    durationSec: number;
  }): Promise<{ path: string }>;
}

// ElevenLabs Music is primary (same vendor/key as the voice agent); fal's music
// model is the fallback if ElevenLabs Music isn't enabled on the account.
async function requireElevenLabsKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY tanımlı değil (.env.local).");
  return key;
}

export const elevenLabsMusicProvider: MusicProvider = {
  name: "elevenlabs-music",
  async generateTrack(opts) {
    const key = await requireElevenLabsKey();
    const res = await fetch("https://api.elevenlabs.io/v1/music", {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `${opts.mood} background music for a short product video`,
        duration_seconds: opts.durationSec,
      }),
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs Music hata: ${res.status} ${res.statusText}`);
    }
    // Real integration pass: stream response body to projects/<slug>/runs/<id>/assets/music/.
    throw new Error(
      "ElevenLabs Music yanıtı alındı ama dosyaya yazma adımı henüz bağlanmadı.",
    );
  },
};

export const falMusicProvider: MusicProvider = {
  name: "fal-music",
  async generateTrack() {
    throw new Error("fal müzik modeli henüz bağlanmadı (fallback, açık madde).");
  },
};

export function getMusicProvider(): MusicProvider {
  if (process.env.ELEVENLABS_API_KEY) return elevenLabsMusicProvider;
  return falMusicProvider;
}
