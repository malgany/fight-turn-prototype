import type { Division, PlayerRank } from "../types";

export const RANKED_WIN_POINTS = 25;
export const RANKED_LOSS_POINTS = -20;
export const RANKED_FORFEIT_POINTS = -25;

export function divisionForPoints(points: number): Division {
  if (points >= 1600) return "Diamond";
  if (points >= 1200) return "Platinum";
  if (points >= 800) return "Gold";
  if (points >= 400) return "Silver";
  return "Bronze";
}

export function createInitialRank(userId: string): PlayerRank {
  return {
    userId,
    rankPoints: 0,
    division: "Bronze",
    wins: 0,
    losses: 0,
    streak: 0,
    bestStreak: 0,
  };
}

export function applyRankedResult(rank: PlayerRank, result: "win" | "loss" | "forfeit"): PlayerRank {
  const delta = result === "win" ? RANKED_WIN_POINTS : result === "forfeit" ? RANKED_FORFEIT_POINTS : RANKED_LOSS_POINTS;
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
