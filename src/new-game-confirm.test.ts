import { describe, expect, it } from "vite-plus/test";
import { gameDialogs, gameModeFor, standardNavigation } from "./game-modes";

describe("the New Game confirmation (#197, #529)", () => {
  it("is its own scene over the title, offering only Start and Cancel", () => {
    const scene = gameModeFor("game").scenes.find(({ id }) => id === "game/confirm-new-game");
    expect(scene?.traits.newGameDialog).toBe(gameDialogs.newGame);
    expect(gameDialogs.newGame.items.map(({ action }) => action)).toEqual([
      "confirmNewGame",
      "cancelNewGame",
    ]);
  });

  it("starts on Cancel, and Escape cancels, so a held Enter cannot overwrite the save", () => {
    expect(gameDialogs.newGame.focus).toBe("cancelNewGame");
    const scene = gameModeFor("game").scenes.find(({ id }) => id === "game/confirm-new-game");
    expect(scene?.traits.keyAction).toEqual({
      key: "Escape",
      action: "cancelNewGame",
      sfx: "ui.back",
    });
  });

  it("opens over the title and closes back to it", () => {
    expect(standardNavigation.openNewGameConfirm).toEqual({
      operation: "push",
      scene: "confirm-new-game",
    });
    expect(standardNavigation.cancelNewGame).toEqual({ operation: "pop" });
  });
});
