import { describe, expect, it } from "vite-plus/test";
import { appVersion } from "./version";

describe("the build's version (#128)", () => {
  it("is defined by the build as a semantic version", () => {
    // Any version the release tooling accepts, including a prerelease such as 0.1.0-beta.1.
    expect(appVersion).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
