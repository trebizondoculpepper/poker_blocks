import "./style.css";
import { MusicMixer } from "../audio/music-mixer";

const files = import.meta.glob<string>("../assets/music/*.ogg", {
  eager: true,
  query: "?url",
  import: "default",
});
const urls = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.split("/").at(-1)!.replace(".ogg", ""), url]),
);

const tracks = [
  { id: "jazz-funk", name: "Main theme · jazz funk", duration: 269.73 },
  { id: "bluegrass", name: "Bluegrass", duration: 181.77 },
  { id: "boss", name: "Frantic boss attack", duration: 126.74 },
  { id: "chiptune", name: "Chip tune", duration: 70.22 },
  { id: "musical", name: "1950s musical", duration: 192.96 },
  { id: "electro-funk", name: "90s electro funk", duration: 140.63 },
  { id: "big-band", name: "Old timey big band", duration: 181.73 },
];

async function durationOf(url: string): Promise<number> {
  const audio = new Audio();
  audio.preload = "metadata";
  audio.src = url;
  return new Promise((resolve, reject) => {
    audio.addEventListener("loadedmetadata", () => resolve(audio.duration), { once: true });
    audio.addEventListener("error", () => reject(new Error(`Could not inspect ${url}`)), {
      once: true,
    });
    audio.load();
  });
}

await Promise.all(
  tracks.map(async (track) => {
    track.duration = await durationOf(urls[track.id]);
  }),
);
const shortest = Math.min(...tracks.map((track) => track.duration));
const longest = Math.max(...tracks.map((track) => track.duration));
const initialLoop = Math.floor(shortest * 10) / 10;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

const deckA = element<HTMLSelectElement>("deck-a");
const deckB = element<HTMLSelectElement>("deck-b");
const playButton = element<HTMLButtonElement>("play");
const position = element<HTMLInputElement>("position");
const time = element<HTMLOutputElement>("time");
const blend = element<HTMLInputElement>("blend");
const loopInput = element<HTMLInputElement>("loop-seconds");
const fadeInput = element<HTMLInputElement>("fade-seconds");
const status = element<HTMLParagraphElement>("status");

for (const track of tracks) {
  for (const select of [deckA, deckB]) {
    const option = document.createElement("option");
    option.value = track.id;
    option.textContent = track.name;
    select.add(option);
  }
}
deckA.value = "jazz-funk";
deckB.value = "bluegrass";
const mixer = new MusicMixer(urls, [deckA.value, deckB.value], initialLoop);
loopInput.max = String(initialLoop);
loopInput.value = String(initialLoop);
position.max = String(initialLoop);
element<HTMLOutputElement>("loop-display").textContent = initialLoop.toFixed(1);
element<HTMLElement>("alignment").textContent =
  longest - shortest > 0.15
    ? `Length mismatch: ${formatTime(shortest)} to ${formatTime(longest)}. Replace these files with equal-length versions for full-tune blending. The current room uses a shorter preview loop.`
    : `All arrangements are about ${formatTime(shortest)} long. The full tune is available as the shared loop.`;

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function updateLengths(): void {
  for (const [select, id] of [
    [deckA, "length-a"],
    [deckB, "length-b"],
  ] as const) {
    const track = tracks.find((entry) => entry.id === select.value)!;
    element<HTMLElement>(id).textContent = `Source length ${formatTime(track.duration)}`;
  }
}
updateLengths();

function updateTime(): void {
  const current = mixer.position;
  if (!position.matches(":active")) position.value = String(current);
  time.textContent = `${formatTime(current)} / ${formatTime(Number(position.max))}`;
  requestAnimationFrame(updateTime);
}
requestAnimationFrame(updateTime);

async function run(task: () => Promise<void>): Promise<void> {
  try {
    status.textContent = "Loading audio…";
    await task();
    status.textContent = mixer.isPlaying ? "Playing synchronized arrangements." : "Paused.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Audio could not be played.";
  }
}

playButton.addEventListener("click", () => {
  if (mixer.isPlaying) {
    mixer.pause();
    playButton.textContent = "Play";
    status.textContent = "Paused.";
    return;
  }
  playButton.disabled = true;
  deckA.disabled = true;
  deckB.disabled = true;
  void run(() => mixer.play()).finally(() => {
    playButton.disabled = false;
    deckA.disabled = false;
    deckB.disabled = false;
    playButton.textContent = mixer.isPlaying ? "Pause" : "Play";
  });
});

element("restart").addEventListener("click", () => {
  void run(() => mixer.seek(0)).then(
    () => (playButton.textContent = mixer.isPlaying ? "Pause" : "Play"),
  );
});

for (const [slot, select] of [
  [0, deckA],
  [1, deckB],
] as const) {
  select.addEventListener("change", () => {
    updateLengths();
    void run(() => mixer.select(slot, select.value, Number(fadeInput.value)));
  });
}

blend.addEventListener("input", () => {
  cancelAnimationFrame(fadeFrame);
  mixer.setBlend(Number(blend.value));
});

let fadeFrame = 0;
function fadeTo(target: number): void {
  cancelAnimationFrame(fadeFrame);
  const from = Number(blend.value);
  const duration = Math.max(0.1, Math.min(20, Number(fadeInput.value) || 2));
  const started = performance.now();
  mixer.setBlend(target, duration);
  function tick(now: number): void {
    const progress = Math.min(1, (now - started) / (duration * 1000));
    blend.value = String(from + (target - from) * progress);
    if (progress < 1) fadeFrame = requestAnimationFrame(tick);
  }
  fadeFrame = requestAnimationFrame(tick);
}
element("fade-a").addEventListener("click", () => fadeTo(0));
element("fade-b").addEventListener("click", () => fadeTo(1));

element<HTMLInputElement>("volume").addEventListener("input", (event) => {
  mixer.setVolume(Number((event.target as HTMLInputElement).value));
});

position.addEventListener("change", () => {
  void run(() => mixer.seek(Number(position.value))).then(
    () => (playButton.textContent = mixer.isPlaying ? "Pause" : "Play"),
  );
});

loopInput.addEventListener("change", () => {
  const seconds = Math.max(5, Math.min(initialLoop, Number(loopInput.value) || initialLoop));
  loopInput.value = String(seconds);
  position.max = String(seconds);
  element<HTMLOutputElement>("loop-display").textContent = seconds.toFixed(1);
  void run(() => mixer.setLoopSeconds(seconds));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && mixer.isPlaying) {
    mixer.pause();
    playButton.textContent = "Play";
    status.textContent = "Paused.";
  }
});
