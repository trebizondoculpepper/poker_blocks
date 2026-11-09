import { describe, expect, it } from "vite-plus/test";
import { appVersion } from "./version";

describe("the build's version (#128)", () => {
  it("is defined by the build as a semantic version", () => {
    expect(appVersion).toMatch(/^\d+\.\d+\.\d+(-dev)?$/);
  });
});
