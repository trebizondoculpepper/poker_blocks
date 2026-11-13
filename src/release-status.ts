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

export type ReleaseStatusMember = Readonly<{
  /** The admission operation this member contributes its definitions to. */
  admission: string;
  descriptor: ReleaseStatusDescriptor;
}>;

export const releaseStatuses = new Registry<ReleaseStatusMember>("release status");

releaseStatuses.register("certified", {
  admission: "certified",
  descriptor: Object.freeze({
    label: "Certified",
    explanation: "Approved for normal play, subject to the usual unlocks and weights.",
  }),
});
releaseStatuses.register("provisional", {
  admission: "provisional",
  descriptor: Object.freeze({
    label: "Provisional",
    explanation: "Experimental: only in explicitly experimental catalogues, never in normal play.",
  }),
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

/** What a catalogue admits: the admission operations it composes, request-local. */
export type CatalogueAccess = Readonly<{ admissions: readonly string[] }>;

/** Normal play: certified definitions only. */
export const ordinaryCatalogue: CatalogueAccess = Object.freeze({ admissions: ["certified"] });
/** An explicitly experimental catalogue: both statuses. */
export const experimentalCatalogue: CatalogueAccess = Object.freeze({
  admissions: ["certified", "provisional"],
});

export type Admitted<T> = Readonly<{ definition: T; status: ReleaseStatusDescriptor }>;

/**
 * The definitions a catalogue admits, in their given order, each with its status descriptor.
 * Every definition is validated first, so one bad declaration rejects the whole composition.
 */
export function composeCatalogue<T>(
  definitions: readonly T[],
  ownerOf: (definition: T) => string,
  declarationOf: (definition: T) => ReleaseStatusDeclaration | undefined,
  access: CatalogueAccess,
): Admitted<T>[] {
  const resolved = definitions.map((definition) => ({
    definition,
    member: releaseStatuses.get(
      resolveReleaseStatus(ownerOf(definition), declarationOf(definition)),
    ),
  }));
  return resolved
    .filter(({ member }) => access.admissions.includes(member.admission))
    .map(({ definition, member }) => ({ definition, status: member.descriptor }));
}
