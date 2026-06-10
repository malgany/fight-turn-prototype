import type { RealtimeChannel } from "@supabase/supabase-js";
import { authRedirectUrl, supabaseAnonKey, supabaseUrl } from "../lib/config";
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

export class SupabaseGameService implements GameService {
  readonly mode = "supabase" as const;
  private channels = new Set<RealtimeChannel>();

  private client() {
    if (!supabase) {
      throw new Error("Supabase nao configurado.");
    }
    return supabase;
  }

  private functionUrl(name: string): string {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase nao configurado.");
    }
    return `${supabaseUrl}/functions/v1/${encodeURIComponent(name)}`;
  }

  private extractErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
    return null;
  }

  private containsGameMatch(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;
    if (Array.isArray(payload)) return payload.some((item) => this.containsGameMatch(item));

    const record = payload as Record<string, unknown>;
    if (typeof record.turnDeadlineAt === "string" && typeof record.battleState === "object") return true;
    return Object.values(record).some((value) => this.containsGameMatch(value));
  }

  private async serverNow(): Promise<string> {
    const { data, error } = await this.client().rpc("server_now");
    if (error || !data) return new Date().toISOString();
    return new Date(String(data)).toISOString();
  }

  private attachServerNow<T>(payload: T, serverNow: string): T {
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      const record = value as Record<string, unknown>;
      if (typeof record.turnDeadlineAt === "string" && typeof record.battleState === "object") {
        record.serverNow = serverNow;
      }

      Object.values(record).forEach(visit);
    };

    visit(payload);
    return payload;
  }

  private async invoke<T>(name: string, body?: Record<string, unknown>): Promise<T> {
    const client = this.client();
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();

    if (sessionError) throw sessionError;
    if (!session) throw new Error("Sessao ausente.");

    const response = await fetch(this.functionUrl(name), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseAnonKey!,
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body || {}),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(this.extractErrorMessage(data) || `Falha em ${name}.`);
    }
    if (!data) {
      throw new Error(`Resposta vazia em ${name}.`);
    }

    if (!this.containsGameMatch(data)) return data as T;

    const serverNow = response.headers.get("date") || (await this.serverNow());
    return this.attachServerNow(data as T, serverNow);
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

  watchPrivateRoom(code: string, onChange: () => void): () => void {
    const normalizedCode = code.toUpperCase();
    const channel = this.client()
      .channel(`private-room:${normalizedCode}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "private_rooms", filter: `code=eq.${normalizedCode}` }, onChange)
      .subscribe();
    this.channels.add(channel);

    return () => {
      this.channels.delete(channel);
      void this.client().removeChannel(channel);
    };
  }
}
