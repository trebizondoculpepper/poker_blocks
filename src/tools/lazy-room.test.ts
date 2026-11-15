import { describe, expect, it } from "vite-plus/test";
import { lazyRoom } from "./lazy-room";

describe("lazy developer rooms (#1365)", () => {
  it("builds a room only while shown, and releases it on hide", () => {
    const log: string[] = [];
    let built = 0;
    const room = lazyRoom<string, { show(c: string): void; hide(): void; dispose(): void }>(() => {
      built++;
      return {
        show: (config) => log.push(`show ${config}`),
        hide: () => log.push("hide"),
        dispose: () => log.push("dispose"),
      };
    });
    expect(built).toBe(0);
    room.hide();
    room.show("a");
    room.show("b");
    expect(built).toBe(1);
    room.hide();
    room.show("c");
    room.dispose();
    expect(built).toBe(2);
    expect(log).toEqual(["show a", "show b", "hide", "dispose", "show c", "dispose"]);
  });
});
