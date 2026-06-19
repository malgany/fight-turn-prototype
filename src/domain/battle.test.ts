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

  it("applies Doll special damage and lifesteal on hit", () => {
    const state = createInitialBattleState();
    state.p1.health = 50;
    const result = resolveBattleTurn(state, "Special", "Jump", { p1CharacterId: "doll", p2CharacterId: "ninja" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p2.health).toBe(90);
    expect(result.after.p1.health).toBe(55);
    expect(result.healing?.p1).toBe(5);
  });

  it("keeps Doll special chip blocked without healing", () => {
    const state = createInitialBattleState();
    state.p1.health = 50;
    const result = resolveBattleTurn(state, "Special", "Block", { p1CharacterId: "doll", p2CharacterId: "ninja" });

    expect(result.type).toBe("blocked");
    expect(result.after.p2.health).toBe(98);
    expect(result.after.p1.health).toBe(50);
    expect(result.healed).toEqual([]);
  });

  it.each(["Block", "Crouch", "Jump"] as const)("heals Doll ultimate against %s and returns neutral", (response) => {
    const state = createInitialBattleState();
    state.p1.health = 40;
    state.p1.super = 3;
    state.advantage = "p2";
    const result = resolveBattleTurn(state, "Super", response, { p1CharacterId: "doll", p2CharacterId: "ninja" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p1.health).toBe(68);
    expect(result.after.p2.health).toBe(100);
    expect(result.after.advantage).toBeNull();
    expect(result.knockedDown).toEqual([]);
    expect(result.after.activeGuaranteedTurn).toBeNull();
  });

  it("heals Doll ultimate from a guaranteed turn without damaging or knocking down", () => {
    const state = createInitialBattleState();
    state.p1.health = 40;
    state.p1.super = 3;
    state.activeGuaranteedTurn = { side: "p1", allowedActions: ["Super"], reason: "TESTE", durationMs: 3000 };
    const result = resolveBattleTurn(state, "Super", null, { p1CharacterId: "doll", p2CharacterId: "ninja" });

    expect(result.after.p1.health).toBe(68);
    expect(result.after.p2.health).toBe(100);
    expect(result.knockedDown).toEqual([]);
    expect(result.after.advantage).toBeNull();
  });

  it("does not let Doll ultimate use advantage against offensive actions", () => {
    const state = createInitialBattleState();
    state.p1.health = 40;
    state.p1.super = 3;
    state.advantage = "p1";
    const result = resolveBattleTurn(state, "Super", "Special", { p1CharacterId: "doll", p2CharacterId: "ninja" });

    expect(result.winner).toBe("p2");
    expect(result.after.p1.health).toBe(22);
    expect(result.after.p2.health).toBe(100);
    expect(result.healed).toEqual([]);
  });

  it("keeps non-Doll special and ultimate behavior unchanged", () => {
    const special = resolveBattleTurn(createInitialBattleState(), "Special", "Jump", { p1CharacterId: "ninja", p2CharacterId: "doll" });
    const ultimateState = createInitialBattleState();
    ultimateState.p1.super = 3;
    const ultimate = resolveBattleTurn(ultimateState, "Super", "Block", { p1CharacterId: "ninja", p2CharacterId: "doll" });

    expect(special.after.p2.health).toBe(82);
    expect(special.knockedDown).toEqual(["p2"]);
    expect(ultimate.type).toBe("blocked");
    expect(ultimate.after.p2.health).toBe(97);
    expect(ultimate.after.activeGuaranteedTurn?.side).toBe("p2");
  });
});
