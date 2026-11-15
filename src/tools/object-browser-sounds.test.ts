import { describe, expect, it } from "vite-plus/test";
import { listeningRoomLink } from "./object-browser";

describe("object browser listening-room link (#1012)", () => {
  it("opens the same-origin listening room at the encoded sound id", () => {
    expect(listeningRoomLink("shop.buy")).toBe("/sfx.html?sound=shop.buy");
    expect(listeningRoomLink("a b&c")).toBe("/sfx.html?sound=a%20b%26c");
  });
});
