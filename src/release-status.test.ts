import { describe, expect, it } from "vite-plus/test";
import {
  composeCatalogue,
  experimentalCatalogue,
  ordinaryCatalogue,
  ReleaseStatusError,
  resolveReleaseStatus,
  type ReleaseStatusDeclaration,
} from "./release-status";

type Definition = { id: string; releaseStatus?: ReleaseStatusDeclaration };
const compose = (definitions: Definition[], access = ordinaryCatalogue) =>
  composeCatalogue(
    definitions,
    ({ id }) => id,
    ({ releaseStatus }) => releaseStatus,
    access,
  );

const approved: Definition = { id: "approved", releaseStatus: { certified: {} } };
const trial: Definition = { id: "trial", releaseStatus: { provisional: {} } };

describe("release-status facet (#811)", () => {
  it("keeps provisional definitions out of an ordinary catalogue", () => {
    const admitted = compose([approved, trial]);
    expect(admitted.map(({ definition }) => definition.id)).toEqual(["approved"]);
    expect(admitted[0]!.status.label).toBe("Certified");
  });

  it("admits both, in order, to an explicitly experimental catalogue, with their descriptors", () => {
    const admitted = compose([trial, approved], experimentalCatalogue);
    expect(admitted.map(({ definition, status }) => [definition.id, status.label])).toEqual([
      ["trial", "Provisional"],
      ["approved", "Certified"],
    ]);
    // The experimental request didn't change the ordinary catalogue's answer.
    expect(compose([trial, approved]).map(({ definition }) => definition.id)).toEqual(["approved"]);
  });

  it("never defaults a missing declaration, and rejects conflicting or unknown ones", () => {
    expect(() => compose([{ id: "bare" }])).toThrow(ReleaseStatusError);
    expect(() => resolveReleaseStatus("both", { certified: {}, provisional: {} })).toThrow(
      /conflicting/,
    );
    expect(() => resolveReleaseStatus("odd", { approvedish: {} })).toThrow(/unknown/);
    expect(resolveReleaseStatus("ok", { provisional: {} })).toBe("provisional");
  });

  it("validates the whole set before admitting any", () => {
    expect(() => compose([approved, { id: "bare" }])).toThrow(/bare/);
  });

  it("dispatches each composed operation over its own contributions (#847 review)", async () => {
    const { admissionOperations } = await import("./release-status");
    let seen: string[] = [];
    admissionOperations.register("test.recording", (contributions) => {
      seen = contributions.map(({ definition }) => (definition as Definition).id);
      return [];
    });
    // An operation nothing contributes to admits nothing, and is still dispatched.
    expect(
      composeCatalogue(
        [approved, trial],
        ({ id }) => id,
        ({ releaseStatus }) => releaseStatus,
        {
          operations: ["test.recording"],
        },
      ),
    ).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("shares immutable descriptors", () => {
    const [{ status }] = compose([approved]);
    expect(Object.isFrozen(status)).toBe(true);
  });
});
