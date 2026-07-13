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
