import { describe, expect, it } from "vite-plus/test";
import {
  getAt,
  parameterProblems,
  parameterValues,
  setAt,
  withParameters,
  type ParameterSchemas,
} from "./parameter-schema";

const parameters: ParameterSchemas = {
  size: { kind: "number", label: "Size", path: ["size"], min: 0, max: 2 },
  red: { kind: "number", label: "Red", path: ["colour", 0], min: 0, max: 1 },
  mode: { kind: "choice", label: "Mode", path: ["mode"], options: ["a", "b"] },
};

describe("parameter schemas (#1024)", () => {
  it("writes at a path without touching the original, creating arrays for index steps", () => {
    const original = Object.freeze({ size: 1, colour: Object.freeze([0.1, 0.2, 0.3]) });
    const changed = setAt(original, ["colour", 0], 0.9) as typeof original;
    expect(changed.colour).toEqual([0.9, 0.2, 0.3]);
    expect(original.colour[0]).toBe(0.1);
    expect(setAt({}, ["colour", 1], 0.5)).toEqual({ colour: [undefined, 0.5] });
    expect(Array.isArray(getAt(setAt({}, ["colour", 1], 0.5), ["colour"]))).toBe(true);
  });

  it("reads and writes named values at their declared paths", () => {
    const config = withParameters(parameters, { other: true }, { size: 1.5, red: 0.25 });
    expect(config).toEqual({ other: true, size: 1.5, colour: [0.25] });
    expect(parameterValues(parameters, config)).toEqual({ size: 1.5, red: 0.25, mode: undefined });
  });

  it("reports unknown names, out-of-range numbers and unlisted choices", () => {
    expect(parameterProblems(parameters, { size: 1, mode: "b" })).toEqual([]);
    expect(parameterProblems(parameters, { glow: 1 })).toEqual(['unknown parameter "glow"']);
    expect(parameterProblems(parameters, { size: 3 })).toEqual([
      "size: needs a number from 0 to 2",
    ]);
    expect(parameterProblems(parameters, { size: Number.NaN })).toHaveLength(1);
    expect(parameterProblems(parameters, { size: "1" })).toHaveLength(1);
    expect(parameterProblems(parameters, { mode: "c" })).toEqual(["mode: needs one of a, b"]);
  });
});
