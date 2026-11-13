/**
 * The release-status facet (#811; doc/release-status.md). Every definition admitted to a new
 * availability catalogue declares exactly one member, `certified` or `provisional`, on itself.
 * Each member brings behaviour: the admission operation it contributes to, and the immutable
 * descriptor views show. A catalogue composes the admission operations it allows (normal play:
 * `certified`; an explicit experimental catalogue: both), and a generic runner applies them
 * uniformly. Nothing here reads a status as a flag, names a definition, a room or a dev mode.
 *
 * Admission is separate from lookup: a definition left out of a catalogue stays resolvable by ID
 * for saves and inspection. Missing or conflicting declarations fail; nothing ever defaults into
 * production.
 */
import { Registry } from "./core/registry";

/** What views show for a status: its label and what it means for normal play. */
export type ReleaseStatusDescriptor = Readonly<{ label: string; explanation: string }>;

/** One definition offered to a catalogue: where it was in the list, and its status descriptor. */
export type Contribution<T> = Readonly<{
  definition: T;
  index: number;
  status: ReleaseStatusDescriptor;
}>;

/** Where members put their contributions while a catalogue is composed: one list per operation. */
export type AdmissionContributions = {
  add(operation: string, contribution: Contribution<unknown>): void;
};

export type ReleaseStatusMember = Readonly<{
  descriptor: ReleaseStatusDescriptor;
  /** Register this definition with the admission operation(s) this status takes part in. */
  contribute(contribution: Contribution<unknown>, contributions: AdmissionContributions): void;
}>;

export const releaseStatuses = new Registry<ReleaseStatusMember>("release status");

/** A registered admission operation: which of its contributions a catalogue admits. */
export type AdmissionOperation = <T>(
  contributions: readonly Contribution<T>[],
) => Contribution<T>[];
export const admissionOperations = new Registry<AdmissionOperation>("admission operation");

// Each status admits every definition contributed to it; finer policy (unlocks, weights) stays
// with the catalogue's own generation, after admission.
admissionOperations.register("certified", (contributions) => [...contributions]);
admissionOperations.register("provisional", (contributions) => [...contributions]);

releaseStatuses.register("certified", {
  descriptor: Object.freeze({
    label: "Certified",
    explanation: "Approved for normal play, subject to the usual unlocks and weights.",
  }),
  contribute: (contribution, contributions) => contributions.add("certified", contribution),
});
releaseStatuses.register("provisional", {
  descriptor: Object.freeze({
    label: "Provisional",
    explanation: "Experimental: only in explicitly experimental catalogues, never in normal play.",
  }),
  contribute: (contribution, contributions) => contributions.add("provisional", contribution),
});

/** A definition's own declaration: the facet members it names, each with any configuration. */
export type ReleaseStatusDeclaration = Readonly<Record<string, unknown>>;

export class ReleaseStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseStatusError";
  }
}

/** The one effective member a declaration names; anything else is a registration error. */
export function resolveReleaseStatus(
  owner: string,
  declaration: ReleaseStatusDeclaration | undefined,
): string {
  const named = Object.keys(declaration ?? {});
  const unknown = named.filter((name) => !releaseStatuses.has(name));
  if (unknown.length)
    throw new ReleaseStatusError(`${owner}: unknown release status ${unknown.join(", ")}`);
  if (named.length !== 1)
    throw new ReleaseStatusError(
      named.length
        ? `${owner}: conflicting release statuses ${named.join(", ")}`
        : `${owner}: no release status declared`,
    );
  return named[0]!;
}

/** What a catalogue admits: the registered admission operations it composes, request-local. */
export type CatalogueAccess = Readonly<{ operations: readonly string[] }>;

/** Normal play: the certified admission only. */
export const ordinaryCatalogue: CatalogueAccess = Object.freeze({ operations: ["certified"] });
/** An explicitly experimental catalogue: both admissions. */
export const experimentalCatalogue: CatalogueAccess = Object.freeze({
  operations: ["certified", "provisional"],
});

export type Admitted<T> = Readonly<{ definition: T; status: ReleaseStatusDescriptor }>;

/**
 * The definitions a catalogue admits, in their given order, each with its status descriptor.
 * Every declaration is resolved first, so one bad declaration rejects the whole composition.
 * Then each definition's member contributes it, and each operation the catalogue composes is
 * dispatched over its own contributions. The contributions belong to this call alone.
 */
export function composeCatalogue<T>(
  definitions: readonly T[],
  ownerOf: (definition: T) => string,
  declarationOf: (definition: T) => ReleaseStatusDeclaration | undefined,
  access: CatalogueAccess,
): Admitted<T>[] {
  const members = definitions.map((definition) =>
    releaseStatuses.get(resolveReleaseStatus(ownerOf(definition), declarationOf(definition))),
  );
  const byOperation = new Map<string, Contribution<T>[]>();
  const contributions: AdmissionContributions = {
    add: (operation, contribution) =>
      byOperation.set(operation, [
        ...(byOperation.get(operation) ?? []),
        contribution as Contribution<T>,
      ]),
  };
  members.forEach((member, index) =>
    member.contribute(
      { definition: definitions[index], index, status: member.descriptor },
      contributions,
    ),
  );
  return access.operations
    .flatMap((operation) => admissionOperations.get(operation)(byOperation.get(operation) ?? []))
    .sort((a, b) => a.index - b.index)
    .map(({ definition, status }) => ({ definition, status }));
}
