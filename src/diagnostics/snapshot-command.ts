/**
 * The `debug snapshot` console command (#987, doc/debug-snapshot.md). Development builds compose
 * it (src/main.ts registers it only under `import.meta.env.DEV`); a production console has no
 * such command. It prints the snapshot and copies it only on this explicit command; if the
 * clipboard refuses, it says to select the printed text instead.
 */
import type { ConsoleCommand } from "../console/commands";
import type { DebugSnapshot } from "./debug-snapshot";

/** The browser clipboard; a refusal or a missing API resolves false, never throws. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function debugSnapshotCommand(
  snapshot: () => DebugSnapshot,
  copyText: (text: string) => Promise<boolean> = copyToClipboard,
): ConsoleCommand {
  return {
    name: "debug snapshot",
    usage: "",
    help: "print read-only diagnostics and copy them to the clipboard (#987)",
    run(host) {
      const text = JSON.stringify(snapshot(), null, 2);
      void copyText(text).then((copied) =>
        copied
          ? host.say("snapshot copied to the clipboard", "output")
          : host.say("could not copy: select the snapshot text above instead", "error"),
      );
      return text.split("\n");
    },
  };
}
