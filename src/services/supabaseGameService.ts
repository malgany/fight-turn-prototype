import type { RealtimeChannel } from "@supabase/supabase-js";
import { authRedirectUrl } from "../lib/config";
import { supabase } from "../lib/supabase";
import type {
  Action,
  AppSnapshot,
  GameMatch,
  LeaderboardEntry,
  MatchHistoryEntry,
  PlayerProfile,
  PrivateRoom,
} from "../types";
import type { GameService, QueueResult } from "./gameService";

type FunctionResponse<T> = {
  data: T | null;
  error: { message: string } | null;
};

export class SupabaseGameService implements GameService {
  readonly mode = "supabase" as const;
  private channels = new Set<RealtimeChannel>();

  private client() {
    if (!supabase) {
      throw new Error("Supabase nao configurado.");
    }
    return supabase;
  }

  private async invoke<T>(name: string, body?: Record<string, unknown>): Promise<T> {
    const response = (await this.client().functions.invoke(name, { body })) as FunctionResponse<T>;
    if (response.error) {
      throw new Error(response.error.message);
    }
    if (!response.data) {
      throw new Error(`Resposta vazia em ${name}.`);
    }
    return response.data;
  }

  async getSnapshot(): Promise<AppSnapshot> {
    const { data } = await this.client().auth.getSession();
    if (!data.session) {
      return { profile: null, rank: null, unlockedCharacterIds: [] };
    }
    return this.bootstrapProfile();
  }

  async signInWithGoogle(): Promise<void> {
    const { error } = await this.client().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: authRedirectUrl() },
    });
    if (error) throw error;
  }

  async signInAsGuest(): Promise<void> {
    const { error } = await this.client().auth.signInAnonymously();
    if (error) throw error;
    await this.bootstrapProfile();
  }

  async linkGuestWithGoogle(): Promise<void> {
    const { error } = await this.client().auth.linkIdentity({
      provider: "google",
      options: { redirectTo: authRedirectUrl() },
    });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    this.channels.forEach((channel) => this.client().removeChannel(channel));
    this.channels.clear();
    const { error } = await this.client().auth.signOut();
    if (error) throw error;
  }

  bootstrapProfile(): Promise<AppSnapshot> {
    return this.invoke<AppSnapshot>("bootstrap-profile");
  }

  selectCharacter(characterId: string): Promise<AppSnapshot> {
    return this.invoke<AppSnapshot>("select-character", { characterId });
  }

  async heartbeat(status: PlayerProfile["presenceStatus"], matchId?: string): Promise<void> {
    await this.invoke<{ ok: true }>("presence-heartbeat", { status, matchId });
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const { data, error } = await this.client()
      .from("leaderboard")
      .select("position,user_id,display_name,avatar_url,rank_points,division,wins,losses,streak")
      .order("position", { ascending: true })
      .limit(100);
    if (error) throw error;
    return (data || []).map((entry: any) => ({
      position: entry.position,
      userId: entry.user_id,
      displayName: entry.display_name,
      avatarUrl: entry.avatar_url,
      rankPoints: entry.rank_points,
      division: entry.division,
      wins: entry.wins,
      losses: entry.losses,
      streak: entry.streak,
    }));
  }

  async getHistory(): Promise<MatchHistoryEntry[]> {
    const { data, error } = await this.client()
      .from("match_history_view")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data || []).map((entry: any) => ({
      id: entry.id,
      matchId: entry.match_id,
      opponentName: entry.opponent_name,
      matchType: entry.match_type,
      characterId: entry.character_id,
      opponentCharacterId: entry.opponent_character_id,
      result: entry.result,
      rankDelta: entry.rank_delta || 0,
      createdAt: entry.created_at,
    }));
  }

  joinRankedQueue(): Promise<QueueResult> {
    return this.invoke<QueueResult>("join-ranked-queue");
  }

  async leaveRankedQueue(): Promise<void> {
    await this.invoke<{ ok: true }>("leave-ranked-queue");
  }

  async getCurrentMatch(): Promise<GameMatch | null> {
    return this.invoke<{ match: GameMatch | null }>("current-match").then((response) => response.match);
  }

  createPrivateRoom(): Promise<PrivateRoom> {
    return this.invoke<PrivateRoom>("create-private-room");
  }

  joinPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }> {
    return this.invoke<{ room: PrivateRoom; match: GameMatch | null }>("join-private-room", { code });
  }

  getPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }> {
    return this.invoke<{ room: PrivateRoom; match: GameMatch | null }>("private-room", { code });
  }

  submitAction(matchId: string, action: Action): Promise<GameMatch> {
    return this.invoke<GameMatch>("submit-action", { matchId, action });
  }

  resolveTurn(matchId: string): Promise<GameMatch> {
    return this.invoke<GameMatch>("resolve-turn", { matchId });
  }

  forfeitMatch(matchId: string): Promise<GameMatch> {
    return this.invoke<GameMatch>("forfeit-match", { matchId });
  }

  watchMatch(matchId: string, onChange: () => void): () => void {
    const channel = this.client()
      .channel(`match:${matchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_turns", filter: `match_id=eq.${matchId}` }, onChange)
      .subscribe();
    this.channels.add(channel);

    return () => {
      this.channels.delete(channel);
      void this.client().removeChannel(channel);
    };
  }
}
