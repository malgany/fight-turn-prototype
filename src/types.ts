export type AccountType = "guest" | "google";
export type PresenceStatus = "online" | "in_queue" | "in_match" | "offline";
export type Division = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";
export type Side = "p1" | "p2";
export type Action = "Poke" | "Combo" | "Grab" | "Special" | "Super" | "Block" | "Crouch" | "Jump";
export type MatchType = "ranked" | "private" | "casual";
export type MatchStatus = "waiting" | "active" | "resolving" | "finished" | "forfeited";
export type MatchResult = "win" | "loss" | "draw";

export interface CharacterDefinition {
  id: string;
  name: string;
  portraitUrl: string;
  enabled: boolean;
  isDefault: boolean;
  unlockDescription: string;
  requiredPoints: number;
  requiredDivision: Division;
}

export interface PlayerProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  accountType: AccountType;
  selectedCharacterId: string;
  presenceStatus: PresenceStatus;
}

export interface PlayerRank {
  userId: string;
  rankPoints: number;
  division: Division;
  wins: number;
  losses: number;
  streak: number;
  bestStreak: number;
}

export interface LeaderboardEntry {
  position: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rankPoints: number;
  division: Division;
  wins: number;
  losses: number;
  streak: number;
}

export interface MatchHistoryEntry {
  id: string;
  matchId: string;
  opponentName: string;
  matchType: MatchType;
  characterId: string;
  opponentCharacterId: string;
  result: MatchResult;
  rankDelta: number;
  createdAt: string;
}

export interface FighterState {
  health: number;
  super: number;
}

export interface GuaranteedTurn {
  side: Side;
  allowedActions: Action[];
  reason: string;
  durationMs: number;
}

export interface BattleState {
  p1: FighterState;
  p2: FighterState;
  advantage: Side | null;
  activeGuaranteedTurn: GuaranteedTurn | null;
  turnNumber: number;
}

export interface TurnResolution {
  type: "hit" | "blocked" | "evade" | "trade" | "draw";
  winner: Side | null;
  loser: Side | null;
  primary: string;
  secondary: string;
  damaged: Side[];
  knockedDown: Side[];
  guaranteedTurn: GuaranteedTurn | null;
  p1Action: Action | null;
  p2Action: Action | null;
  before: BattleState;
  after: BattleState;
  finished: boolean;
  matchWinner: Side | null;
}

export interface MatchPlayer {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  characterId: string;
}

export interface GameMatch {
  id: string;
  matchType: MatchType;
  status: MatchStatus;
  playerSide: Side;
  p1: MatchPlayer;
  p2: MatchPlayer;
  battleState: BattleState;
  currentTurn: number;
  turnDeadlineAt: string;
  serverNow?: string;
  localAction: Action | null;
  opponentHasAction: boolean;
  lastTurn: TurnResolution | null;
  winnerId: string | null;
  rankDelta: number;
  privateScore: PrivateScore | null;
}

export interface PrivateRoom {
  code: string;
  status: "waiting" | "active" | "expired" | "closed";
  hostName: string;
  guestName: string | null;
  matchId: string | null;
  inviteUrl: string;
}

export interface PrivateScore {
  playerWins: number;
  opponentWins: number;
}

export interface AppSnapshot {
  profile: PlayerProfile | null;
  rank: PlayerRank | null;
  unlockedCharacterIds: string[];
}
