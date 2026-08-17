import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // @remotion/renderer platforma özel native compositor binary'lerini koşullu
  // require ediyor (@remotion/compositor-win32-x64-msvc, -darwin-arm64, -linux-…).
  // Next bunları sunucu paketine dahil etmeye çalışınca HEPSİNİ statik çözmeye
  // kalkıyor ve bu platformda kurulu olmayanlarda "Module not found" ile derleme
  // kırılıyor. Paketleri bundle dışı bırakıp native require'a devrediyoruz.
  serverExternalPackages: ["@remotion/renderer", "@remotion/bundler"],
};

export default nextConfig;
