import type { Action, BattleState, GuaranteedTurn, Side, TurnResolution } from "../types";

export const TURN_DURATION_MS = 5000;
export const GUARANTEED_TURN_DURATION_MS = 3000;

export const attackActions: Action[] = ["Poke", "Combo", "Grab", "Special", "Super"];
export const selectableActions: Action[] = ["Poke", "Combo", "Grab", "Special", "Super", "Block", "Crouch", "Jump"];
export const comboGuaranteedActions: Action[] = selectableActions.filter((action) => !["Grab", "Combo"].includes(action));

export interface BattleCharacterContext {
  p1CharacterId?: string | null;
  p2CharacterId?: string | null;
}

const actionNames: Record<Action | "Wait", string> = {
  Poke: "POKE",
  Combo: "COMBO",
  Grab: "GRAB",
  Special: "SPECIAL",
  Super: "ULTIMATE",
  Block: "BLOCK",
  Crouch: "CROUCH",
  Jump: "JUMP",
  Wait: "WAIT",
};

const actionData: Record<Action, { speed?: number; damage?: number; type?: "defense" | "movement" }> = {
  Poke: { speed: 1, damage: 4 },
  Combo: { speed: 2, damage: 12 },
  Grab: { speed: 3, damage: 12 },
  Special: { speed: 4, damage: 18 },
  Super: { speed: 5, damage: 25 },
  Block: { type: "defense" },
  Crouch: { type: "movement" },
  Jump: { type: "movement" },
};

const blockChip: Partial<Record<Action, number>> = { Poke: 0, Combo: 2, Special: 2, Super: 3 };
const tradeDamage: Partial<Record<Action, number>> = { Poke: 3, Combo: 4, Grab: 0, Special: 5, Super: 8 };
const nonAttackActions: Action[] = ["Block", "Crouch", "Jump"];

export function createInitialBattleState(): BattleState {
  return {
    p1: { health: 100, super: 0 },
    p2: { health: 100, super: 0 },
    advantage: null,
    activeGuaranteedTurn: null,
    turnNumber: 1,
  };
}

export function displayActionName(action: Action | "Wait"): string {
  return actionNames[action];
}

export function canUseAction(state: BattleState, side: Side, action: Action): boolean {
  const guaranteedTurn = state.activeGuaranteedTurn;

  if (guaranteedTurn) {
    if (guaranteedTurn.side !== side) return false;
    if (!guaranteedTurn.allowedActions.includes(action)) return false;
  }

  if (action === "Super") {
    return state[side].super >= 3;
  }

  return true;
}

function cloneState(state: BattleState): BattleState {
  return {
    p1: { ...state.p1 },
    p2: { ...state.p2 },
    advantage: state.advantage,
    activeGuaranteedTurn: state.activeGuaranteedTurn ? { ...state.activeGuaranteedTurn, allowedActions: [...state.activeGuaranteedTurn.allowedActions] } : null,
    turnNumber: state.turnNumber,
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function opposite(side: Side): Side {
  return side === "p1" ? "p2" : "p1";
}

function applyDamage(state: BattleState, targetSide: Side, amount: number, sourceAction: Action | "Wait", options: { blocked?: boolean } = {}): void {
  if (!Number.isFinite(amount) || amount <= 0) return;

  state[targetSide].health = clampPercent(state[targetSide].health - amount);
  if (["Combo", "Grab", "Special", "Super"].includes(sourceAction) && !options.blocked) {
    state[targetSide].super = Math.min(3, state[targetSide].super + 1);
  }
}

function applyHeal(state: BattleState, side: Side, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const previousHealth = state[side].health;
  state[side].health = clampPercent(state[side].health + amount);
  return Math.max(0, state[side].health - previousHealth);
}

function consumeSuper(state: BattleState, side: Side, action: Action | null): void {
  if (action === "Super") {
    state[side].super = 0;
  }
}

function isDoll(side: Side, context: BattleCharacterContext): boolean {
  return (side === "p1" ? context.p1CharacterId : context.p2CharacterId) === "doll";
}

function isDollAction(side: Side, action: Action | "Wait" | null, expectedAction: Action, context: BattleCharacterContext): boolean {
  return action === expectedAction && isDoll(side, context);
}

function isDollSpecial(side: Side, action: Action | "Wait" | null, context: BattleCharacterContext): boolean {
  return isDollAction(side, action, "Special", context);
}

function isDollUltimate(side: Side, action: Action | "Wait" | null, context: BattleCharacterContext): boolean {
  return isDollAction(side, action, "Super", context);
}

function causesKnockdown(action: Action | "Wait", targetAction: Action | "Wait", winner: Side, context: BattleCharacterContext): boolean {
  if (isDollUltimate(winner, action, context)) return false;
  if (action === "Grab" || action === "Special" || action === "Super") return true;
  return action === "Combo" && targetAction === "Jump";
}

function guaranteeTurn(side: Side, allowedActions: Action[], reason: string): GuaranteedTurn {
  return {
    side,
    allowedActions,
    reason,
    durationMs: GUARANTEED_TURN_DURATION_MS,
  };
}

function baseResult(state: BattleState, p1Action: Action | null, p2Action: Action | null): Omit<TurnResolution, "before" | "after" | "finished" | "matchWinner"> {
  return {
    type: "draw",
    winner: null,
    loser: null,
    primary: "NEUTRO",
    secondary: "Sem vantagem",
    damaged: [],
    healed: [],
    healing: {},
    knockedDown: [],
    guaranteedTurn: null,
    p1Action,
    p2Action,
  };
}

function resolveDollUltimateHeal(state: BattleState, side: Side) {
  const healedAmount = applyHeal(state, side, 28);
  state.advantage = null;

  return {
    type: "hit" as const,
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

function resolveHit(state: BattleState, winner: Side, p1Action: Action | "Wait", p2Action: Action | "Wait", advantageWin = false, context: BattleCharacterContext = {}) {
  const loser = opposite(winner);
  const action = winner === "p1" ? p1Action : p2Action;
  const targetAction = winner === "p1" ? p2Action : p1Action;
  const isDollSpecialHit = isDollSpecial(winner, action, context);
  const damage = action === "Wait" ? 0 : isDollSpecialHit ? 10 : actionData[action].damage || 0;
  const knockedDown = causesKnockdown(action, targetAction, winner, context) ? [loser] : [];
  const guaranteedTurn = action === "Combo" && targetAction !== "Jump" ? guaranteeTurn(winner, comboGuaranteedActions, "COMBO ACERTOU") : null;

  applyDamage(state, loser, damage, action);
  const healedAmount = isDollSpecialHit ? applyHeal(state, winner, Math.round(state[winner].health * 0.1)) : 0;
  state.advantage = winner;

  return {
    type: "hit" as const,
    winner,
    loser,
    primary: advantageWin ? "PLUS DECIDIU" : `${displayActionName(action)} ACERTOU`,
    secondary: `${winner.toUpperCase()} venceu o turno`,
    damaged: damage > 0 ? [loser] : [],
    healed: healedAmount > 0 ? [winner] : [],
    healing: healedAmount > 0 ? { [winner]: healedAmount } : {},
    knockedDown,
    guaranteedTurn,
  };
}

function resolveAttackVsAttack(state: BattleState, p1Action: Action, p2Action: Action, context: BattleCharacterContext) {
  const ignoresAdvantage = isDollUltimate("p1", p1Action, context) || isDollUltimate("p2", p2Action, context);
  if (p1Action === p2Action) {
    if (state.advantage && !ignoresAdvantage) {
      return resolveHit(state, state.advantage, p1Action, p2Action, true, context);
    }

    state.advantage = null;
    if (p1Action === "Grab") {
      return {
        type: "draw" as const,
        winner: null,
        loser: null,
        primary: "AGARRAO QUEBRADO",
        secondary: "Os dois tentaram agarrar",
        damaged: [],
        healed: [],
        healing: {},
        knockedDown: [],
        guaranteedTurn: null,
      };
    }

    const damage = tradeDamage[p1Action] || 0;
    applyDamage(state, "p1", damage, p2Action);
    applyDamage(state, "p2", damage, p1Action);
    return {
      type: "trade" as const,
      winner: null,
      loser: null,
      primary: "TRADE",
      secondary: `${displayActionName(p1Action)} vs ${displayActionName(p2Action)}`,
      damaged: damage > 0 ? (["p1", "p2"] as Side[]) : [],
      healed: [],
      healing: {},
      knockedDown: [],
      guaranteedTurn: null,
    };
  }

  const p1Speed = actionData[p1Action].speed || 99;
  const p2Speed = actionData[p2Action].speed || 99;
  const speedGap = Math.abs(p1Speed - p2Speed);
  let winner: Side = p1Speed < p2Speed ? "p1" : "p2";

  if (state.advantage && speedGap <= 1 && !ignoresAdvantage) {
    winner = state.advantage;
  }

  return resolveHit(state, winner, p1Action, p2Action, speedGap <= 1 && state.advantage === winner && !ignoresAdvantage, context);
}

function resolveAttackVsResponse(state: BattleState, attacker: Side, attack: Action, response: Action, context: BattleCharacterContext) {
  const defender = opposite(attacker);
  const wins: Partial<Record<Action, Action[]>> = {
    Poke: ["Crouch", "Jump"],
    Combo: ["Jump"],
    Grab: ["Block"],
    Special: ["Crouch", "Jump"],
    Super: ["Jump"],
  };

  if (isDollUltimate(attacker, attack, context) && nonAttackActions.includes(response)) {
    return resolveDollUltimateHeal(state, attacker);
  }

  if (response === "Block" && blockChip[attack] !== undefined) {
    const chip = blockChip[attack] || 0;
    applyDamage(state, defender, chip, attack, { blocked: true });
    state.advantage = defender;
    return {
      type: "blocked" as const,
      winner: defender,
      loser: attacker,
      primary: attack === "Super" ? "ULTIMATE PUNIDO" : "BLOQUEOU",
      secondary: `${defender.toUpperCase()} segurou ${displayActionName(attack)}`,
      damaged: chip > 0 ? [defender] : [],
      healed: [],
      healing: {},
      knockedDown: [],
      guaranteedTurn: attack === "Super" ? guaranteeTurn(defender, attackActions, "BLOCK NO ULTIMATE") : null,
    };
  }

  if (response === "Crouch" && ["Combo", "Grab", "Super"].includes(attack)) {
    state.advantage = defender;
    return {
      type: "evade" as const,
      winner: defender,
      loser: attacker,
      primary: "ABAIXOU",
      secondary: `${defender.toUpperCase()} evitou ${displayActionName(attack)}`,
      damaged: [],
      healed: [],
      healing: {},
      knockedDown: [],
      guaranteedTurn: null,
    };
  }

  if (response === "Jump" && attack === "Grab") {
    state.advantage = defender;
    return {
      type: "evade" as const,
      winner: defender,
      loser: attacker,
      primary: "PULOU",
      secondary: `${defender.toUpperCase()} escapou do agarro`,
      damaged: [],
      healed: [],
      healing: {},
      knockedDown: [],
      guaranteedTurn: guaranteeTurn(defender, selectableActions, "PULO NO GRAB"),
    };
  }

  if (wins[attack]?.includes(response)) {
    const p1Action = attacker === "p1" ? attack : response;
    const p2Action = attacker === "p2" ? attack : response;
    return resolveHit(state, attacker, p1Action, p2Action, false, context);
  }

  state.advantage = null;
  return {
    type: "draw" as const,
    winner: null,
    loser: null,
    primary: "NEUTRO",
    secondary: `${displayActionName(attack)} nao conectou`,
    damaged: [],
    healed: [],
    healing: {},
    knockedDown: [],
    guaranteedTurn: null,
  };
}

export function resolveBattleTurn(currentState: BattleState, p1Action: Action | null, p2Action: Action | null, context: BattleCharacterContext = {}): TurnResolution {
  const before = cloneState(currentState);
  const state = cloneState(currentState);
  const guaranteedTurn = currentState.activeGuaranteedTurn;
  state.activeGuaranteedTurn = null;

  consumeSuper(state, "p1", p1Action);
  consumeSuper(state, "p2", p2Action);

  let partial = baseResult(state, p1Action, p2Action);
  const dollUltimateSide = isDollUltimate("p1", p1Action, context)
    ? "p1"
    : isDollUltimate("p2", p2Action, context)
      ? "p2"
      : null;

  if (dollUltimateSide && guaranteedTurn?.side === dollUltimateSide) {
    partial = { ...partial, ...resolveDollUltimateHeal(state, dollUltimateSide) };
  } else if (!p1Action && !p2Action) {
    state.advantage = null;
    partial = { ...partial, primary: "TEMPO ESGOTADO", secondary: "Ninguem escolheu ataque" };
  } else if (!p1Action) {
    if (p2Action && attackActions.includes(p2Action)) {
      partial = { ...partial, ...resolveHit(state, "p2", "Wait", p2Action, false, context), primary: "P1 SEM ACAO" };
    } else {
      state.advantage = null;
      partial = { ...partial, primary: "P1 SEM ACAO", secondary: "Sem ataque direto" };
    }
  } else if (!p2Action) {
    if (attackActions.includes(p1Action)) {
      partial = { ...partial, ...resolveHit(state, "p1", p1Action, "Wait", false, context), primary: "GOLPE LIVRE" };
    } else {
      state.advantage = null;
      partial = { ...partial, primary: "NEUTRO", secondary: "Sem ataque direto" };
    }
  } else if (attackActions.includes(p1Action) && attackActions.includes(p2Action)) {
    partial = { ...partial, ...resolveAttackVsAttack(state, p1Action, p2Action, context) };
  } else if (attackActions.includes(p1Action)) {
    partial = { ...partial, ...resolveAttackVsResponse(state, "p1", p1Action, p2Action, context) };
  } else if (attackActions.includes(p2Action)) {
    partial = { ...partial, ...resolveAttackVsResponse(state, "p2", p2Action, p1Action, context) };
  } else {
    state.advantage = null;
    partial = { ...partial, primary: "NEUTRO", secondary: `${displayActionName(p1Action)} vs ${displayActionName(p2Action)}` };
  }

  state.activeGuaranteedTurn = partial.guaranteedTurn;
  state.turnNumber = currentState.turnNumber + 1;

  const p1Dead = state.p1.health <= 0;
  const p2Dead = state.p2.health <= 0;
  const matchWinner = p1Dead && p2Dead ? null : p1Dead ? "p2" : p2Dead ? "p1" : null;

  return {
    ...partial,
    p1Action,
    p2Action,
    before,
    after: state,
    finished: p1Dead || p2Dead,
    matchWinner,
  };
}

export function turnDurationForState(state: BattleState): number {
  return state.activeGuaranteedTurn ? GUARANTEED_TURN_DURATION_MS : TURN_DURATION_MS;
}
