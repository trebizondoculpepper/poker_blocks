// Record how many places use each registered sound (src/audio/sfx-usage.json).
//   npm run sfx:usage
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatSfxUsage, scanSfxUsage } from "./sfx-usage-scan.ts";

const usage = scanSfxUsage();
writeFileSync(
  join(import.meta.dirname, "..", "src", "audio", "sfx-usage.json"),
  formatSfxUsage(usage),
);
const unused = Object.entries(usage).filter(([, { uses }]) => uses === 0);
console.log(`Recorded ${Object.keys(usage).length} sounds; ${unused.length} used nowhere:`);
for (const [id] of unused) console.log(`  ${id}`);
