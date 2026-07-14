import { describe, expect, it } from "vitest";
import { resolveTurn } from "./operations";

function battleStateWithAdvantage(advantage: "p1" | "p2") {
  return {
    p1: { health: 100, super: 0 },
    p2: { health: 100, super: 0 },
    advantage,
    activeGuaranteedTurn: null,
    itzcoatlResurrectionUsed: { p1: false, p2: false },
    ultimateHealthThresholdsReached: { p1: [], p2: [] },
    turnNumber: 2,
  };
}

describe("online resolveTurn", () => {
  it("applies Iop's Ultimate heal, passive, and one-use lock", () => {
    const state = battleStateWithAdvantage("p2");
    state.p1.health = 70;
    state.p1.super = 3;
    const result = resolveTurn(state, "Super", "Crouch", { player1_character_id: "iop", player2_character_id: "ninja" });

    expect(result.after.p1.health).toBe(80);
    expect(result.after.iopPassiveActive?.p1).toBe(true);
    expect(result.after.iopUltimateUsed?.p1).toBe(true);
    expect(result.after.p1.super).toBe(0);
  });

  it.each([
    ["p1", "Jump", "Block"],
    ["p2", "Block", "Jump"],
  ] as const)("clears %s advantage after %s versus %s", (advantage, p1Action, p2Action) => {
    const result = resolveTurn(battleStateWithAdvantage(advantage), p1Action, p2Action);

    expect(result.type).toBe("draw");
    expect(result.winner).toBeNull();
    expect(result.primary).toBe("NEUTRO");
    expect(result.after.advantage).toBeNull();
  });
});
