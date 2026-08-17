import React from "react";
import { Audio, staticFile } from "remotion";

const PLAYABLE = [".mp3", ".wav", ".m4a", ".aac"];

// Only renders <Audio> when musicTrack points at an actual playable file.
// In MOCK_MODE the montage agent never sets a real track, so this stays a no-op —
// ducking volume-by-scene is left as an open item until real audio assets exist.
export function MusicTrack({ src }: { src: string | null }) {
  if (!src || !PLAYABLE.some((ext) => src.endsWith(ext))) return null;
  return <Audio src={staticFile(src)} volume={0.5} />;
}
