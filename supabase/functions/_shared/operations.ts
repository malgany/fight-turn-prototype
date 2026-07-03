import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.108.1";

type Side = "p1" | "p2";
type Action = "Poke" | "Combo" | "Grab" | "Special" | "Super" | "Block" | "Crouch" | "Jump";
type RematchChoice = "again" | "lobby";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const defaultCharacterRows = [
  { id: "ninja", name: "Ninja", portrait_url: "/assets/ui/character-select/fighter-ninja.webp", enabled: true, is_default: true, sort_order: 10 },
  { id: "itzcoatl", name: "Itzcoatl", portrait_url: "/assets/ui/character-select/fighter-shaman.webp", enabled: true, is_default: true, sort_order: 20 },
  { id: "aton", name: "Aton", portrait_url: "/assets/ui/character-select/fighter-urban.webp", enabled: true, is_default: true, sort_order: 30 },
  { id: "doll", name: "Doll.exe", portrait_url: "/assets/ui/character-select/fighter-doll.png", enabled: true, is_default: true, sort_order: 40 },
  { id: "coming-soon", name: "Em breve", portrait_url: "/assets/ui/character-select/fighter-coming-soon-face-question.webp", enabled: false, is_default: false, sort_order: 90 },
];

const defaultCharacterUnlockRules = [
  { character_id: "ninja", required_division: "Bronze", required_points: 0, description: "Disponivel desde o inicio" },
  { character_id: "itzcoatl", required_division: "Bronze", required_points: 0, description: "Disponivel desde o inicio" },
  { character_id: "aton", required_division: "Bronze", required_points: 0, description: "Disponivel desde o inicio" },
  { character_id: "doll", required_division: "Bronze", required_points: 0, description: "Disponivel desde o inicio" },
  { character_id: "coming-soon", required_division: "Gold", required_points: 800, description: "Personagem futuro por ranking" },
];

const attackActions: Action[] = ["Poke", "Combo", "Grab", "Special", "Super"];
const selectableActions: Action[] = ["Poke", "Combo", "Grab", "Special", "Super", "Block", "Crouch", "Jump"];
const comboGuaranteedActions = selectableActions.filter((action) => !["Grab", "Combo"].includes(action));
const TURN_RESOLUTION_VISUAL_BUFFER_MS = 15000;
const ACTION_SUBMIT_GRACE_MS = 1200;
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
const nonAttackActions: Action[] = ["Block", "Crouch", "Jump"];

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
    itzcoatlResurrectionUsed: { p1: false, p2: false },
    turnNumber: 1,
  };
}

function turnDurationMs(state: any) {
  return state.activeGuaranteedTurn ? 3000 : 5000;
}

function deadlineFromState(state: any) {
  return new Date(Date.now() + turnDurationMs(state)).toISOString();
}

function deadlineAfterTurnResolution(state: any) {
  return new Date(Date.now() + turnDurationMs(state) + TURN_RESOLUTION_VISUAL_BUFFER_MS).toISOString();
}

function opposite(side: Side): Side {
  return side === "p1" ? "p2" : "p1";
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function grantsDefenderSuper(source: Action | "Wait", options: { comboKnockdown?: boolean }) {
  if (source === "Combo") return Boolean(options.comboKnockdown);
  return ["Grab", "Special", "Super"].includes(source);
}

function applyDamage(state: any, target: Side, amount: number, source: Action | "Wait", options: { blocked?: boolean; comboKnockdown?: boolean } = {}) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state[target].health = clamp(state[target].health - amount);
  if (grantsDefenderSuper(source, options) && !options.blocked) {
    state[target].super = Math.min(3, state[target].super + 1);
  }
}

function applyHeal(state: any, side: Side, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const previousHealth = state[side].health;
  state[side].health = clamp(state[side].health + amount);
  return Math.max(0, state[side].health - previousHealth);
}

function consumeSuper(state: any, side: Side, action: Action | null) {
  if (action === "Super") state[side].super = 0;
}

function isDoll(side: Side, context: any) {
  return (side === "p1" ? context?.p1CharacterId : context?.p2CharacterId) === "doll";
}

function isKrampus(side: Side, context: any) {
  return (side === "p1" ? context?.p1CharacterId : context?.p2CharacterId) === "ninja";
}

function isItzcoatl(side: Side, context: any) {
  return (side === "p1" ? context?.p1CharacterId : context?.p2CharacterId) === "itzcoatl";
}

function isAton(side: Side, context: any) {
  return (side === "p1" ? context?.p1CharacterId : context?.p2CharacterId) === "aton";
}

function isDollAction(side: Side, action: Action | "Wait" | null, expectedAction: Action, context: any) {
  return action === expectedAction && isDoll(side, context);
}

function isDollSpecial(side: Side, action: Action | "Wait" | null, context: any) {
  return isDollAction(side, action, "Special", context);
}

function isDollUltimate(side: Side, action: Action | "Wait" | null, context: any) {
  return isDollAction(side, action, "Super", context);
}

function causesKnockdown(action: Action | "Wait", targetAction: Action | "Wait", winner: Side, context: any) {
  return action === "Grab" || action === "Special" || action === "Super" || (action === "Combo" && targetAction === "Jump");
}

function actionDamage(side: Side, action: Action | "Wait", context: any) {
  if (action === "Wait") return 0;
  if (isDollSpecial(side, action, context)) return 10;
  if (isKrampus(side, context) && action === "Special") return 13;
  if (isKrampus(side, context) && action === "Super") return 30;
  return actionData[action].damage || 0;
}

function blockDamage(attacker: Side, attack: Action, beforeState: any, context: any) {
  const baseChip = blockChip[attack] || 0;
  const atonBonus = isAton(attacker, context) && beforeState[attacker].super >= 3 ? 4 : 0;
  return baseChip + atonBonus;
}

function applyKrampusKnockdownPassive(state: any, side: Side, knockedDown: Side[], context: any) {
  if (knockedDown.length > 0 && isKrampus(side, context)) {
    state[side].super = Math.min(3, state[side].super + 1);
  }
}

function addHealingToResult(result: any, side: Side, amount: number) {
  if (amount <= 0) return result;
  return {
    ...result,
    healed: result.healed.includes(side) ? result.healed : [...result.healed, side],
    healing: {
      ...(result.healing || {}),
      [side]: (result.healing?.[side] || 0) + amount,
    },
  };
}

function applyDollTurnStartPassive(state: any, result: any, context: any) {
  let nextResult = result;
  (["p1", "p2"] as Side[]).forEach((side) => {
    if (!isDoll(side, context) || state[side].health <= 0) return;
    const healedAmount = applyHeal(state, side, 1);
    nextResult = addHealingToResult(nextResult, side, healedAmount);
  });
  return nextResult;
}

function applyItzcoatlResurrection(state: any, result: any, context: any) {
  let nextResult = result;
  (["p1", "p2"] as Side[]).forEach((side) => {
    if (!isItzcoatl(side, context) || state[side].health > 0 || state.itzcoatlResurrectionUsed?.[side]) return;
    state[side].health = 1;
    state.itzcoatlResurrectionUsed = { ...state.itzcoatlResurrectionUsed, [side]: true };
    nextResult = addHealingToResult(nextResult, side, 1);
  });
  return nextResult;
}

function guaranteeTurn(side: Side, allowedActions: Action[], reason: string) {
  return { side, allowedActions, reason, durationMs: 3000 };
}

function resolveDollUltimateHeal(state: any, side: Side) {
  const healedAmount = applyHeal(state, side, 30);
  state.advantage = null;
  return {
    type: "hit",
    winner: side,
    loser: opposite(side),
    primary: "DOLL.EXE RECUPEROU",
    secondary: `${side.toUpperCase()} recuperou vida`,
    damaged: [],
    healed: healedAmount > 0 ? [side] : [],
    healing: healedAmount > 0 ? { [side]: healedAmount } : {},
    knockedDown: [],
    guaranteedTurn: null,
  };
}

function resolveBothDollUltimatesHeal(state: any) {
  const p1HealedAmount = applyHeal(state, "p1", 30);
  const p2HealedAmount = applyHeal(state, "p2", 30);
  state.advantage = null;
  return {
    type: "draw",
    winner: null,
    loser: null,
    primary: "DOLL.EXE RECUPEROU",
    secondary: "As duas Doll.exe recuperaram vida",
    damaged: [],
    healed: [
      ...(p1HealedAmount > 0 ? ["p1"] : []),
      ...(p2HealedAmount > 0 ? ["p2"] : []),
    ],
    healing: {
      ...(p1HealedAmount > 0 ? { p1: p1HealedAmount } : {}),
      ...(p2HealedAmount > 0 ? { p2: p2HealedAmount } : {}),
    },
    knockedDown: [],
    guaranteedTurn: null,
  };
}

function resolveHit(state: any, winner: Side, p1Action: Action | "Wait", p2Action: Action | "Wait", advantageWin = false, context: any = {}) {
  const loser = opposite(winner);
  const action = winner === "p1" ? p1Action : p2Action;
  const targetAction = winner === "p1" ? p2Action : p1Action;
  const isDollSpecialHit = isDollSpecial(winner, action, context);
  const damage = actionDamage(winner, action, context);
  const knockedDown = causesKnockdown(action, targetAction, winner, context) ? [loser] : [];
  const guaranteedTurn = action === "Combo" && targetAction !== "Jump" ? guaranteeTurn(winner, comboGuaranteedActions, "COMBO ACERTOU") : null;
  applyDamage(state, loser, damage, action, { comboKnockdown: knockedDown.length > 0 });
  applyKrampusKnockdownPassive(state, winner, knockedDown, context);
  const healedAmount = isDollSpecialHit ? applyHeal(state, winner, 10) : 0;
  state.advantage = winner;
  return {
    type: "hit",
    winner,
    loser,
    primary: advantageWin ? "PLUS DECIDIU" : `${action} ACERTOU`,
    secondary: `${winner.toUpperCase()} venceu o turno`,
    damaged: damage > 0 ? [loser] : [],
    healed: healedAmount > 0 ? [winner] : [],
    healing: healedAmount > 0 ? { [winner]: healedAmount } : {},
    knockedDown,
    guaranteedTurn,
  };
}

function resolveTurn(stateInput: any, p1Action: Action | null, p2Action: Action | null, matchContext: any = {}) {
  const before = structuredClone(stateInput);
  const state = structuredClone(stateInput);
  const context = {
    p1CharacterId: matchContext?.player1_character_id,
    p2CharacterId: matchContext?.player2_character_id,
  };
  const guaranteedTurn = stateInput.activeGuaranteedTurn;
  state.activeGuaranteedTurn = null;
  consumeSuper(state, "p1", p1Action);
  consumeSuper(state, "p2", p2Action);
  let result: any = { type: "draw", winner: null, loser: null, primary: "NEUTRO", secondary: "Sem vantagem", damaged: [], healed: [], healing: {}, knockedDown: [], guaranteedTurn: null };
  const dollUltimateSide = isDollUltimate("p1", p1Action, context) ? "p1" : isDollUltimate("p2", p2Action, context) ? "p2" : null;
  const p1DollUltimate = isDollUltimate("p1", p1Action, context);
  const p2DollUltimate = isDollUltimate("p2", p2Action, context);

  if (p1DollUltimate && p2DollUltimate) {
    result = resolveBothDollUltimatesHeal(state);
  } else if (p1DollUltimate && p2Action && attackActions.includes(p2Action)) {
    result = resolveHit(state, "p2", "Super", p2Action, false, context);
  } else if (p2DollUltimate && p1Action && attackActions.includes(p1Action)) {
    result = resolveHit(state, "p1", p1Action, "Super", false, context);
  } else if (dollUltimateSide) {
    result = resolveDollUltimateHeal(state, dollUltimateSide);
  } else if (!p1Action && !p2Action) {
    state.advantage = null;
    result.primary = "TEMPO ESGOTADO";
    result.secondary = "Ninguem escolheu ataque";
  } else if (!p1Action && p2Action) {
    result = attackActions.includes(p2Action) ? { ...resolveHit(state, "p2", "Wait", p2Action, false, context), primary: "P1 SEM ACAO" } : result;
  } else if (p1Action && !p2Action) {
    result = attackActions.includes(p1Action) ? { ...resolveHit(state, "p1", p1Action, "Wait", false, context), primary: "GOLPE LIVRE" } : result;
  } else if (p1Action && p2Action && attackActions.includes(p1Action) && attackActions.includes(p2Action)) {
    const ignoresAdvantage = isDollUltimate("p1", p1Action, context) || isDollUltimate("p2", p2Action, context);
    if (p1Action === p2Action) {
      if (state.advantage && !ignoresAdvantage) {
        result = resolveHit(state, state.advantage, p1Action, p2Action, true, context);
      } else if (p1Action === "Grab") {
        state.advantage = null;
        result = { ...result, primary: "AGARRAO QUEBRADO", secondary: "Os dois tentaram agarrar" };
      } else {
        const damage = tradeDamage[p1Action] || 0;
        applyDamage(state, "p1", damage, p2Action);
        applyDamage(state, "p2", damage, p1Action);
        state.advantage = null;
        result = { type: "trade", winner: null, loser: null, primary: "TRADE", secondary: `${p1Action} vs ${p2Action}`, damaged: damage > 0 ? ["p1", "p2"] : [], healed: [], healing: {}, knockedDown: [], guaranteedTurn: null };
      }
    } else {
      const p1Speed = actionData[p1Action].speed || 99;
      const p2Speed = actionData[p2Action].speed || 99;
      const speedGap = Math.abs(p1Speed - p2Speed);
      const winner = state.advantage && speedGap <= 1 && !ignoresAdvantage ? state.advantage : p1Speed < p2Speed ? "p1" : "p2";
      result = resolveHit(state, winner, p1Action, p2Action, speedGap <= 1 && state.advantage === winner && !ignoresAdvantage, context);
    }
  } else if (p1Action && p2Action) {
    const attacker: Side | null = attackActions.includes(p1Action) ? "p1" : attackActions.includes(p2Action) ? "p2" : null;
    if (attacker) {
      const attack = attacker === "p1" ? p1Action : p2Action;
      const response = attacker === "p1" ? p2Action : p1Action;
      const defender = opposite(attacker);
      const wins: Partial<Record<Action, Action[]>> = { Poke: ["Crouch", "Jump"], Combo: ["Jump"], Grab: ["Block"], Special: ["Crouch", "Jump"], Super: ["Jump"] };
      if (isDollUltimate(attacker, attack, context) && nonAttackActions.includes(response)) {
        result = resolveDollUltimateHeal(state, attacker);
      } else if (response === "Block" && blockChip[attack] !== undefined) {
        const chip = blockDamage(attacker, attack, stateInput, context);
        applyDamage(state, defender, chip, attack, { blocked: true });
        state.advantage = defender;
        result = { type: "blocked", winner: defender, loser: attacker, primary: attack === "Super" ? "ULTIMATE PUNIDO" : "BLOQUEOU", secondary: `${defender.toUpperCase()} segurou ${attack}`, damaged: chip > 0 ? [defender] : [], healed: [], healing: {}, knockedDown: [], guaranteedTurn: attack === "Super" ? guaranteeTurn(defender, attackActions, "BLOCK NO ULTIMATE") : null };
      } else if (response === "Crouch" && ["Combo", "Grab", "Super"].includes(attack)) {
        state.advantage = defender;
        result = { type: "evade", winner: defender, loser: attacker, primary: "ABAIXOU", secondary: `${defender.toUpperCase()} evitou ${attack}`, damaged: [], healed: [], healing: {}, knockedDown: [], guaranteedTurn: null };
      } else if (response === "Jump" && attack === "Grab") {
        state.advantage = defender;
        result = { type: "evade", winner: defender, loser: attacker, primary: "PULOU", secondary: `${defender.toUpperCase()} escapou do agarro`, damaged: [], healed: [], healing: {}, knockedDown: [], guaranteedTurn: guaranteeTurn(defender, selectableActions, "PULO NO GRAB") };
      } else if (wins[attack]?.includes(response)) {
        result = resolveHit(state, attacker, attacker === "p1" ? attack : response, attacker === "p2" ? attack : response, false, context);
      } else {
        state.advantage = null;
      }
    }
  }

  state.activeGuaranteedTurn = result.guaranteedTurn;
  state.turnNumber = state.turnNumber + 1;
  result = applyItzcoatlResurrection(state, result, context);
  const p1DeadAfterResurrection = state.p1.health <= 0;
  const p2DeadAfterResurrection = state.p2.health <= 0;
  if (!p1DeadAfterResurrection && !p2DeadAfterResurrection) {
    result = applyDollTurnStartPassive(state, result, context);
  }
  const p1DeadAfterPassive = state.p1.health <= 0;
  const p2DeadAfterPassive = state.p2.health <= 0;
  const matchWinner = p1DeadAfterPassive && p2DeadAfterPassive ? null : p1DeadAfterPassive ? "p2" : p2DeadAfterPassive ? "p1" : null;
  return { ...result, p1Action, p2Action, before, after: state, finished: p1DeadAfterPassive || p2DeadAfterPassive, matchWinner };
}

function canUseAction(state: any, side: Side, action: Action) {
  const guaranteed = state.activeGuaranteedTurn;
  if (guaranteed && (guaranteed.side !== side || !guaranteed.allowedActions.includes(action))) return false;
  if (action === "Super") return state[side].super >= 3;
  return true;
}

function sideUserId(match: any, side: Side) {
  return side === "p1" ? match.player1_id : match.player2_id;
}

function requiredActionUserIds(match: any) {
  const guaranteed = match.state?.activeGuaranteedTurn;
  if (guaranteed?.side === "p1" || guaranteed?.side === "p2") {
    return [sideUserId(match, guaranteed.side)];
  }

  return [match.player1_id, match.player2_id];
}

function hasRequiredActions(match: any, actions: any[]) {
  const submittedUserIds = new Set((actions || []).map((action: any) => action.user_id));
  return requiredActionUserIds(match).every((userId) => submittedUserIds.has(userId));
}

async function ensureProfile(db: SupabaseClient, user: User) {
  await ensureDefaultCharacters(db);

  const accountType = accountTypeForUser(user);
  const profile = {
    id: user.id,
    display_name: displayNameForUser(user),
    avatar_url: avatarForUser(user),
    account_type: accountType,
    selected_character_id: "ninja",
    presence_status: "online",
  };

  await db.from("profiles").upsert(profile, { onConflict: "id", ignoreDuplicates: true });
  await db
    .from("profiles")
    .update({ display_name: profile.display_name, avatar_url: profile.avatar_url, account_type: profile.account_type })
    .eq("id", user.id);
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

async function ensureDefaultCharacters(db: SupabaseClient) {
  await db.from("characters").upsert(defaultCharacterRows, { onConflict: "id" });
  await db.from("character_unlock_rules").upsert(defaultCharacterUnlockRules, { onConflict: "character_id" });
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

async function validateCharacterUnlock(db: SupabaseClient, userId: string, characterId: string) {
  const { data: character } = await db.from("characters").select("id,enabled").eq("id", characterId).eq("enabled", true).maybeSingle();
  if (!character) throw new Error("Personagem invalido.");
  const { data: unlock } = await db.from("player_unlocked_characters").select("character_id").eq("user_id", userId).eq("character_id", characterId).maybeSingle();
  if (!unlock) throw new Error("Personagem bloqueado.");
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
  const rematchChoices = match.rematch_choices || {};
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
    finishedReason: match.finished_reason || null,
    rematch: {
      localChoice: rematchChoices[userId] || null,
      opponentChoice: rematchChoices[opponentId] || null,
      nextMatchId: match.rematch_next_match_id || null,
    },
  };
}

async function getCurrentMatch(db: SupabaseClient, userId: string) {
  const baseQuery = () => db
    .from("matches")
    .select("*")
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`);

  const { data: liveMatch } = await baseQuery()
    .in("status", ["waiting", "selecting", "active", "resolving"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (liveMatch) return toGameMatch(db, await activateMatchIfReady(db, liveMatch), userId);

  const { data: finishedMatch } = await baseQuery()
    .in("status", ["finished", "forfeited"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return finishedMatch ? toGameMatch(db, finishedMatch, userId) : null;
}

async function getLiveMatchRow(db: SupabaseClient, userId: string) {
  const { data } = await db
    .from("matches")
    .select("*")
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
    .in("status", ["waiting", "selecting", "active", "resolving"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function activateMatchIfReady(db: SupabaseClient, match: any) {
  if (match.status !== "selecting" || !match.player1_character_id || !match.player2_character_id) return match;

  const state = match.state || initialBattleState();
  const { data: active } = await db.from("matches").update({
    status: "active",
    state,
    current_turn: 1,
    turn_deadline_at: deadlineAfterTurnResolution(state),
    last_turn: null,
  }).eq("id", match.id).eq("status", "selecting").select("*").maybeSingle();

  if (!active) return match;
  await updatePresence(db, active.player1_id, "in_match", active.id);
  await updatePresence(db, active.player2_id, "in_match", active.id);
  return active;
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
  if (!match.player1_character_id || !match.player2_character_id) return;
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

function isInactiveTimeoutResult(result: any) {
  return result?.primary === "TEMPO ESGOTADO" && !result.p1Action && !result.p2Action;
}

async function consecutiveInactiveTimeouts(db: SupabaseClient, match: any, result: any) {
  if (!isInactiveTimeoutResult(result)) return 0;

  const { data: turns } = await db
    .from("match_turns")
    .select("turn_number,p1_action,p2_action")
    .eq("match_id", match.id)
    .gte("turn_number", match.current_turn - 2)
    .lte("turn_number", match.current_turn)
    .order("turn_number", { ascending: false })
    .limit(3);

  const recentTurns = turns || [];
  if (recentTurns.length !== 3) return 0;
  return recentTurns.every((turn: any) => !turn.p1_action && !turn.p2_action) ? 3 : 0;
}

async function resolveAndPersist(db: SupabaseClient, match: any) {
  let { data: claimed } = await db.from("matches").update({ status: "resolving" })
    .eq("id", match.id)
    .eq("current_turn", match.current_turn)
    .eq("status", "active")
    .select("*")
    .maybeSingle();
  if (!claimed && match.status === "resolving") {
    claimed = match;
  }
  if (!claimed) {
    const { data: latest } = await db.from("matches").select("*").eq("id", match.id).single();
    return latest;
  }

  match = claimed;
  const { data: actions } = await db.from("match_actions").select("*").eq("match_id", match.id).eq("turn_number", match.current_turn);
  const p1Action = (actions || []).find((action: any) => action.user_id === match.player1_id)?.action || null;
  const p2Action = (actions || []).find((action: any) => action.user_id === match.player2_id)?.action || null;
  const result = resolveTurn(match.state, p1Action, p2Action, match);
  await db.from("match_turns").upsert({ match_id: match.id, turn_number: match.current_turn, p1_action: p1Action, p2_action: p2Action, result }, { onConflict: "match_id,turn_number" });
  if (await consecutiveInactiveTimeouts(db, match, result) >= 3) {
    const inactivityResult = {
      ...result,
      primary: "PARTIDA ENCERRADA",
      secondary: "Tres turnos sem acao. Empate sem perda de pontos.",
    };
    const updatedForState = { ...match, state: result.after, last_turn: inactivityResult };
    await db.from("matches").update({ state: result.after, last_turn: inactivityResult }).eq("id", match.id);
    return finishMatch(db, updatedForState, null, "inactivity_draw");
  }
  if (result.finished) {
    const updatedForState = { ...match, state: result.after, last_turn: result };
    await db.from("matches").update({ state: result.after, last_turn: result }).eq("id", match.id);
    return finishMatch(db, updatedForState, result.matchWinner, "finished");
  }
  const { data: updated } = await db.from("matches").update({
    status: "active",
    state: result.after,
    last_turn: result,
    current_turn: result.after.turnNumber,
    turn_deadline_at: deadlineAfterTurnResolution(result.after),
  }).eq("id", match.id).eq("current_turn", match.current_turn).eq("status", "resolving").select("*").maybeSingle();
  if (updated) return updated;

  const { data: latest } = await db.from("matches").select("*").eq("id", match.id).single();
  return latest;
}

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function createMatch(db: SupabaseClient, type: "ranked" | "private", p1: any, p2: any, roomCode?: string) {
  const state = initialBattleState();
  const { data, error } = await db.from("matches").insert({
    match_type: type,
    status: "selecting",
    player1_id: p1.id,
    player2_id: p2.id,
    player1_character_id: null,
    player2_character_id: null,
    state,
    current_turn: 1,
    turn_deadline_at: deadlineAfterTurnResolution(state),
    room_code: roomCode || null,
  }).select("*").single();
  if (error) throw error;
  await updatePresence(db, p1.id, "in_match", data.id);
  await updatePresence(db, p2.id, "in_match", data.id);
  return data;
}

async function createRematch(db: SupabaseClient, previousMatch: any, nextMatchId: string) {
  const state = initialBattleState();
  const { data, error } = await db.from("matches").insert({
    id: nextMatchId,
    match_type: previousMatch.match_type,
    status: "active",
    player1_id: previousMatch.player1_id,
    player2_id: previousMatch.player2_id,
    player1_character_id: previousMatch.player1_character_id,
    player2_character_id: previousMatch.player2_character_id,
    state,
    current_turn: 1,
    turn_deadline_at: deadlineAfterTurnResolution(state),
    last_turn: null,
    room_code: previousMatch.room_code || null,
  }).select("*").single();
  if (error) throw error;
  await updatePresence(db, previousMatch.player1_id, "in_match", data.id);
  await updatePresence(db, previousMatch.player2_id, "in_match", data.id);
  return data;
}

async function choosePostMatch(db: SupabaseClient, matchId: string, userId: string, choice: RematchChoice) {
  const { data: match } = await db.from("matches").select("*").eq("id", matchId).single();
  if (!match || ![match.player1_id, match.player2_id].includes(userId)) throw new Error("Partida nao encontrada.");
  if (!["finished", "forfeited"].includes(match.status)) throw new Error("A partida ainda nao terminou.");

  const choices = { ...(match.rematch_choices || {}), [userId]: choice };
  const { data: updated } = await db
    .from("matches")
    .update({ rematch_choices: choices })
    .eq("id", match.id)
    .select("*")
    .single();

  if (choice !== "again") {
    await updatePresence(db, userId, "online");
    return updated;
  }

  if (match.rematch_next_match_id) {
    const { data: nextMatch } = await db.from("matches").select("*").eq("id", match.rematch_next_match_id).single();
    return nextMatch || updated;
  }

  const opponentId = userId === match.player1_id ? match.player2_id : match.player1_id;
  if (choices[opponentId] !== "again") {
    await updatePresence(db, userId, "in_match", match.id);
    return updated;
  }

  const nextMatchId = crypto.randomUUID();
  const { data: reserved } = await db
    .from("matches")
    .update({ rematch_next_match_id: nextMatchId, rematch_choices: choices })
    .eq("id", match.id)
    .is("rematch_next_match_id", null)
    .select("*")
    .maybeSingle();

  if (!reserved) {
    const { data: latest } = await db.from("matches").select("*").eq("id", match.id).single();
    if (latest?.rematch_next_match_id) {
      const { data: nextMatch } = await db.from("matches").select("*").eq("id", latest.rematch_next_match_id).single();
      return nextMatch || latest;
    }
    return latest || updated;
  }

  const nextMatch = await createRematch(db, reserved, nextMatchId);
  await db.from("matches").update({ rematch_choices: choices }).eq("id", reserved.id);
  return nextMatch;
}

async function selectMatchCharacter(db: SupabaseClient, matchId: string, userId: string, characterId: string) {
  await validateCharacterUnlock(db, userId, characterId);
  const { data: match } = await db.from("matches").select("*").eq("id", matchId).single();
  if (!match || ![match.player1_id, match.player2_id].includes(userId)) throw new Error("Partida nao encontrada.");
  if (!["selecting", "active"].includes(match.status)) throw new Error("Partida nao aceita selecao de personagem.");

  const column = match.player1_id === userId ? "player1_character_id" : "player2_character_id";
  const currentCharacter = match[column];
  if (currentCharacter && currentCharacter !== characterId) throw new Error("Personagem da partida ja foi escolhido.");

  const { data: selected } = await db.from("matches").update({ [column]: characterId }).eq("id", match.id).select("*").single();
  if (!selected) throw new Error("Nao foi possivel selecionar personagem.");

  const active = await activateMatchIfReady(db, selected);
  if (active.status === "active") return active;

  await updatePresence(db, userId, "in_match", selected.id);
  return selected;
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
    const existingLiveMatch = await getLiveMatchRow(db, user.id);
    if (existingLiveMatch) {
      const activeExistingMatch = await activateMatchIfReady(db, existingLiveMatch);
      return { status: "matched", match: await toGameMatch(db, activeExistingMatch, user.id) };
    }
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
    const code = randomCode();
    const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).single();
    const { data: room, error } = await db.from("private_rooms").insert({ code, host_id: user.id }).select("*").single();
    if (error) throw error;
    return { code: room.code, status: room.status, hostName: profile.display_name, guestName: null, matchId: null, inviteUrl: `${req.headers.get("origin") || ""}/online/?room=${code}` };
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
    const match = await createMatch(db, "private", host, guest, code);
    await db.from("private_rooms").update({ guest_id: user.id, match_id: match.id, status: "active" }).eq("code", code);
    return {
      room: { code, status: "active", hostName: host.display_name, guestName: guest.display_name, matchId: match.id, inviteUrl: `${req.headers.get("origin") || ""}/online/?room=${code}` },
      match: await toGameMatch(db, match, user.id),
    };
  }

  if (name === "private-room") {
    const code = String(body.code || "").toUpperCase();
    const { data: room } = await db.from("private_rooms").select("*").eq("code", code).maybeSingle();
    if (!room) throw new Error("Sala nao encontrada.");
    if (room.host_id !== user.id && room.guest_id !== user.id) throw new Error("Voce ainda nao entrou nesta sala.");
    const ids = [room.host_id, room.guest_id].filter(Boolean);
    const profiles = await profileMap(db, ids);
    const match = room.match_id ? await db.from("matches").select("*").eq("id", room.match_id).maybeSingle() : { data: null };
    return {
      room: { code, status: room.status, hostName: profiles.get(room.host_id)?.display_name || "Host", guestName: room.guest_id ? profiles.get(room.guest_id)?.display_name || "Visitante" : null, matchId: room.match_id, inviteUrl: `${req.headers.get("origin") || ""}/online/?room=${code}` },
      match: match.data ? await toGameMatch(db, match.data, user.id) : null,
    };
  }

  if (name === "select-match-character") {
    const matchId = String(body.matchId || "");
    const characterId = String(body.characterId || "");
    if (!matchId || !characterId) throw new Error("Partida e personagem sao obrigatorios.");
    const match = await selectMatchCharacter(db, matchId, user.id, characterId);
    return toGameMatch(db, match, user.id);
  }

  if (name === "submit-action") {
    const matchId = String(body.matchId || "");
    const action = String(body.action || "") as Action;
    const requestedTurnNumber = Number(body.turnNumber);
    if (!selectableActions.includes(action)) throw new Error("Acao invalida.");
    const { data: match } = await db.from("matches").select("*").eq("id", matchId).single();
    if (!match || ![match.player1_id, match.player2_id].includes(user.id)) throw new Error("Partida nao encontrada.");
    if (match.status !== "active") return toGameMatch(db, match, user.id);
    if (Number.isFinite(requestedTurnNumber) && requestedTurnNumber !== match.current_turn) {
      return toGameMatch(db, match, user.id);
    }
    const side: Side = match.player1_id === user.id ? "p1" : "p2";
    if (!canUseAction(match.state, side, action)) throw new Error("Acao nao permitida neste turno.");
    if (new Date(match.turn_deadline_at).getTime() + ACTION_SUBMIT_GRACE_MS < Date.now()) {
      const updated = await resolveAndPersist(db, match);
      return toGameMatch(db, updated, user.id);
    }
    await db.from("match_actions").upsert({ match_id: match.id, turn_number: match.current_turn, user_id: user.id, action }, { onConflict: "match_id,turn_number,user_id" });
    const { data: actions } = await db.from("match_actions").select("user_id").eq("match_id", match.id).eq("turn_number", match.current_turn);
    const updated = hasRequiredActions(match, actions || []) ? await resolveAndPersist(db, match) : match;
    return toGameMatch(db, updated, user.id);
  }

  if (name === "resolve-turn") {
    const { data: match } = await db.from("matches").select("*").eq("id", String(body.matchId || "")).single();
    if (!match || ![match.player1_id, match.player2_id].includes(user.id)) throw new Error("Partida nao encontrada.");
    if (!["active", "resolving"].includes(match.status)) return toGameMatch(db, match, user.id);
    if (match.status === "active" && new Date(match.turn_deadline_at).getTime() + ACTION_SUBMIT_GRACE_MS > Date.now()) return toGameMatch(db, match, user.id);
    const updated = await resolveAndPersist(db, { ...match, status: "active" });
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

  if (name === "post-match-choice") {
    const matchId = String(body.matchId || "");
    const choice = String(body.choice || "") as RematchChoice;
    if (!["again", "lobby"].includes(choice)) throw new Error("Escolha invalida.");
    const updated = await choosePostMatch(db, matchId, user.id, choice);
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
