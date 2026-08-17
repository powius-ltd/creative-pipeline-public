import type { GenerationProvider } from "./index";

// Higgsfield is used as an MCP tool in the Claude session that designed this pipeline,
// not as a documented public REST API. This adapter is a placeholder seam: fill in the
// real endpoint once Higgsfield's programmatic (non-MCP) API access is confirmed.
// Until then, selecting this provider without HIGGSFIELD_API_KEY set throws clearly
// rather than silently falling through to a different provider.

async function requireKey() {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!key) {
    throw new Error(
      "HIGGSFIELD_API_KEY tanımlı değil. Higgsfield programatik API erişimi netleşene kadar " +
        "generation provider olarak fal.ts kullanılmalı.",
    );
  }
  return key;
}

export const higgsfieldProvider: GenerationProvider = {
  name: "higgsfield",

  async generateImage(prompt) {
    await requireKey();
    throw new Error(
      `Higgsfield generateImage henüz bağlanmadı (prompt: "${prompt.slice(0, 40)}..."). ` +
        `Gerçek HTTP entegrasyonu bekleniyor.`,
    );
  },

  async editImage(prompt, opts) {
    await requireKey();
    throw new Error(
      `Higgsfield editImage henüz bağlanmadı (varyant: ${opts.variant}, ` +
        `prompt: "${prompt.slice(0, 40)}..."). Gerçek HTTP entegrasyonu bekleniyor.`,
    );
  },

  async generateVideo(prompt, opts) {
    await requireKey();
    throw new Error(
      `Higgsfield generateVideo henüz bağlanmadı (prompt: "${prompt.slice(0, 40)}...", ` +
        `durationSec: ${opts?.durationSec ?? "?"}). Gerçek HTTP entegrasyonu bekleniyor.`,
    );
  },
};
