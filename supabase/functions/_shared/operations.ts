import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.108.1";

type Side = "p1" | "p2";
type Action = "Poke" | "Combo" | "Grab" | "Special" | "Super" | "Block" | "Crouch" | "Jump";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const attackActions: Action[] = ["Poke", "Combo", "Grab", "Special", "Super"];
const selectableActions: Action[] = ["Poke", "Combo", "Grab", "Special", "Super", "Block", "Crouch", "Jump"];
const comboGuaranteedActions = selectableActions.filter((action) => !["Grab", "Combo"].includes(action));
const actionData: Record<Action, { speed?: number; damage?: number }> = {
  Poke: { speed: 1, damage: 4 },
  Combo: { speed: 2, damage: 12 },
  Grab: { speed: 3, damage: 12 },
  Special: { speed: 4, damage: 18 },
  Super: { speed: 5, damage: 25 },
  Block: {},
  Crouch: {},
  Jump: {},
};
const blockChip: Partial<Record<Action, number>> = { Poke: 0, Combo: 2, Special: 2, Super: 3 };
const tradeDamage: Partial<Record<Action, number>> = { Poke: 3, Combo: 4, Grab: 0, Special: 5, Super: 8 };

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...(init.headers || {}),
    },
  });
}

function fail(message: string, status = 400) {
  return json({ error: message }, { status });
}

function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

function anonClient(authHeader: string) {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

async function readBody(req: Request) {
  if (req.method === "OPTIONS") return {};
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function getUser(req: Request): Promise<User> {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader) throw new Error("Sessao ausente.");
  const { data, error } = await anonClient(authHeader).auth.getUser();
  if (error || !data.user) throw new Error("Sessao invalida.");
  return data.user;
}

function accountTypeForUser(user: User) {
  const providers = (user.identities || []).map((identity) => identity.provider);
  return user.is_anonymous || providers.includes("anonymous") ? "guest" : "google";
}

function displayNameForUser(user: User) {
  return user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || `Convidado ${user.id.slice(0, 4).toUpperCase()}`;
}

function avatarForUser(user: User) {
  return user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
}

function divisionForPoints(points: number) {
  if (points >= 1600) return "Diamond";
  if (points >= 1200) return "Platinum";
  if (points >= 800) return "Gold";
  if (points >= 400) return "Silver";
  return "Bronze";
}

function initialBattleState() {
  return {
    p1: { health: 100, super: 0 },
    p2: { health: 100, super: 0 },
    advantage: null,
    activeGuaranteedTurn: null,
    turnNumber: 1,
  };
}

function turnDurationMs(state: any) {
  return state.activeGuaranteedTurn ? 3000 : 5000;
}

function deadlineFromState(state: any) {
  return new Date(Date.now() + turnDurationMs(state)).toISOString();
}

function opposite(side: Side): Side {
  return side === "p1" ? "p2" : "p1";
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function applyDamage(state: any, target: Side, amount: number, source: Action | "Wait", blocked = false) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state[target].health = clamp(state[target].health - amount);
  if (["Combo", "Grab", "Special", "Super"].includes(source) && !blocked) {
    state[target].super = Math.min(3, state[target].super + 1);
  }
}

function consumeSuper(state: any, side: Side, action: Action | null) {
  if (action === "Super") state[side].super = 0;
}

function causesKnockdown(action: Action | "Wait", targetAction: Action | "Wait") {
  return action === "Grab" || action === "Special" || action === "Super" || (action === "Combo" && targetAction === "Jump");
}

function guaranteeTurn(side: Side, allowedActions: Action[], reason: string) {
  return { side, allowedActions, reason, durationMs: 3000 };
}

function resolveHit(state: any, winner: Side, p1Action: Action | "Wait", p2Action: Action | "Wait", advantageWin = false) {
  const loser = opposite(winner);
  const action = winner === "p1" ? p1Action : p2Action;
  const targetAction = winner === "p1" ? p2Action : p1Action;
  const damage = action === "Wait" ? 0 : actionData[action].damage || 0;
  const knockedDown = causesKnockdown(action, targetAction) ? [loser] : [];
  const guaranteedTurn = action === "Combo" && targetAction !== "Jump" ? guaranteeTurn(winner, comboGuaranteedActions, "COMBO ACERTOU") : null;
  applyDamage(state, loser, damage, action);
  state.advantage = winner;
  return { type: "hit", winner, loser, primary: advantageWin ? "PLUS DECIDIU" : `${action} ACERTOU`, secondary: `${winner.toUpperCase()} venceu o turno`, damaged: damage > 0 ? [loser] : [], knockedDown, guaranteedTurn };
}

function resolveTurn(stateInput: any, p1Action: Action | null, p2Action: Action | null) {
  const before = structuredClone(stateInput);
  const state = structuredClone(stateInput);
  state.activeGuaranteedTurn = null;
  consumeSuper(state, "p1", p1Action);
  consumeSuper(state, "p2", p2Action);
  let result: any = { type: "draw", winner: null, loser: null, primary: "NEUTRO", secondary: "Sem vantagem", damaged: [], knockedDown: [], guaranteedTurn: null };

  if (!p1Action && !p2Action) {
    state.advantage = null;
    result.primary = "TEMPO ESGOTADO";
    result.secondary = "Ninguem escolheu ataque";
  } else if (!p1Action && p2Action) {
    result = attackActions.includes(p2Action) ? { ...resolveHit(state, "p2", "Wait", p2Action), primary: "P1 SEM ACAO" } : result;
  } else if (p1Action && !p2Action) {
    result = attackActions.includes(p1Action) ? { ...resolveHit(state, "p1", p1Action, "Wait"), primary: "GOLPE LIVRE" } : result;
  } else if (p1Action && p2Action && attackActions.includes(p1Action) && attackActions.includes(p2Action)) {
    if (p1Action === p2Action) {
      if (state.advantage) {
        result = resolveHit(state, state.advantage, p1Action, p2Action, true);
      } else if (p1Action === "Grab") {
        state.advantage = null;
        result = { ...result, primary: "AGARRAO QUEBRADO", secondary: "Os dois tentaram agarrar" };
      } else {
        const damage = tradeDamage[p1Action] || 0;
        applyDamage(state, "p1", damage, p2Action);
        applyDamage(state, "p2", damage, p1Action);
        state.advantage = null;
        result = { type: "trade", winner: null, loser: null, primary: "TRADE", secondary: `${p1Action} vs ${p2Action}`, damaged: damage > 0 ? ["p1", "p2"] : [], knockedDown: [], guaranteedTurn: null };
      }
    } else {
      const p1Speed = actionData[p1Action].speed || 99;
      const p2Speed = actionData[p2Action].speed || 99;
      const speedGap = Math.abs(p1Speed - p2Speed);
      const winner = state.advantage && speedGap <= 1 ? state.advantage : p1Speed < p2Speed ? "p1" : "p2";
      result = resolveHit(state, winner, p1Action, p2Action, speedGap <= 1 && state.advantage === winner);
    }
  } else if (p1Action && p2Action) {
    const attacker: Side | null = attackActions.includes(p1Action) ? "p1" : attackActions.includes(p2Action) ? "p2" : null;
    if (attacker) {
      const attack = attacker === "p1" ? p1Action : p2Action;
      const response = attacker === "p1" ? p2Action : p1Action;
      const defender = opposite(attacker);
      const wins: Partial<Record<Action, Action[]>> = { Poke: ["Crouch", "Jump"], Combo: ["Jump"], Grab: ["Block"], Special: ["Crouch", "Jump"], Super: ["Jump"] };
      if (response === "Block" && blockChip[attack] !== undefined) {
        const chip = blockChip[attack] || 0;
        applyDamage(state, defender, chip, attack, true);
        state.advantage = defender;
        result = { type: "blocked", winner: defender, loser: attacker, primary: attack === "Super" ? "ULTIMATE PUNIDO" : "BLOQUEOU", secondary: `${defender.toUpperCase()} segurou ${attack}`, damaged: chip > 0 ? [defender] : [], knockedDown: [], guaranteedTurn: attack === "Super" ? guaranteeTurn(defender, attackActions, "BLOCK NO ULTIMATE") : null };
      } else if (response === "Crouch" && ["Combo", "Grab", "Super"].includes(attack)) {
        state.advantage = defender;
        result = { type: "evade", winner: defender, loser: attacker, primary: "ABAIXOU", secondary: `${defender.toUpperCase()} evitou ${attack}`, damaged: [], knockedDown: [], guaranteedTurn: null };
      } else if (response === "Jump" && attack === "Grab") {
        state.advantage = defender;
        result = { type: "evade", winner: defender, loser: attacker, primary: "PULOU", secondary: `${defender.toUpperCase()} escapou do agarro`, damaged: [], knockedDown: [], guaranteedTurn: guaranteeTurn(defender, selectableActions, "PULO NO GRAB") };
      } else if (wins[attack]?.includes(response)) {
        result = resolveHit(state, attacker, attacker === "p1" ? attack : response, attacker === "p2" ? attack : response);
      } else {
        state.advantage = null;
      }
    }
  }

  state.activeGuaranteedTurn = result.guaranteedTurn;
  state.turnNumber = state.turnNumber + 1;
  const p1Dead = state.p1.health <= 0;
  const p2Dead = state.p2.health <= 0;
  const matchWinner = p1Dead && p2Dead ? null : p1Dead ? "p2" : p2Dead ? "p1" : null;
  return { ...result, p1Action, p2Action, before, after: state, finished: p1Dead || p2Dead, matchWinner };
}

function canUseAction(state: any, side: Side, action: Action) {
  const guaranteed = state.activeGuaranteedTurn;
  if (guaranteed && (guaranteed.side !== side || !guaranteed.allowedActions.includes(action))) return false;
  if (action === "Super") return state[side].super >= 3;
  return true;
}

async function ensureProfile(db: SupabaseClient, user: User) {
  const accountType = accountTypeForUser(user);
  const profile = {
    id: user.id,
    display_name: displayNameForUser(user),
    avatar_url: avatarForUser(user),
    account_type: accountType,
    selected_character_id: "ninja",
    presence_status: "online",
  };

  await db.from("profiles").upsert(profile, { onConflict: "id", ignoreDuplicates: false });
  await db.from("player_rank").upsert({ user_id: user.id, division: "Bronze" }, { onConflict: "user_id", ignoreDuplicates: true });

  const { data: defaultCharacters } = await db.from("characters").select("id").eq("is_default", true).eq("enabled", true);
  if (defaultCharacters?.length) {
    await db.from("player_unlocked_characters").upsert(
      defaultCharacters.map((character: any) => ({ user_id: user.id, character_id: character.id, reason: "default" })),
      { onConflict: "user_id,character_id", ignoreDuplicates: true },
    );
  }

  return snapshot(db, user.id);
}

async function snapshot(db: SupabaseClient, userId: string) {
  const [{ data: profile }, { data: rank }, { data: unlocks }] = await Promise.all([
    db.from("profiles").select("id,display_name,avatar_url,account_type,selected_character_id,presence_status").eq("id", userId).single(),
    db.from("player_rank").select("user_id,rank_points,division,wins,losses,streak,best_streak").eq("user_id", userId).single(),
    db.from("player_unlocked_characters").select("character_id").eq("user_id", userId),
  ]);

  return {
    profile: profile
      ? {
          id: profile.id,
          displayName: profile.display_name,
          avatarUrl: profile.avatar_url,
          accountType: profile.account_type,
          selectedCharacterId: profile.selected_character_id,
          presenceStatus: profile.presence_status,
        }
      : null,
    rank: rank
      ? {
          userId: rank.user_id,
          rankPoints: rank.rank_points,
          division: rank.division,
          wins: rank.wins,
          losses: rank.losses,
          streak: rank.streak,
          bestStreak: rank.best_streak,
        }
      : null,
    unlockedCharacterIds: (unlocks || []).map((unlock: any) => unlock.character_id),
  };
}

async function validateSelectedCharacter(db: SupabaseClient, userId: string) {
  const { data: profile, error } = await db.from("profiles").select("selected_character_id").eq("id", userId).single();
  if (error || !profile) throw new Error("Perfil nao encontrado.");
  const { data: unlock } = await db.from("player_unlocked_characters").select("character_id").eq("user_id", userId).eq("character_id", profile.selected_character_id).maybeSingle();
  if (!unlock) throw new Error("Personagem selecionado esta bloqueado.");
  return profile.selected_character_id;
}

async function profileMap(db: SupabaseClient, ids: string[]) {
  const { data } = await db.from("profiles").select("id,display_name,avatar_url").in("id", ids);
  return new Map((data || []).map((profile: any) => [profile.id, profile]));
}

async function toGameMatch(db: SupabaseClient, match: any, userId: string) {
  const profiles = await profileMap(db, [match.player1_id, match.player2_id]);
  const p1 = profiles.get(match.player1_id);
  const p2 = profiles.get(match.player2_id);
  const side: Side = match.player1_id === userId ? "p1" : "p2";
  const opponentId = side === "p1" ? match.player2_id : match.player1_id;
  const { data: actions } = await db.from("match_actions").select("user_id,action").eq("match_id", match.id).eq("turn_number", match.current_turn);
  const localAction = (actions || []).find((action: any) => action.user_id === userId)?.action || null;
  const opponentHasAction = Boolean((actions || []).find((action: any) => action.user_id === opponentId));
  const delta = match.rank_delta?.[userId] || 0;
  const privateScore = match.private_score?.[userId] || null;
  return {
    id: match.id,
    matchType: match.match_type,
    status: match.status,
    playerSide: side,
    p1: { userId: match.player1_id, displayName: p1?.display_name || "P1", avatarUrl: p1?.avatar_url || null, characterId: match.player1_character_id },
    p2: { userId: match.player2_id, displayName: p2?.display_name || "P2", avatarUrl: p2?.avatar_url || null, characterId: match.player2_character_id },
    battleState: match.state,
    currentTurn: match.current_turn,
    turnDeadlineAt: match.turn_deadline_at,
    serverNow: new Date().toISOString(),
    localAction,
    opponentHasAction,
    lastTurn: match.last_turn,
    winnerId: match.winner_id,
    rankDelta: delta,
    privateScore,
  };
}

async function getCurrentMatch(db: SupabaseClient, userId: string) {
  const { data } = await db
    .from("matches")
    .select("*")
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .in("status", ["waiting", "active", "resolving", "finished", "forfeited"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toGameMatch(db, data, userId) : null;
}

async function updatePresence(db: SupabaseClient, userId: string, status: string, matchId?: string) {
  await db.from("online_presence").upsert({ user_id: userId, status, match_id: matchId || null, last_seen_at: new Date().toISOString() }, { onConflict: "user_id" });
  await db.from("profiles").update({ presence_status: status }).eq("id", userId);
}

async function applyUnlocks(db: SupabaseClient, userId: string, points: number) {
  const { data: rules } = await db.from("character_unlock_rules").select("character_id,required_points");
  const rows = (rules || [])
    .filter((rule: any) => points >= rule.required_points)
    .map((rule: any) => ({ user_id: userId, character_id: rule.character_id, reason: "rank" }));
  if (rows.length) await db.from("player_unlocked_characters").upsert(rows, { onConflict: "user_id,character_id", ignoreDuplicates: true });
}

async function updateRankForFinishedMatch(db: SupabaseClient, match: any, winnerId: string | null, loserId: string | null, loserDelta = -20) {
  if (match.match_type !== "ranked" || !winnerId || !loserId) return {};
  const { data: ranks } = await db.from("player_rank").select("*").in("user_id", [winnerId, loserId]);
  const map = new Map((ranks || []).map((rank: any) => [rank.user_id, rank]));
  const winner = map.get(winnerId);
  const loser = map.get(loserId);
  if (!winner || !loser) return {};
  const winnerPoints = winner.rank_points + 25;
  const loserPoints = Math.max(0, loser.rank_points + loserDelta);
  await db.from("player_rank").update({
    rank_points: winnerPoints,
    division: divisionForPoints(winnerPoints),
    wins: winner.wins + 1,
    streak: winner.streak + 1,
    best_streak: Math.max(winner.best_streak, winner.streak + 1),
  }).eq("user_id", winnerId);
  await db.from("player_rank").update({
    rank_points: loserPoints,
    division: divisionForPoints(loserPoints),
    losses: loser.losses + 1,
    streak: 0,
  }).eq("user_id", loserId);
  await applyUnlocks(db, winnerId, winnerPoints);
  return { [winnerId]: 25, [loserId]: loserDelta };
}

async function addHistory(db: SupabaseClient, match: any, winnerId: string | null, delta: Record<string, number>) {
  const rows = [match.player1_id, match.player2_id].map((userId) => {
    const opponentId = userId === match.player1_id ? match.player2_id : match.player1_id;
    const userIsP1 = userId === match.player1_id;
    return {
      match_id: match.id,
      user_id: userId,
      opponent_id: opponentId,
      match_type: match.match_type,
      character_id: userIsP1 ? match.player1_character_id : match.player2_character_id,
      opponent_character_id: userIsP1 ? match.player2_character_id : match.player1_character_id,
      result: winnerId ? (winnerId === userId ? "win" : "loss") : "draw",
      rank_delta: delta[userId] || 0,
    };
  });
  await db.from("match_history").insert(rows);
}

async function finishMatch(db: SupabaseClient, match: any, winnerSide: Side | null, reason: string) {
  const winnerId = winnerSide ? (winnerSide === "p1" ? match.player1_id : match.player2_id) : null;
  const loserId = winnerSide ? (winnerSide === "p1" ? match.player2_id : match.player1_id) : null;
  const rankDelta = await updateRankForFinishedMatch(db, match, winnerId, loserId, reason === "forfeit" ? -25 : -20);
  let privateScore: any = null;
  if (match.match_type === "private" && winnerId) {
    const low = match.player1_id < match.player2_id ? match.player1_id : match.player2_id;
    const high = match.player1_id < match.player2_id ? match.player2_id : match.player1_id;
    const winnerIsLow = winnerId === low;
    const { data: score } = await db.from("private_match_scores").select("*").eq("player_low_id", low).eq("player_high_id", high).maybeSingle();
    const nextLow = (score?.player_low_wins || 0) + (winnerIsLow ? 1 : 0);
    const nextHigh = (score?.player_high_wins || 0) + (winnerIsLow ? 0 : 1);
    await db.from("private_match_scores").upsert({ player_low_id: low, player_high_id: high, player_low_wins: nextLow, player_high_wins: nextHigh }, { onConflict: "player_low_id,player_high_id" });
    privateScore = {
      [match.player1_id]: { playerWins: winnerId === match.player1_id ? nextLow : nextHigh, opponentWins: winnerId === match.player1_id ? nextHigh : nextLow },
      [match.player2_id]: { playerWins: winnerId === match.player2_id ? nextLow : nextHigh, opponentWins: winnerId === match.player2_id ? nextHigh : nextLow },
    };
  }
  await addHistory(db, match, winnerId, rankDelta);
  const { data: updated } = await db.from("matches").update({
    status: reason === "forfeit" ? "forfeited" : "finished",
    winner_id: winnerId,
    loser_id: loserId,
    rank_delta: rankDelta,
    private_score: privateScore,
    finished_reason: reason,
    finished_at: new Date().toISOString(),
  }).eq("id", match.id).select("*").single();
  await updatePresence(db, match.player1_id, "online");
  await updatePresence(db, match.player2_id, "online");
  return updated;
}

async function resolveAndPersist(db: SupabaseClient, match: any) {
  const { data: actions } = await db.from("match_actions").select("*").eq("match_id", match.id).eq("turn_number", match.current_turn);
  const p1Action = (actions || []).find((action: any) => action.user_id === match.player1_id)?.action || null;
  const p2Action = (actions || []).find((action: any) => action.user_id === match.player2_id)?.action || null;
  const result = resolveTurn(match.state, p1Action, p2Action);
  await db.from("match_turns").upsert({ match_id: match.id, turn_number: match.current_turn, p1_action: p1Action, p2_action: p2Action, result }, { onConflict: "match_id,turn_number" });
  if (result.finished) {
    const updatedForState = { ...match, state: result.after, last_turn: result };
    await db.from("matches").update({ state: result.after, last_turn: result }).eq("id", match.id);
    return finishMatch(db, updatedForState, result.matchWinner, "finished");
  }
  const { data: updated } = await db.from("matches").update({
    state: result.after,
    last_turn: result,
    current_turn: result.after.turnNumber,
    turn_deadline_at: deadlineFromState(result.after),
  }).eq("id", match.id).select("*").single();
  return updated;
}

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function createMatch(db: SupabaseClient, type: "ranked" | "private", p1: any, p2: any, roomCode?: string) {
  const state = initialBattleState();
  const { data, error } = await db.from("matches").insert({
    match_type: type,
    status: "active",
    player1_id: p1.id,
    player2_id: p2.id,
    player1_character_id: p1.selected_character_id,
    player2_character_id: p2.selected_character_id,
    state,
    current_turn: 1,
    turn_deadline_at: deadlineFromState(state),
    room_code: roomCode || null,
  }).select("*").single();
  if (error) throw error;
  await updatePresence(db, p1.id, "in_match", data.id);
  await updatePresence(db, p2.id, "in_match", data.id);
  return data;
}

async function operation(req: Request, name: string) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = serviceClient();
  const user = await getUser(req);
  const body = await readBody(req);

  if (name === "bootstrap-profile") return ensureProfile(db, user);

  await ensureProfile(db, user);

  if (name === "select-character") {
    const characterId = String(body.characterId || "");
    const { data: unlock } = await db.from("player_unlocked_characters").select("character_id").eq("user_id", user.id).eq("character_id", characterId).maybeSingle();
    if (!unlock) throw new Error("Personagem bloqueado.");
    await db.from("profiles").update({ selected_character_id: characterId }).eq("id", user.id);
    return snapshot(db, user.id);
  }

  if (name === "presence-heartbeat") {
    await updatePresence(db, user.id, String(body.status || "online"), body.matchId ? String(body.matchId) : undefined);
    return { ok: true };
  }

  if (name === "join-ranked-queue") {
    const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).single();
    if (profile.account_type === "guest") throw new Error("Ranked exige login com Google.");
    await validateSelectedCharacter(db, user.id);
    const { data: rank } = await db.from("player_rank").select("rank_points").eq("user_id", user.id).single();
    const { data: opponentQueue } = await db.from("ranked_queue").select("user_id").eq("status", "waiting").neq("user_id", user.id).order("queued_at", { ascending: true }).limit(1).maybeSingle();
    if (opponentQueue) {
      const { data: opponent } = await db.from("profiles").select("*").eq("id", opponentQueue.user_id).single();
      const match = await createMatch(db, "ranked", opponent, profile);
      await db.from("ranked_queue").update({ status: "matched", match_id: match.id }).in("user_id", [user.id, opponent.id]);
      await db.from("ranked_queue").upsert({ user_id: user.id, selected_character_id: profile.selected_character_id, rank_points_snapshot: rank?.rank_points || 0, status: "matched", match_id: match.id }, { onConflict: "user_id" });
      return { status: "matched", match: await toGameMatch(db, match, user.id) };
    }
    await db.from("ranked_queue").upsert({ user_id: user.id, selected_character_id: profile.selected_character_id, rank_points_snapshot: rank?.rank_points || 0, status: "waiting", match_id: null }, { onConflict: "user_id" });
    await updatePresence(db, user.id, "in_queue");
    return { status: "queued", match: null };
  }

  if (name === "leave-ranked-queue") {
    await db.from("ranked_queue").update({ status: "cancelled" }).eq("user_id", user.id).eq("status", "waiting");
    await updatePresence(db, user.id, "online");
    return { ok: true };
  }

  if (name === "current-match") return { match: await getCurrentMatch(db, user.id) };

  if (name === "create-private-room") {
    await validateSelectedCharacter(db, user.id);
    const code = randomCode();
    const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).single();
    const { data: room, error } = await db.from("private_rooms").insert({ code, host_id: user.id }).select("*").single();
    if (error) throw error;
    return { code: room.code, status: room.status, hostName: profile.display_name, guestName: null, matchId: null, inviteUrl: `${req.headers.get("origin") || ""}/?room=${code}` };
  }

  if (name === "join-private-room") {
    const code = String(body.code || "").toUpperCase();
    const { data: room } = await db.from("private_rooms").select("*").eq("code", code).eq("status", "waiting").maybeSingle();
    if (!room) throw new Error("Sala privada invalida ou expirada.");
    if (room.host_id === user.id) throw new Error("Voce ja e o host desta sala.");
    const [{ data: host }, { data: guest }] = await Promise.all([
      db.from("profiles").select("*").eq("id", room.host_id).single(),
      db.from("profiles").select("*").eq("id", user.id).single(),
    ]);
    await validateSelectedCharacter(db, room.host_id);
    await validateSelectedCharacter(db, user.id);
    const match = await createMatch(db, "private", host, guest, code);
    await db.from("private_rooms").update({ guest_id: user.id, match_id: match.id, status: "active" }).eq("code", code);
    return {
      room: { code, status: "active", hostName: host.display_name, guestName: guest.display_name, matchId: match.id, inviteUrl: `${req.headers.get("origin") || ""}/?room=${code}` },
      match: await toGameMatch(db, match, user.id),
    };
  }

  if (name === "private-room") {
    const code = String(body.code || "").toUpperCase();
    const { data: room } = await db.from("private_rooms").select("*").eq("code", code).maybeSingle();
    if (!room) throw new Error("Sala nao encontrada.");
    const ids = [room.host_id, room.guest_id].filter(Boolean);
    const profiles = await profileMap(db, ids);
    const match = room.match_id ? await db.from("matches").select("*").eq("id", room.match_id).maybeSingle() : { data: null };
    return {
      room: { code, status: room.status, hostName: profiles.get(room.host_id)?.display_name || "Host", guestName: room.guest_id ? profiles.get(room.guest_id)?.display_name || "Visitante" : null, matchId: room.match_id, inviteUrl: `${req.headers.get("origin") || ""}/?room=${code}` },
      match: match.data ? await toGameMatch(db, match.data, user.id) : null,
    };
  }

  if (name === "submit-action") {
    const matchId = String(body.matchId || "");
    const action = String(body.action || "") as Action;
    if (!selectableActions.includes(action)) throw new Error("Acao invalida.");
    const { data: match } = await db.from("matches").select("*").eq("id", matchId).single();
    if (!match || ![match.player1_id, match.player2_id].includes(user.id)) throw new Error("Partida nao encontrada.");
    if (match.status !== "active") return toGameMatch(db, match, user.id);
    const side: Side = match.player1_id === user.id ? "p1" : "p2";
    if (!canUseAction(match.state, side, action)) throw new Error("Acao nao permitida neste turno.");
    if (new Date(match.turn_deadline_at).getTime() < Date.now()) {
      const updated = await resolveAndPersist(db, match);
      return toGameMatch(db, updated, user.id);
    }
    await db.from("match_actions").upsert({ match_id: match.id, turn_number: match.current_turn, user_id: user.id, action }, { onConflict: "match_id,turn_number,user_id" });
    const { data: actions } = await db.from("match_actions").select("user_id").eq("match_id", match.id).eq("turn_number", match.current_turn);
    const updated = (actions || []).length >= 2 ? await resolveAndPersist(db, match) : match;
    return toGameMatch(db, updated, user.id);
  }

  if (name === "resolve-turn") {
    const { data: match } = await db.from("matches").select("*").eq("id", String(body.matchId || "")).single();
    if (!match || ![match.player1_id, match.player2_id].includes(user.id)) throw new Error("Partida nao encontrada.");
    if (new Date(match.turn_deadline_at).getTime() > Date.now()) return toGameMatch(db, match, user.id);
    const updated = await resolveAndPersist(db, match);
    return toGameMatch(db, updated, user.id);
  }

  if (name === "finish-match") {
    const { data: match } = await db.from("matches").select("*").eq("id", String(body.matchId || "")).single();
    if (!match || ![match.player1_id, match.player2_id].includes(user.id)) throw new Error("Partida nao encontrada.");
    return toGameMatch(db, match, user.id);
  }

  if (name === "forfeit-match") {
    const { data: match } = await db.from("matches").select("*").eq("id", String(body.matchId || "")).single();
    if (!match || ![match.player1_id, match.player2_id].includes(user.id)) throw new Error("Partida nao encontrada.");
    const winnerSide: Side = match.player1_id === user.id ? "p2" : "p1";
    const updated = await finishMatch(db, match, winnerSide, "forfeit");
    return toGameMatch(db, updated, user.id);
  }

  throw new Error(`Operacao desconhecida: ${name}`);
}

export function serveOperation(name: string) {
  Deno.serve(async (req) => {
    try {
      return json(await operation(req, name));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error), 400);
    }
  });
}
