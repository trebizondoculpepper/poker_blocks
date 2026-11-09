import { describe, expect, it } from "vite-plus/test";
import { buildVersion, derivedVersion, releaseVersion, versionParts } from "./versioning";
import { versionChangeProblem } from "./version-guard";
import { manifestsAt } from "./release";

describe("versions (#128)", () => {
  it("derives the patch from the commits since the last release", () => {
    expect(derivedVersion("0.0.0", 0)).toBe("0.0.0");
    expect(derivedVersion("0.0.0", 7)).toBe("0.0.7");
    expect(derivedVersion("0.3.0", 2)).toBe("0.3.2");
  });

  it("releases the next minor by default, a major only when asked, or an exact version", () => {
    expect(releaseVersion("0.0.0")).toBe("0.1.0");
    expect(releaseVersion("0.4.0", "minor")).toBe("0.5.0");
    expect(releaseVersion("0.4.0", "major")).toBe("1.0.0");
    expect(releaseVersion("0.4.0", "2.3.4")).toBe("2.3.4");
    expect(() => releaseVersion("0.4.0", "sideways")).toThrow();
  });

  it("rejects a malformed version", () => {
    expect(() => versionParts("1.2")).toThrow();
  });

  it("marks a build without history as a development build", () => {
    const shallow = () => "true";
    expect(buildVersion("0.2.0", shallow)).toBe("0.2.0-dev");
  });

  it("counts first-parent commits since the version last changed", () => {
    const git = (...args: string[]) =>
      args[0] === "rev-parse" ? "false" : args[0] === "log" ? "abc123" : "5";
    expect(buildVersion("0.2.0", git)).toBe("0.2.5");
  });
});

describe("the version guard (#128)", () => {
  const change = { before: "0.1.0", after: "0.2.0", lock: "0.2.0", lockRoot: "0.2.0" };

  it("lets only a release commit change the version, with the lockfile in step", () => {
    expect(versionChangeProblem({ ...change, subject: "Release v0.2.0" })).toBeNull();
    expect(versionChangeProblem({ ...change, subject: "Bump version" })).toMatch(/not "Release/);
    expect(
      versionChangeProblem({ ...change, subject: "Release v0.2.0", lockRoot: "0.1.0" }),
    ).toMatch(/lockfile/);
  });

  it("ignores commits that leave the version alone", () => {
    expect(versionChangeProblem({ ...change, after: "0.1.0", subject: "Anything" })).toBeNull();
  });
});

describe("the release (#128)", () => {
  it("writes the version into package.json and both lockfile fields", () => {
    const [pkg, lock] = manifestsAt(
      JSON.stringify({ name: "x", version: "0.0.0" }),
      JSON.stringify({ version: "0.0.0", packages: { "": { version: "0.0.0" } } }),
      "0.1.0",
    );
    expect(JSON.parse(pkg).version).toBe("0.1.0");
    expect(JSON.parse(lock)).toMatchObject({
      version: "0.1.0",
      packages: { "": { version: "0.1.0" } },
    });
  });
});
