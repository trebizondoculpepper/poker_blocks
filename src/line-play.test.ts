import { describe, expect, it } from "vite-plus/test";
import { standardDeck } from "./cards";
import { dealerRegistry } from "./dealer";
import { GameSession } from "./game-session";
import { demoSessionConfig } from "./session-config";
import { cellKey } from "./traits/attachable";

const session = () => new GameSession(dealerRegistry, demoSessionConfig, standardDeck, () => 0);

describe("placing several blocks as one play", () => {
  it("lays a line east from the centre on an empty field, in selection order, for one play", () => {
    const game = session();
    const [a, b, c] = game.state.hand;
    const moves = game.state.round.movesLeft;
    expect(game.play({ cardId: c.id, cardIds: [c.id, a.id, b.id] })).not.toBeNull();
    expect(game.state.field.map(({ block, cell }) => [block.id, cellKey(cell)])).toEqual([
      [c.id, "0,0,0"],
      [a.id, "1,0,0"],
      [b.id, "2,0,0"],
    ]);
    expect(game.state.round.movesLeft).toBe(moves - 1);
    expect(game.state.hand.map(({ id }) => id)).not.toContain(a.id);
    expect(game.stats.blocksPlayed).toBe(3);
  });

  it("runs out from the target face", () => {
    const game = session();
    const [first] = game.state.hand;
    game.play({ cardId: first.id });
    game.refillHand();
    const [x, y] = game.state.hand;
    expect(
      game.play({ cardId: x.id, cardIds: [x.id, y.id], targetId: first.id, face: "up" }),
    ).not.toBeNull();
    expect(game.state.field.slice(1).map(({ cell }) => cellKey(cell))).toEqual(["0,1,0", "0,2,0"]);
  });

  it("refuses a line whose first cell is taken, and allows one into free space", () => {
    const game = session();
    const [a, b, c] = game.state.hand;
    game.play({ cardId: a.id, cardIds: [a.id, b.id, c.id] }); // (0..2, 0, 0)
    game.refillHand();
    const [d, e] = game.state.hand;
    const before = game.state;
    // East of a is b: refused, nothing changes.
    expect(game.play({ cardId: d.id, cardIds: [d.id, e.id], targetId: a.id, face: "east" })).toBe(
      null,
    );
    expect(game.state).toBe(before);
    // West of a is open: allowed.
    expect(
      game.play({ cardId: d.id, cardIds: [d.id, e.id], targetId: a.id, face: "west" }),
    ).not.toBeNull();
  });

  it("refuses the whole line if it would reach a block further along", () => {
    const game = session();
    const [a, b, c] = game.state.hand;
    game.play({ cardId: a.id, cardIds: [a.id, b.id, c.id] }); // (0..2, 0, 0)
    game.refillHand();
    const [d] = game.state.hand;
    game.play({ cardId: d.id, targetId: c.id, face: "up" }); // (2, 1, 0)
    game.refillHand();
    const [e] = game.state.hand;
    game.play({ cardId: e.id, targetId: a.id, face: "up" }); // (0, 1, 0)
    game.refillHand();
    const [f, g] = game.state.hand;
    const before = game.state;
    // West from d: (1, 1, 0) is free but (0, 1, 0) is e, so the whole line is refused.
    expect(game.play({ cardId: f.id, cardIds: [f.id, g.id], targetId: d.id, face: "west" })).toBe(
      null,
    );
    expect(game.state).toBe(before);
  });
});
