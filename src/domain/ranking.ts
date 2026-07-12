import type { Division, PlayerRank } from "../types";

export type RankedResult = "win" | "loss" | "forfeit";

export interface RankRule {
  division: Division;
  minimumPoints: number;
  winPoints: number;
  lossPoints: number;
}

export const RANK_RULES: readonly RankRule[] = [
  { division: "Autoprimata III", minimumPoints: 0, winPoints: 50, lossPoints: 10 },
  { division: "Autoprimata II", minimumPoints: 100, winPoints: 40, lossPoints: 10 },
  { division: "Autoprimata I", minimumPoints: 200, winPoints: 30, lossPoints: 10 },
  { division: "Bronze III", minimumPoints: 300, winPoints: 50, lossPoints: 10 },
  { division: "Bronze II", minimumPoints: 450, winPoints: 40, lossPoints: 10 },
  { division: "Bronze I", minimumPoints: 600, winPoints: 30, lossPoints: 10 },
  { division: "Prata III", minimumPoints: 750, winPoints: 50, lossPoints: 20 },
  { division: "Prata II", minimumPoints: 950, winPoints: 40, lossPoints: 20 },
  { division: "Prata I", minimumPoints: 1150, winPoints: 30, lossPoints: 20 },
  { division: "Ouro III", minimumPoints: 1350, winPoints: 50, lossPoints: 20 },
  { division: "Ouro II", minimumPoints: 1650, winPoints: 40, lossPoints: 20 },
  { division: "Ouro I", minimumPoints: 1950, winPoints: 30, lossPoints: 20 },
  { division: "Desperto", minimumPoints: 2250, winPoints: 30, lossPoints: 30 },
  { division: "Arcanjo", minimumPoints: 2650, winPoints: 20, lossPoints: 30 },
  { division: "Primordial", minimumPoints: 3150, winPoints: 20, lossPoints: 30 },
];

export function rankRuleForPoints(points: number): RankRule {
  for (let index = RANK_RULES.length - 1; index >= 0; index -= 1) {
    if (points >= RANK_RULES[index].minimumPoints) return RANK_RULES[index];
  }
  return RANK_RULES[0];
}

export function divisionForPoints(points: number): Division {
  return rankRuleForPoints(points).division;
}

export function rankedDeltaForResult(points: number, result: RankedResult, opponentDivision?: Division): number {
  const rule = rankRuleForPoints(points);
  if (result === "win" && rule.division !== "Autoprimata III" && opponentDivision === "Autoprimata III") return 0;
  return result === "win" ? rule.winPoints : -rule.lossPoints;
}

export function createInitialRank(userId: string): PlayerRank {
  return {
    userId,
    rankPoints: 0,
    division: "Autoprimata III",
    wins: 0,
    losses: 0,
    streak: 0,
    bestStreak: 0,
  };
}

export function applyRankedResult(rank: PlayerRank, result: RankedResult, opponentDivision?: Division): PlayerRank {
  const delta = rankedDeltaForResult(rank.rankPoints, result, opponentDivision);
  const rankPoints = Math.max(0, rank.rankPoints + delta);
  const wins = result === "win" ? rank.wins + 1 : rank.wins;
  const losses = result === "win" ? rank.losses : rank.losses + 1;
  const streak = result === "win" ? rank.streak + 1 : 0;

  return {
    ...rank,
    rankPoints,
    division: divisionForPoints(rankPoints),
    wins,
    losses,
    streak,
    bestStreak: Math.max(rank.bestStreak, streak),
  };
}
