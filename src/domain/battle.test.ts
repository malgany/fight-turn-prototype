import { describe, expect, it } from "vitest";
import { createInitialBattleState, resolveBattleTurn } from "./battle";

describe("resolveBattleTurn", () => {
  it("keeps both actions hidden until resolution and resolves faster attack", () => {
    const result = resolveBattleTurn(createInitialBattleState(), "Poke", "Special");

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p2.health).toBe(96);
    expect(result.finished).toBe(false);
  });

  it("uses block to stop super and grants a guaranteed turn", () => {
    const state = createInitialBattleState();
    state.p1.super = 3;
    const result = resolveBattleTurn(state, "Super", "Block");

    expect(result.type).toBe("blocked");
    expect(result.winner).toBe("p2");
    expect(result.after.p2.health).toBe(97);
    expect(result.after.activeGuaranteedTurn?.side).toBe("p2");
  });

  it("resolves timeout as free hit when only one player acts", () => {
    const result = resolveBattleTurn(createInitialBattleState(), "Combo", null);

    expect(result.primary).toBe("GOLPE LIVRE");
    expect(result.winner).toBe("p1");
    expect(result.after.p2.health).toBe(88);
  });

  it("finishes when health reaches zero", () => {
    const state = createInitialBattleState();
    state.p2.health = 4;
    const result = resolveBattleTurn(state, "Poke", null);

    expect(result.finished).toBe(true);
    expect(result.matchWinner).toBe("p1");
  });
});
