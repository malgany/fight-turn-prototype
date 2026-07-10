import { describe, expect, it } from "vitest";
import { applyRankedResult, createInitialRank, divisionForPoints, rankedDeltaForResult } from "./ranking";

describe("ranking", () => {
  it("maps points to divisions", () => {
    const boundaries = [
      [0, "Alto Primata III"],
      [100, "Alto Primata II"],
      [200, "Alto Primata I"],
      [300, "Bronze III"],
      [450, "Bronze II"],
      [600, "Bronze I"],
      [750, "Prata III"],
      [950, "Prata II"],
      [1150, "Prata I"],
      [1350, "Ouro III"],
      [1650, "Ouro II"],
      [1950, "Ouro I"],
      [2250, "Desperto"],
      [2650, "Arcanjo"],
      [3150, "Primordial"],
    ] as const;

    for (const [points, division] of boundaries) {
      expect(divisionForPoints(points)).toBe(division);
      if (points > 0) expect(divisionForPoints(points - 1)).not.toBe(division);
    }
  });

  it("applies the win value of the current division", () => {
    expect(rankedDeltaForResult(0, "win")).toBe(50);
    expect(rankedDeltaForResult(100, "win")).toBe(40);
    expect(rankedDeltaForResult(200, "win")).toBe(30);
    expect(rankedDeltaForResult(300, "win")).toBe(50);
    expect(rankedDeltaForResult(750, "win")).toBe(50);
    expect(rankedDeltaForResult(1350, "win")).toBe(50);
    expect(rankedDeltaForResult(2250, "win")).toBe(30);
    expect(rankedDeltaForResult(2650, "win")).toBe(20);
    expect(rankedDeltaForResult(3150, "win")).toBe(20);
  });

  it("applies the loss value of the current division", () => {
    expect(rankedDeltaForResult(0, "loss")).toBe(-10);
    expect(rankedDeltaForResult(600, "loss")).toBe(-10);
    expect(rankedDeltaForResult(750, "loss")).toBe(-20);
    expect(rankedDeltaForResult(1950, "loss")).toBe(-20);
    expect(rankedDeltaForResult(2250, "loss")).toBe(-30);
    expect(rankedDeltaForResult(2650, "loss")).toBe(-30);
    expect(rankedDeltaForResult(3150, "loss")).toBe(-30);
  });

  it("adds win points, promotes and updates streak", () => {
    const startingRank = { ...createInitialRank("u1"), rankPoints: 80 };
    const rank = applyRankedResult(startingRank, "win");

    expect(rank.rankPoints).toBe(130);
    expect(rank.division).toBe("Alto Primata II");
    expect(rank.wins).toBe(1);
    expect(rank.streak).toBe(1);
    expect(rank.bestStreak).toBe(1);
  });

  it("keeps awarding 20 points per win in Primordial", () => {
    const rank = applyRankedResult({ ...createInitialRank("u1"), rankPoints: 3150, division: "Primordial" }, "win");

    expect(rank.rankPoints).toBe(3170);
    expect(rank.division).toBe("Primordial");
  });

  it("allows relegation after a loss", () => {
    const rank = applyRankedResult({ ...createInitialRank("u1"), rankPoints: 3150, division: "Primordial" }, "loss");

    expect(rank.rankPoints).toBe(3120);
    expect(rank.division).toBe("Arcanjo");
    expect(rank.losses).toBe(1);
    expect(rank.streak).toBe(0);
  });

  it("creates a new player in Alto Primata III", () => {
    const rank = applyRankedResult(createInitialRank("u1"), "win");

    expect(createInitialRank("u1").division).toBe("Alto Primata III");
    expect(rank.rankPoints).toBe(50);
    expect(rank.wins).toBe(1);
  });

  it("does not go below zero on loss", () => {
    const rank = applyRankedResult(createInitialRank("u1"), "loss");

    expect(rank.rankPoints).toBe(0);
    expect(rank.losses).toBe(1);
    expect(rank.streak).toBe(0);
  });

  it("applies forfeit as the division loss value", () => {
    const rank = applyRankedResult({ ...createInitialRank("u1"), rankPoints: 2300, division: "Desperto", streak: 2 }, "forfeit");

    expect(rank.rankPoints).toBe(2270);
    expect(rank.losses).toBe(1);
    expect(rank.streak).toBe(0);
  });
});
