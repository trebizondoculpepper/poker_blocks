/**
 * The smoke and dust audition room's note (#466): a developer tool, loaded only in development
 * builds (src/main.ts), shown by the `devEffectAudition` scene trait while its scene is on the
 * stack and hidden when it leaves. It only explains the room; the looks themselves come from the
 * mode's deck (experimental definitions with smoke and dust effects), rendered like any card.
 */
export type EffectAuditionNote = {
  show(config: { hint: string }): void;
  hide(): void;
  dispose(): void;
};

export function createEffectAuditionNote(host: HTMLElement): EffectAuditionNote {
  let note: HTMLElement | null = null;
  const hide = () => {
    note?.remove();
    note = null;
  };
  return {
    show({ hint }) {
      hide();
      note = document.createElement("p");
      note.className = "dev-effect-audition";
      note.textContent = hint;
      host.append(note);
    },
    hide,
    dispose: hide,
  };
}
