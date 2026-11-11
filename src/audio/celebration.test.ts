import { describe, expect, it } from "vite-plus/test";
import { materialDefinitions, type MaterialDefinition } from "../materials";
import { celebrationOf, playCelebration, type CelebrationPlayer } from "./celebration";

function recorder(randoms: number[] = [0.5]) {
  const played: { id: string; rate?: number; at: number }[] = [];
  let i = 0;
  const player: CelebrationPlayer = {
    play: (id, { rate }) => played.push({ id, rate, at: now }),
    after: (seconds, run) => {
      const before = now;
      now = before + seconds;
      run();
      now = before;
    },
    random: () => randoms[i++ % randoms.length]!,
  };
  let now = 0;
  return { played, player };
}

describe("celebrations (#494)", () => {
  it("plays a pop, then each whistle at its own pitch and small offset", () => {
    const { played, player } = recorder([0.1, 0.9, 0.5, 0.3, 0.7, 0.2]);
    playCelebration({ whistles: 3 }, player);
    expect(played[0]).toMatchObject({ id: "celebration.pop", at: 0 });
    const whistles = played.slice(1);
    expect(whistles.map(({ id }) => id)).toEqual(Array(3).fill("celebration.whistle"));
    const rates = whistles.map(({ rate }) => rate!);
    expect(new Set(rates.map((rate) => rate.toFixed(3))).size).toBe(3);
    for (const rate of rates) expect(Math.abs(rate - 1)).toBeLessThanOrEqual(0.08 + 1e-9);
    for (const { at } of whistles) expect(at).toBeLessThanOrEqual(0.12);
  });

  it("plays between one and three whistles", () => {
    for (const [asked, heard] of [
      [0, 1],
      [1, 1],
      [5, 3],
    ] as const) {
      const { played, player } = recorder();
      playCelebration({ whistles: asked }, player);
      expect(played.filter(({ id }) => id === "celebration.whistle")).toHaveLength(heard);
    }
  });

  it("reads the whistle count off the material: one by default, three for crystal and Magic", () => {
    const all: readonly MaterialDefinition[] = materialDefinitions;
    const whistles = (id: string) => celebrationOf(all.find((m) => m.id === id)!).whistles;
    expect(whistles("wood")).toBe(1);
    expect(whistles("prismatic")).toBe(3);
    expect(whistles("magic")).toBe(3);
  });
});
