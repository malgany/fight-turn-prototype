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
  it.each([
    ["p1", "Special", "Jump", { player1_character_id: "iop", player2_character_id: "ninja" }, "p2"],
    ["p2", "Jump", "Special", { p1CharacterId: "ninja", p2CharacterId: "iop" }, "p1"],
  ] as const)("applies Iop's 25-point base Special damage for %s", (_side, p1Action, p2Action, context, target) => {
    const result = resolveTurn(battleStateWithAdvantage("p1"), p1Action, p2Action, context);

    expect(result.after[target].health).toBe(75);
  });

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

  it.each([
    ["p1", null, "Block"],
    ["p2", "Block", null],
  ] as const)("clears %s advantage when that player takes no action", (advantage, p1Action, p2Action) => {
    const result = resolveTurn(battleStateWithAdvantage(advantage), p1Action, p2Action);

    expect(result.type).toBe("draw");
    expect(result.winner).toBeNull();
    expect(result.after.advantage).toBeNull();
  });
});
