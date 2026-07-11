import type { RealtimeChannel } from "@supabase/supabase-js";
import { divisionForPoints } from "../domain/ranking";
import { authRedirectUrl, isNativeMobileApp, privateRoomInviteUrl, supabaseAnonKey, supabaseUrl } from "../lib/config";
import { signInWithGoogleOnMobile } from "../lib/mobileAuth";
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

const SESSION_LOOKUP_TIMEOUT_MS = 750;
const DEFAULT_FUNCTION_TIMEOUT_MS = 10_000;
const ACTION_FUNCTION_TIMEOUT_MS = 1_600;
const SERVER_CLOCK_TIMEOUT_MS = 750;

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timerId = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        globalThis.clearTimeout(timerId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timerId);
        reject(error);
      },
    );
  });
}

export class SupabaseGameService implements GameService {
  readonly mode = "supabase" as const;
  private channels = new Set<RealtimeChannel>();
  private cachedAccessToken: string | null = null;

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

  private rpcUrl(name: string): string {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase nao configurado.");
    }
    return `${supabaseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`;
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
    if (typeof record.id === "string" && "turnDeadlineAt" in record && typeof record.battleState === "object") return true;
    return Object.values(record).some((value) => this.containsGameMatch(value));
  }

  private async serverNow(): Promise<string> {
    try {
      const { data, error } = await withTimeout(
        this.client().rpc("server_now"),
        SERVER_CLOCK_TIMEOUT_MS,
        "Timeout ao sincronizar relogio.",
      );
      if (error || !data) return new Date().toISOString();
      return new Date(String(data)).toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  private attachServerNow<T>(payload: T, serverNow: string): T {
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      const record = value as Record<string, unknown>;
      if (typeof record.id === "string" && "turnDeadlineAt" in record && typeof record.battleState === "object") {
        if (typeof record.serverNow !== "string") record.serverNow = serverNow;
      }

      Object.values(record).forEach(visit);
    };

    visit(payload);
    return payload;
  }

  private async accessToken(): Promise<string> {
    const client = this.client();
    try {
      const {
        data: { session },
        error: sessionError,
      } = await withTimeout(client.auth.getSession(), SESSION_LOOKUP_TIMEOUT_MS, "Timeout ao recuperar sessao.");

      if (sessionError) throw sessionError;
      if (!session) throw new Error("Sessao ausente.");
      this.cachedAccessToken = session.access_token;
      return session.access_token;
    } catch (error) {
      if (this.cachedAccessToken && error instanceof Error && /timeout/i.test(error.message)) {
        return this.cachedAccessToken;
      }
      throw error;
    }
  }

  private async invoke<T>(name: string, body?: Record<string, unknown>, timeoutMs = DEFAULT_FUNCTION_TIMEOUT_MS): Promise<T> {
    const accessToken = await this.accessToken();
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.functionUrl(name), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: supabaseAnonKey!,
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Timeout em ${name}.`);
      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(this.extractErrorMessage(data) || `Falha em ${name}.`);
    }
    if (!data) {
      throw new Error(`Resposta vazia em ${name}.`);
    }

    if (!this.containsGameMatch(data)) return data as T;

    const serverNow = await this.serverNow();
    return this.attachServerNow(data as T, serverNow);
  }

  private async invokeRpc<T>(name: string, body: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const accessToken = await this.accessToken();
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.rpcUrl(name), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: supabaseAnonKey!,
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Timeout em ${name}.`);
      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(this.extractErrorMessage(data) || `Falha em ${name}.`);
    }
    return data as T;
  }

  private normalizePrivateRoom(room: PrivateRoom): PrivateRoom {
    return { ...room, inviteUrl: privateRoomInviteUrl(room.code) };
  }

  private normalizeSnapshot(snapshot: AppSnapshot): AppSnapshot {
    if (!snapshot.rank) return snapshot;
    return {
      ...snapshot,
      rank: {
        ...snapshot.rank,
        division: divisionForPoints(snapshot.rank.rankPoints),
      },
    };
  }

  async getSnapshot(): Promise<AppSnapshot> {
    const { data } = await this.client().auth.getSession();
    if (!data.session) {
      return { profile: null, rank: null, unlockedCharacterIds: [] };
    }
    return this.bootstrapProfile();
  }

  async signInWithGoogle(): Promise<void> {
    if (isNativeMobileApp()) {
      await signInWithGoogleOnMobile(this.client(), authRedirectUrl());
      return;
    }

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

  async bootstrapProfile(): Promise<AppSnapshot> {
    return this.normalizeSnapshot(await this.invoke<AppSnapshot>("bootstrap-profile"));
  }

  async selectCharacter(characterId: string): Promise<AppSnapshot> {
    return this.normalizeSnapshot(await this.invoke<AppSnapshot>("select-character", { characterId }));
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
      // Points are the source of truth. This also keeps the leaderboard
      // correct while older rows are being backfilled to the new progression.
      division: divisionForPoints(entry.rank_points),
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

  async getCharacterUsage(): Promise<Record<string, number>> {
    const usage: Record<string, number> = {};
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.client()
        .from("match_history")
        .select("character_id")
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;

      for (const entry of data || []) {
        usage[entry.character_id] = (usage[entry.character_id] || 0) + 1;
      }
      if ((data || []).length < pageSize) break;
    }

    return usage;
  }

  joinRankedQueue(): Promise<QueueResult> {
    return this.invoke<QueueResult>("join-ranked-queue");
  }

  async leaveRankedQueue(): Promise<void> {
    await this.invoke<{ ok: true }>("leave-ranked-queue");
  }

  async getCurrentMatch(): Promise<GameMatch | null> {
    const response = await this.invoke<{ match: GameMatch | null }>("current-match");
    if (response.match) return response.match;
    return this.getMatchedQueueMatch();
  }

  async getMatch(matchId: string): Promise<GameMatch | null> {
    try {
      return await this.invoke<GameMatch>("finish-match", { matchId });
    } catch {
      return null;
    }
  }

  async getMatchedQueueMatch(): Promise<GameMatch | null> {
    const {
      data: { session },
      error: sessionError,
    } = await this.client().auth.getSession();
    if (sessionError || !session) return null;

    const { data, error } = await this.client()
      .from("ranked_queue")
      .select("match_id,status")
      .eq("user_id", session.user.id)
      .eq("status", "matched")
      .maybeSingle();

    if (error || !data?.match_id) return null;
    const match = await this.invoke<GameMatch>("finish-match", { matchId: data.match_id });
    return match.status === "selecting" || match.status === "loading" || match.status === "active" || match.status === "waiting" || match.status === "resolving" ? match : null;
  }

  async createPrivateRoom(): Promise<PrivateRoom> {
    return this.normalizePrivateRoom(await this.invoke<PrivateRoom>("create-private-room"));
  }

  async joinPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }> {
    const response = await this.invoke<{ room: PrivateRoom; match: GameMatch | null }>("join-private-room", { code });
    return { ...response, room: this.normalizePrivateRoom(response.room) };
  }

  async getPrivateRoom(code: string): Promise<{ room: PrivateRoom; match: GameMatch | null }> {
    const response = await this.invoke<{ room: PrivateRoom; match: GameMatch | null }>("private-room", { code });
    return { ...response, room: this.normalizePrivateRoom(response.room) };
  }

  selectMatchCharacter(matchId: string, characterId: string): Promise<GameMatch> {
    return this.invoke<GameMatch>("select-match-character", { matchId, characterId });
  }

  markMatchReady(matchId: string): Promise<GameMatch> {
    return this.invoke<GameMatch>("match-start-ready", { matchId });
  }

  async markTurnReady(matchId: string, turnNumber: number): Promise<void> {
    await this.invokeRpc(
      "mark_match_turn_ready",
      { p_match_id: matchId, p_turn_number: turnNumber },
      ACTION_FUNCTION_TIMEOUT_MS,
    );
  }

  async submitAction(matchId: string, action: Action, turnNumber?: number): Promise<GameMatch | null> {
    await this.invokeRpc(
      "submit_match_action",
      {
        p_match_id: matchId,
        p_action: action,
        p_turn_number: turnNumber ?? null,
      },
      ACTION_FUNCTION_TIMEOUT_MS,
    );
    // The one-second match poll supplies the authoritative GameMatch. Returning
    // immediately keeps the local choice pending without another Edge round trip.
    return null;
  }

  resolveTurn(matchId: string): Promise<GameMatch> {
    return this.invoke<GameMatch>("resolve-turn", { matchId });
  }

  forfeitMatch(matchId: string): Promise<GameMatch> {
    return this.invoke<GameMatch>("forfeit-match", { matchId });
  }

  postMatchChoice(matchId: string, choice: "again" | "lobby"): Promise<GameMatch> {
    return this.invoke<GameMatch>("post-match-choice", { matchId, choice });
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

  watchRankedQueue(userId: string, onChange: () => void): () => void {
    const channel = this.client()
      .channel(`ranked-queue:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ranked_queue", filter: `user_id=eq.${userId}` }, onChange)
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
