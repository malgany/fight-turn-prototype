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

  it("does not give the opponent ultimate bar when Combo hits without knockdown", () => {
    const result = resolveBattleTurn(createInitialBattleState(), "Combo", "Special");

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.knockedDown).toEqual([]);
    expect(result.after.p2.super).toBe(0);
  });

  it("gives the opponent ultimate bar when Combo hits Jump and knocks down", () => {
    const result = resolveBattleTurn(createInitialBattleState(), "Combo", "Jump");

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.knockedDown).toEqual(["p2"]);
    expect(result.after.p2.super).toBe(1);
  });

  it("finishes when health reaches zero", () => {
    const state = createInitialBattleState();
    state.p2.health = 4;
    const result = resolveBattleTurn(state, "Poke", null, { p1CharacterId: "ninja", p2CharacterId: "aton" });

    expect(result.finished).toBe(true);
    expect(result.matchWinner).toBe("p1");
  });

  it("applies Doll special damage and lifesteal on hit", () => {
    const state = createInitialBattleState();
    state.p1.health = 50;
    state.p2.health = 10;
    const result = resolveBattleTurn(state, "Special", "Jump", { p1CharacterId: "doll", p2CharacterId: "aton" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p2.health).toBe(0);
    expect(result.after.p1.health).toBe(60);
    expect(result.healing?.p1).toBe(10);
  });

  it("keeps Doll special chip blocked without healing", () => {
    const state = createInitialBattleState();
    state.p1.health = 100;
    const result = resolveBattleTurn(state, "Special", "Block", { p1CharacterId: "doll", p2CharacterId: "ninja" });

    expect(result.type).toBe("blocked");
    expect(result.after.p2.health).toBe(98);
    expect(result.after.p1.health).toBe(100);
    expect(result.healed).toEqual([]);
  });

  it.each(["Block", "Crouch", "Jump"] as const)("heals Doll ultimate against %s and returns neutral", (response) => {
    const state = createInitialBattleState();
    state.p1.health = 70;
    state.p1.super = 3;
    state.advantage = "p2";
    const result = resolveBattleTurn(state, "Super", response, { p1CharacterId: "doll", p2CharacterId: "ninja" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p1.health).toBe(100);
    expect(result.after.p2.health).toBe(100);
    expect(result.after.p1.super).toBe(0);
    expect(result.healing?.p1).toBe(30);
    expect(result.after.advantage).toBeNull();
    expect(result.knockedDown).toEqual([]);
    expect(result.after.activeGuaranteedTurn).toBeNull();
  });

  it("heals Doll ultimate from a guaranteed turn without damaging or knocking down", () => {
    const state = createInitialBattleState();
    state.p1.health = 70;
    state.p1.super = 3;
    state.activeGuaranteedTurn = { side: "p1", allowedActions: ["Super"], reason: "TESTE", durationMs: 3000 };
    const result = resolveBattleTurn(state, "Super", null, { p1CharacterId: "doll", p2CharacterId: "ninja" });

    expect(result.after.p1.health).toBe(100);
    expect(result.after.p2.health).toBe(100);
    expect(result.healing?.p1).toBe(30);
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
    expect(result.after.p1.health).toBe(28);
    expect(result.after.p2.health).toBe(100);
    expect(result.healing?.p1).toBe(1);
  });

  it("uses Doll ultimate as healing without damage or knockdown", () => {
    const state = createInitialBattleState();
    state.p1.health = 70;
    state.p1.super = 3;
    const result = resolveBattleTurn(state, "Super", null, { p1CharacterId: "doll", p2CharacterId: "doll" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p1.health).toBe(100);
    expect(result.after.p2.health).toBe(100);
    expect(result.healing?.p1).toBe(30);
    expect(result.knockedDown).toEqual([]);
  });

  it("heals Doll by one at the start of the next turn", () => {
    const state = createInitialBattleState();
    state.p1.health = 50;
    const result = resolveBattleTurn(state, "Block", "Block", { p1CharacterId: "doll", p2CharacterId: "itzcoatl" });

    expect(result.after.p1.health).toBe(51);
    expect(result.healing?.p1).toBe(1);
  });

  it("caps Doll passive healing at full health", () => {
    const state = createInitialBattleState();
    state.p1.health = 100;
    const result = resolveBattleTurn(state, "Block", "Block", { p1CharacterId: "doll", p2CharacterId: "itzcoatl" });

    expect(result.after.p1.health).toBe(100);
    expect(result.healed).toEqual([]);
  });

  it("does not revive Doll with passive healing after lethal damage", () => {
    const state = createInitialBattleState();
    state.p1.health = 1;
    const result = resolveBattleTurn(state, null, "Poke", { p1CharacterId: "doll", p2CharacterId: "aton" });

    expect(result.finished).toBe(true);
    expect(result.after.p1.health).toBe(0);
    expect(result.healed).toEqual([]);
  });

  it("applies Doll passive when entering a guaranteed turn", () => {
    const state = createInitialBattleState();
    state.p1.health = 50;
    const result = resolveBattleTurn(state, "Combo", null, { p1CharacterId: "doll", p2CharacterId: "itzcoatl" });

    expect(result.after.p1.health).toBe(51);
    expect(result.after.activeGuaranteedTurn?.side).toBe("p1");
    expect(result.healing?.p1).toBe(1);
  });

  it("keeps Itzcoatl special at 18 damage and knockdown", () => {
    const result = resolveBattleTurn(createInitialBattleState(), "Special", "Jump", { p1CharacterId: "itzcoatl", p2CharacterId: "ninja" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p2.health).toBe(82);
    expect(result.knockedDown).toEqual(["p2"]);
  });

  it("keeps Itzcoatl ultimate at 25 damage on hit", () => {
    const state = createInitialBattleState();
    state.p1.super = 3;
    const result = resolveBattleTurn(state, "Super", null, { p1CharacterId: "itzcoatl", p2CharacterId: "ninja" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p2.health).toBe(75);
    expect(result.knockedDown).toEqual(["p2"]);
  });

  it("resurrects Itzcoatl at one health after lethal damage", () => {
    const state = createInitialBattleState();
    state.p1.health = 4;
    const result = resolveBattleTurn(state, null, "Poke", { p1CharacterId: "itzcoatl", p2CharacterId: "aton" });

    expect(result.finished).toBe(false);
    expect(result.matchWinner).toBeNull();
    expect(result.after.p1.health).toBe(1);
    expect(result.after.itzcoatlResurrectionUsed?.p1).toBe(true);
    expect(result.healing?.p1).toBe(1);
  });

  it("only resurrects Itzcoatl once per match", () => {
    const state = createInitialBattleState();
    state.p1.health = 4;

    const firstLethal = resolveBattleTurn(state, null, "Poke", { p1CharacterId: "itzcoatl", p2CharacterId: "aton" });
    const secondLethal = resolveBattleTurn(firstLethal.after, null, "Poke", { p1CharacterId: "itzcoatl", p2CharacterId: "aton" });

    expect(firstLethal.finished).toBe(false);
    expect(firstLethal.after.p1.health).toBe(1);
    expect(secondLethal.finished).toBe(true);
    expect(secondLethal.matchWinner).toBe("p2");
    expect(secondLethal.after.p1.health).toBe(0);
    expect(secondLethal.healing?.p1).toBeUndefined();
  });

  it("lets Itzcoatl win when both sides take lethal damage and only Itzcoatl revives", () => {
    const state = createInitialBattleState();
    state.p1.health = 8;
    state.p2.health = 8;
    const result = resolveBattleTurn(state, "Super", "Super", { p1CharacterId: "itzcoatl", p2CharacterId: "aton" });

    expect(result.finished).toBe(true);
    expect(result.matchWinner).toBe("p1");
    expect(result.after.p1.health).toBe(1);
    expect(result.after.p2.health).toBe(0);
    expect(result.healing?.p1).toBe(1);
  });

  it("keeps the fight going when both Itzcoatl fighters take lethal damage", () => {
    const state = createInitialBattleState();
    state.p1.health = 8;
    state.p2.health = 8;
    const result = resolveBattleTurn(state, "Super", "Super", { p1CharacterId: "itzcoatl", p2CharacterId: "itzcoatl" });

    expect(result.finished).toBe(false);
    expect(result.matchWinner).toBeNull();
    expect(result.after.p1.health).toBe(1);
    expect(result.after.p2.health).toBe(1);
    expect(result.healing?.p1).toBe(1);
    expect(result.healing?.p2).toBe(1);
  });

  it("keeps Aton special at 18 damage and knockdown", () => {
    const result = resolveBattleTurn(createInitialBattleState(), "Special", "Jump", { p1CharacterId: "aton", p2CharacterId: "ninja" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p2.health).toBe(82);
    expect(result.knockedDown).toEqual(["p2"]);
  });

  it("keeps Aton ultimate at 25 damage on hit", () => {
    const state = createInitialBattleState();
    state.p1.super = 3;
    const result = resolveBattleTurn(state, "Super", null, { p1CharacterId: "aton", p2CharacterId: "ninja" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p2.health).toBe(75);
    expect(result.knockedDown).toEqual(["p2"]);
  });

  it("boosts Aton blocked special chip when ultimate is available", () => {
    const state = createInitialBattleState();
    state.p1.super = 3;
    const result = resolveBattleTurn(state, "Special", "Block", { p1CharacterId: "aton", p2CharacterId: "ninja" });

    expect(result.type).toBe("blocked");
    expect(result.after.p2.health).toBe(94);
    expect(result.damaged).toEqual(["p2"]);
  });

  it("keeps Aton blocked special at base chip without full ultimate meter", () => {
    const state = createInitialBattleState();
    state.p1.super = 2;
    const result = resolveBattleTurn(state, "Special", "Block", { p1CharacterId: "aton", p2CharacterId: "ninja" });

    expect(result.type).toBe("blocked");
    expect(result.after.p2.health).toBe(98);
  });

  it("boosts Aton blocked ultimate chip and keeps block punish", () => {
    const state = createInitialBattleState();
    state.p1.super = 3;
    const result = resolveBattleTurn(state, "Super", "Block", { p1CharacterId: "aton", p2CharacterId: "ninja" });

    expect(result.type).toBe("blocked");
    expect(result.after.p2.health).toBe(93);
    expect(result.after.p1.super).toBe(0);
    expect(result.after.activeGuaranteedTurn?.side).toBe("p2");
  });

  it("keeps non-Aton blocked special chip at base damage", () => {
    const state = createInitialBattleState();
    state.p1.super = 3;
    const result = resolveBattleTurn(state, "Special", "Block", { p1CharacterId: "itzcoatl", p2CharacterId: "ninja" });

    expect(result.type).toBe("blocked");
    expect(result.after.p2.health).toBe(98);
  });

  it("does not boost Aton hit, evade, or trade damage", () => {
    const hitState = createInitialBattleState();
    hitState.p1.super = 3;
    const hit = resolveBattleTurn(hitState, "Special", "Jump", { p1CharacterId: "aton", p2CharacterId: "ninja" });

    const evadeState = createInitialBattleState();
    evadeState.p1.super = 3;
    const evade = resolveBattleTurn(evadeState, "Super", "Crouch", { p1CharacterId: "aton", p2CharacterId: "ninja" });

    const tradeState = createInitialBattleState();
    tradeState.p1.super = 3;
    const trade = resolveBattleTurn(tradeState, "Special", "Special", { p1CharacterId: "aton", p2CharacterId: "ninja" });

    expect(hit.after.p2.health).toBe(82);
    expect(evade.after.p2.health).toBe(100);
    expect(trade.after.p1.health).toBe(95);
    expect(trade.after.p2.health).toBe(95);
  });

  it.each(["Jump", "Crouch"] as const)("makes Krampus special deal 13 damage against %s", (response) => {
    const result = resolveBattleTurn(createInitialBattleState(), "Special", response, { p1CharacterId: "ninja", p2CharacterId: "itzcoatl" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p2.health).toBe(87);
    expect(result.knockedDown).toEqual(["p2"]);
  });

  it("makes Krampus ultimate deal 30 damage on hit", () => {
    const state = createInitialBattleState();
    state.p1.super = 3;
    const result = resolveBattleTurn(state, "Super", null, { p1CharacterId: "ninja", p2CharacterId: "itzcoatl" });

    expect(result.type).toBe("hit");
    expect(result.winner).toBe("p1");
    expect(result.after.p2.health).toBe(70);
    expect(result.knockedDown).toEqual(["p2"]);
  });

  it("keeps Krampus ultimate block counter behavior", () => {
    const state = createInitialBattleState();
    state.p1.super = 3;
    const result = resolveBattleTurn(state, "Super", "Block", { p1CharacterId: "ninja", p2CharacterId: "itzcoatl" });

    expect(result.type).toBe("blocked");
    expect(result.winner).toBe("p2");
    expect(result.after.p2.health).toBe(97);
    expect(result.after.p1.super).toBe(0);
    expect(result.after.activeGuaranteedTurn?.side).toBe("p2");
  });

  it.each([
    ["Grab", "Block"],
    ["Special", "Jump"],
    ["Super", null],
    ["Combo", "Jump"],
  ] as const)("gives Krampus one ultimate bar when %s knocks down", (action, response) => {
    const state = createInitialBattleState();
    if (action === "Super") state.p1.super = 3;
    const result = resolveBattleTurn(state, action, response, { p1CharacterId: "ninja", p2CharacterId: "itzcoatl" });

    expect(result.knockedDown).toEqual(["p2"]);
    expect(result.after.p1.super).toBe(1);
  });

  it("caps Krampus knockdown passive at three ultimate bars", () => {
    const state = createInitialBattleState();
    state.p1.super = 3;
    const result = resolveBattleTurn(state, "Grab", "Block", { p1CharacterId: "ninja", p2CharacterId: "itzcoatl" });

    expect(result.knockedDown).toEqual(["p2"]);
    expect(result.after.p1.super).toBe(3);
  });

  it("keeps non-Krampus special and ultimate behavior unchanged", () => {
    const special = resolveBattleTurn(createInitialBattleState(), "Special", "Jump", { p1CharacterId: "itzcoatl", p2CharacterId: "ninja" });
    const ultimateState = createInitialBattleState();
    ultimateState.p1.super = 3;
    const ultimate = resolveBattleTurn(ultimateState, "Super", "Block", { p1CharacterId: "itzcoatl", p2CharacterId: "ninja" });

    expect(special.after.p2.health).toBe(82);
    expect(special.knockedDown).toEqual(["p2"]);
    expect(ultimate.type).toBe("blocked");
    expect(ultimate.after.p2.health).toBe(97);
    expect(ultimate.after.activeGuaranteedTurn?.side).toBe("p2");
  });
});
