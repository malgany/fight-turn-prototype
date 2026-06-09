import type {
  Action,
  AppSnapshot,
  GameMatch,
  LeaderboardEntry,
  MatchHistoryEntry,
  PlayerProfile,
  PlayerRank,
  PrivateRoom,
} from "../types";

export interface QueueResult {
  status: "queued" | "matched";
  match: GameMatch | null;
}

export interface GameService {
  readonly mode: "supabase" | "demo";
  getSnapshot(): Promise<AppSnapshot>;
  signInWithGoogle(): Promise<void>;
  signInAsGuest(): Promise<void>;
  linkGuestWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  bootstrapProfile(): Promise<AppSnapshot>;
  selectCharacter(characterId: string): Promise<AppSnapshot>;
  heartbeat(status: PlayerProfile["presenceStatus"], matchId?: string): Promise<void>;
  getLeaderboard(): Promise<LeaderboardEntry[]>;
  getHistory(): Promise<MatchHistoryEntry[]>;
  joinRankedQueue(): Promise<QueueResult>;
  leaveRankedQueue(): Promise<void>;
  getCurrentMatch(): Promise<GameMatch | null>;
  createPrivateRoom(): Promise<PrivateRoom>;
  joinPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }>;
  getPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }>;
  submitAction(matchId: string, action: Action): Promise<GameMatch>;
  resolveTurn(matchId: string): Promise<GameMatch>;
  forfeitMatch(matchId: string): Promise<GameMatch>;
  watchMatch(matchId: string, onChange: () => void): () => void;
}
