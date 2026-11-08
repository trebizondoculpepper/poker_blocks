// Generate missing sound-effect files with the ElevenLabs sound-effects API.
// Run locally, once: the results are committed, so builds and CI never call ElevenLabs.
//
//   npm run sfx -- --list                                   # show what is missing
//   ELEVENLABS_API_KEY=... npm run sfx                      # generate missing files only
//   ELEVENLABS_API_KEY=... npm run sfx -- card.attach       # only these ids
//   ELEVENLABS_API_KEY=... npm run sfx -- --force card.attach  # regenerate
//
// Entries without a `prompt` are skipped and listed; write a prompt for them first.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  sfxFileNames,
  sfxStyle,
  soundEffects,
  withSfxDefaults,
} from "../src/audio/sfx-registry.ts";

const outputDir = join(import.meta.dirname, "..", "src", "assets", "sfx");
const endpoint = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128";

const args = process.argv.slice(2);
const force = args.includes("--force");
const listOnly = args.includes("--list");
const wanted = new Set(args.filter((arg) => !arg.startsWith("--")));
const unknown = [...wanted].filter((id) => !soundEffects.some((effect) => effect.id === id));
if (unknown.length > 0) {
  console.error(`Unknown sound ids: ${unknown.join(", ")}`);
  process.exit(1);
}

const selected = soundEffects.filter((effect) => wanted.size === 0 || wanted.has(effect.id));
const needsPrompt = selected.filter((effect) => !effect.prompt?.trim());
const jobs = selected
  .filter((effect) => effect.prompt?.trim())
  .flatMap((effect) =>
    sfxFileNames(effect)
      .filter((fileName) => force || !existsSync(join(outputDir, fileName)))
      .map((fileName) => ({ effect: withSfxDefaults(effect), fileName })),
  );

if (needsPrompt.length > 0) {
  console.log("Needs a prompt before audio can be generated:");
  for (const effect of needsPrompt) console.log(`  ${effect.id}: ${effect.trigger}`);
}
if (listOnly) {
  console.log(
    jobs.length > 0
      ? `Ready to generate:\n${jobs.map((job) => `  ${job.fileName}`).join("\n")}`
      : "No files to generate.",
  );
  process.exit(0);
}
if (jobs.length === 0) {
  console.log("Nothing to generate.");
  process.exit(0);
}

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Set ELEVENLABS_API_KEY to generate sounds.");
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
for (const { effect, fileName } of jobs) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      text: `${effect.prompt}. ${sfxStyle}`,
      duration_seconds: effect.durationSeconds,
      prompt_influence: effect.promptInfluence,
    }),
  });
  if (!response.ok) {
    console.error(`${fileName}: HTTP ${response.status} ${await response.text()}`);
    process.exit(1);
  }
  writeFileSync(join(outputDir, fileName), Buffer.from(await response.arrayBuffer()));
  console.log(`wrote ${fileName}`);
}
console.log(`Generated ${jobs.length} file(s).`);
