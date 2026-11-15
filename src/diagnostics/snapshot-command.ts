/**
 * The `debug snapshot` console command (#987, doc/debug-snapshot.md). Development builds compose
 * it (src/main.ts registers it only under `import.meta.env.DEV`); a production console has no
 * such command. It prints the snapshot and copies it only on this explicit command; if the
 * clipboard refuses, it says to select the printed text instead.
 */
import type { ConsoleCommand } from "../console/commands";
import type { DebugSnapshot } from "./debug-snapshot";

/** What copying achieved: copied, or not, with the explanation the clipboard capability gives. */
export type CopyResult = { copied: true } | { copied: false; explanation: string };

/** Over plain HTTP on a network address the browser offers no clipboard at all (#1260). */
export const insecureContextExplanation =
  "Automatic clipboard copying requires HTTPS or localhost. Select the snapshot text above and copy it manually.";
/** Any other refusal in a secure context: permission, focus or an unavailable API. */
export const refusedExplanation = "could not copy: select the snapshot text above instead";

/**
 * The browser clipboard. It never throws: an insecure context, where the browser withholds the
 * clipboard, is explained as such; any other refusal keeps the generic explanation.
 */
export async function copyToClipboard(
  text: string,
  environment: { isSecureContext?: boolean; clipboard?: Pick<Clipboard, "writeText"> } = {
    isSecureContext: globalThis.isSecureContext,
    clipboard: globalThis.navigator?.clipboard,
  },
): Promise<CopyResult> {
  if (environment.isSecureContext === false)
    return { copied: false, explanation: insecureContextExplanation };
  try {
    if (!environment.clipboard) throw new Error("no clipboard");
    await environment.clipboard.writeText(text);
    return { copied: true };
  } catch {
    return { copied: false, explanation: refusedExplanation };
  }
}

export function debugSnapshotCommand(
  snapshot: () => DebugSnapshot,
  copyText: (text: string) => Promise<CopyResult> = copyToClipboard,
): ConsoleCommand {
  return {
    name: "debug snapshot",
    usage: "",
    help: "print read-only diagnostics and copy them to the clipboard (#987)",
    run(host) {
      // One line, so the console's screen limit can never cut off the start of the report,
      // and the whole of it stays selectable if the clipboard refuses.
      const text = JSON.stringify(snapshot());
      void copyText(text).then((result) =>
        result.copied
          ? host.say("snapshot copied to the clipboard", "output")
          : host.say(result.explanation, "error"),
      );
      return text;
    },
  };
}
