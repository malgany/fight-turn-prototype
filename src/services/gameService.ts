import type {
  Action,
  AppSnapshot,
  GameMatch,
  LeaderboardEntry,
  MatchHistoryEntry,
  PlayerProfile,
  PlayerRank,
  PrivateRoom,
  RematchChoice,
  ReplaySource,
} from "../types";

export interface QueueResult {
  status: "queued" | "matched";
  match: GameMatch | null;
}

export interface GameService {
  readonly mode: "supabase" | "demo";
  getSnapshot(): Promise<AppSnapshot>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  bootstrapProfile(): Promise<AppSnapshot>;
  updateDisplayName(displayName: string): Promise<AppSnapshot>;
  selectCharacter(characterId: string): Promise<AppSnapshot>;
  heartbeat(status: PlayerProfile["presenceStatus"], matchId?: string): Promise<void>;
  getLeaderboard(): Promise<LeaderboardEntry[]>;
  getLeaderboardEntry(userId: string): Promise<LeaderboardEntry | null>;
  getHistory(): Promise<MatchHistoryEntry[]>;
  getCharacterUsage(): Promise<Record<string, number>>;
  joinRankedQueue(): Promise<QueueResult>;
  leaveRankedQueue(): Promise<void>;
  getMatch(matchId: string): Promise<GameMatch | null>;
  getReplaySource(matchId: string): Promise<ReplaySource>;
  getCurrentMatch(): Promise<GameMatch | null>;
  getMatchedQueueMatch(): Promise<GameMatch | null>;
  createPrivateRoom(): Promise<PrivateRoom>;
  joinPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }>;
  getPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }>;
  selectMatchCharacter(matchId: string, characterId: string): Promise<GameMatch>;
  markMatchReady(matchId: string): Promise<GameMatch>;
  markTurnReady(matchId: string, turnNumber: number): Promise<void>;
  submitAction(matchId: string, action: Action, turnNumber?: number): Promise<GameMatch | null>;
  resolveTurn(matchId: string): Promise<GameMatch>;
  cancelMatchSelection(matchId: string): Promise<void>;
  forfeitMatch(matchId: string): Promise<GameMatch>;
  postMatchChoice(matchId: string, choice: RematchChoice): Promise<GameMatch>;
  watchMatch(matchId: string, onChange: () => void): () => void;
  watchRankedQueue(userId: string, onChange: () => void): () => void;
  watchPrivateRoom(code: string, onChange: () => void): () => void;
}
