import { describe, expect, it } from "vitest";
import { applyRankedResult, createInitialRank, divisionForPoints } from "./ranking";

describe("ranking", () => {
  it("maps points to divisions", () => {
    expect(divisionForPoints(0)).toBe("Bronze");
    expect(divisionForPoints(400)).toBe("Silver");
    expect(divisionForPoints(800)).toBe("Gold");
    expect(divisionForPoints(1200)).toBe("Platinum");
    expect(divisionForPoints(1600)).toBe("Diamond");
  });

  it("adds win points and streak", () => {
    const rank = applyRankedResult(createInitialRank("u1"), "win");

    expect(rank.rankPoints).toBe(25);
    expect(rank.wins).toBe(1);
    expect(rank.streak).toBe(1);
    expect(rank.bestStreak).toBe(1);
  });

  it("does not go below zero on loss", () => {
    const rank = applyRankedResult(createInitialRank("u1"), "loss");

    expect(rank.rankPoints).toBe(0);
    expect(rank.losses).toBe(1);
    expect(rank.streak).toBe(0);
  });
});
