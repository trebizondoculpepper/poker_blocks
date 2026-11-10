// Development page for auditioning every registered sound effect. Served at /sfx.html.
import "./style.css";
import { sfxFileNames, soundEffects, withSfxDefaults } from "../../audio/sfx-registry";
// How many places use each sound: the registry's record (npm run sfx:usage).
import usage from "../../audio/sfx-usage.json";

const urls = import.meta.glob<string>("../../assets/sfx/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
});
const urlByFile = new Map(
  Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]),
);

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

const list = element<HTMLOListElement>("sounds");
const volume = element<HTMLInputElement>("volume");
const pitch = element<HTMLInputElement>("pitch");
const pitchValue = element<HTMLOutputElement>("pitch-value");
const jitter = element<HTMLInputElement>("jitter");

const playing = new Set<HTMLAudioElement>();
let sequence = 0;

function stopAll(): void {
  sequence++;
  for (const audio of playing) audio.pause();
  playing.clear();
  document.querySelectorAll(".sound.playing").forEach((row) => row.classList.remove("playing"));
}

/** Plays one file; resolves when it ends. `rate` multiplies the pitch slider. */
function play(url: string, row: HTMLElement | null, rate = 1): Promise<void> {
  const audio = new Audio(url);
  const spread = jitter.checked ? 1 + (Math.random() * 2 - 1) * 0.08 : 1;
  audio.volume = Number(volume.value);
  audio.preservesPitch = false;
  audio.playbackRate = Number(pitch.value) * rate * spread;
  playing.add(audio);
  row?.classList.add("playing");
  return new Promise((resolve) => {
    const done = () => {
      playing.delete(audio);
      row?.classList.remove("playing");
      resolve();
    };
    audio.addEventListener("ended", done, { once: true });
    audio.addEventListener("pause", done, { once: true });
    audio.play().catch(done);
  });
}

/** Show a short confirmation on a button, then put its label back. */
function flash(button: HTMLButtonElement, text: string): void {
  const label = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = label), 1200);
}

type Entry = { row: HTMLLIElement; takes: string[] };
const entries: Entry[] = [];

for (const [index, effect] of soundEffects.entries()) {
  const takes = sfxFileNames(effect).flatMap((name) => urlByFile.get(name) ?? []);
  const row = document.createElement("li");
  row.className = "sound";
  if (takes.length === 0) row.classList.add("missing");

  const main = document.createElement("button");
  main.type = "button";
  main.className = "sound-main";
  const key = index < 9 ? String(index + 1) : index === 9 ? "0" : "";
  main.innerHTML = `
    <span class="sound-key">${key}</span>
    <span class="sound-text">
      <span class="sound-id"></span>
      <span class="sound-trigger"></span>
      <span class="sound-prompt"></span>
    </span>
    <span class="sound-meta"></span>
    <span class="sound-usage"></span>`;
  main.querySelector(".sound-id")!.textContent = effect.id;
  main.querySelector(".sound-trigger")!.textContent = effect.trigger;
  main.querySelector(".sound-prompt")!.textContent = effect.prompt
    ? `“${effect.prompt}”`
    : "No prompt yet";
  main.querySelector(".sound-meta")!.textContent =
    takes.length > 0
      ? `${withSfxDefaults(effect).durationSeconds}s`
      : effect.prompt
        ? "not generated"
        : "needs prompt";
  const used = (usage as Record<string, { uses: number; files: Record<string, number> }>)[
    effect.id
  ] ?? { uses: 0, files: {} };
  const badge = main.querySelector<HTMLElement>(".sound-usage")!;
  badge.textContent = used.uses > 0 ? `used ×${used.uses}` : "unused";
  badge.title =
    used.uses > 0
      ? Object.entries(used.files)
          .map(([file, count]) => `${file} ×${count}`)
          .join("\n")
      : "No code or data names this sound";
  row.classList.add(used.uses > 0 ? "used" : "unused");
  main.disabled = takes.length === 0;
  main.addEventListener("click", () => {
    const take = takes[Math.floor(Math.random() * takes.length)];
    void play(take, row);
  });
  // Copy the sound's id, to paste into a ticket, a chat or `playSfx("…")`.
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "sound-copy";
  copy.textContent = "Copy";
  copy.title = `Copy “${effect.id}”`;
  copy.setAttribute("aria-label", `Copy the id ${effect.id}`);
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(effect.id).then(
      () => flash(copy, "Copied"),
      () => flash(copy, "Copy failed"),
    );
  });
  const head = document.createElement("div");
  head.className = "sound-head";
  head.append(main, copy);
  row.append(head);

  if (takes.length > 1) {
    const variants = document.createElement("div");
    variants.className = "sound-variants";
    takes.forEach((take, n) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Take ${n + 1}`;
      button.addEventListener("click", () => void play(take, row));
      variants.append(button);
    });
    row.append(variants);
  }

  list.append(row);
  entries.push({ row, takes });
}

element("play-all").addEventListener("click", async () => {
  stopAll();
  const run = sequence;
  for (const { row, takes } of entries) {
    for (const take of takes) {
      if (run !== sequence) return;
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      await play(take, row);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
});

element("stop").addEventListener("click", stopAll);

// Show all sounds, only the ones the game uses, or only the unused ones.
const usageFilter = element<HTMLSelectElement>("usage-filter");
usageFilter.addEventListener("change", () => {
  list.dataset.show = usageFilter.value;
});

// Preview of a chain: one registered sound repeated at rising pitch, two semitones apart. The
// sound is chosen from the registry, and `?sound=<id>` in the URL preselects it (#71).
const chainSound = element("chain-sound") as HTMLSelectElement;
for (const effect of soundEffects) {
  chainSound.append(new Option(`${effect.id} — ${effect.trigger}`, effect.id));
}
chainSound.value = new URLSearchParams(location.search).get("sound") ?? chainSound.value;
chainSound.addEventListener("change", () => {
  const url = new URL(location.href);
  url.searchParams.set("sound", chainSound.value);
  history.replaceState(null, "", url);
});

element("chain").addEventListener("click", async () => {
  const entry = entries[soundEffects.findIndex(({ id }) => id === chainSound.value)];
  if (!entry || entry.takes.length === 0) return;
  stopAll();
  const run = sequence;
  for (let step = 0; step < 5; step++) {
    if (run !== sequence) return;
    void play(entry.takes[0], entry.row, 2 ** ((step * 2) / 12));
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
});

pitch.addEventListener("input", () => {
  pitchValue.textContent = `${Number(pitch.value).toFixed(2)}×`;
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
  if (event.key === "Escape") return stopAll();
  const index = event.key === "0" ? 9 : Number(event.key) - 1;
  entries[index]?.row.querySelector<HTMLButtonElement>(".sound-main")?.click();
});
