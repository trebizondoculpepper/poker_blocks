/** A run outcome selects a scene stack operation declared by the active mode. */
export type FlowTransition<Scene extends string> =
  | { readonly operation: "replace"; readonly scene: Scene }
  | { readonly operation: "push"; readonly scene: Scene }
  | { readonly operation: "pop" };

export type GameFlow<Outcome extends string, Scene extends string> = Readonly<
  Record<Outcome, FlowTransition<Scene>>
>;

export type FlowStack<Scene extends string> = {
  replace(scene: Scene): void;
  push(scene: Scene): void;
  pop(): void;
};

/** Generic dispatch; only mode data knows which scene follows an outcome. */
export function followFlow<Outcome extends string, Scene extends string>(
  flow: GameFlow<Outcome, Scene>,
  outcome: Outcome,
  stack: FlowStack<Scene>,
): void {
  const transition = flow[outcome];
  if (!transition) throw new Error(`No game flow transition for ${outcome}`);
  const operations: {
    [Operation in FlowTransition<Scene>["operation"]]: (
      step: Extract<FlowTransition<Scene>, { operation: Operation }>,
    ) => void;
  } = {
    replace: (step) => stack.replace(step.scene),
    push: (step) => stack.push(step.scene),
    pop: () => stack.pop(),
  };
  // The operation is a registered behaviour, not a branch on the outcome or scene.
  (operations[transition.operation] as (step: FlowTransition<Scene>) => void)(transition);
}
