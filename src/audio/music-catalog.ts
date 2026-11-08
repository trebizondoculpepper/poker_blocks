// Every committed loop in music/loops/, with its measured tempo, beats and downbeat.
// Ids are file stems without "-loop", e.g. "style-noir" or "solitaire-boss".
import type { LoopInfo, MusicTrack } from "./music-player";

const urls = import.meta.glob<string>("../../music/loops/*-loop.ogg", {
  eager: true,
  query: "?url",
  import: "default",
});
const infos = import.meta.glob<LoopInfo>("../../music/loops/*-loop.json", {
  eager: true,
  import: "default",
});

export const musicTracks: MusicTrack[] = Object.entries(urls)
  .map(([path, url]) => ({
    id: path.slice(path.lastIndexOf("/") + 1).replace(/-loop\.ogg$/, ""),
    url,
    info: infos[path.replace(/\.ogg$/, ".json")],
  }))
  .filter(({ info }) => info && Number.isInteger(info.beats))
  .sort((a, b) => a.id.localeCompare(b.id));
