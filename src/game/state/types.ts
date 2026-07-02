import { ControllerKind, Faction, PlayerResources, ResourceKind, UnitRole, UnitStats } from '../world';

/**
 * The decided result of a match: `victory` when every enemy base is destroyed,
 * `defeat` when every player base is destroyed. A match still in progress has no
 * outcome (callers use `GameOutcome | null`).
 */
export type GameOutcome = 'victory' | 'defeat';

/** What a unit is currently doing. Extend as new orders are added. */
export type UnitOrder =
  | { kind: 'idle' }
  | { kind: 'attack'; targetId: string }
  // Walking to a destination tile (integer grid coords), with nothing to fight.
  | { kind: 'move'; x: number; y: number }
  // Moving to a resource node and mining it until it (or the reserve) runs out.
  | { kind: 'collect'; nodeId: string };

/** A base as seen in a state snapshot (serializable, no live-object refs). */
export interface BaseSnapshot {
  id: string;
  name: string;
  faction: Faction;
  position: { x: number; y: number };
  size: { x: number; y: number };
  health: number;
  destroyed: boolean;
}

/** A unit as seen in a state snapshot. `position` is the tile it occupies. */
export interface UnitSnapshot {
  id: string;
  name: string;
  role: UnitRole;
  faction: Faction;
  position: { x: number; y: number };
  // Current health; `stats.hp` is the max it started with.
  hp: number;
  stats: UnitStats;
  order: UnitOrder;
}

/** A resource node as seen in a state snapshot. `amount` is the reserve left. */
export interface ResourceNodeSnapshot {
  id: string;
  name: string;
  resource: ResourceKind;
  position: { x: number; y: number };
  amount: number;
  depleted: boolean;
}

/**
 * A plain, JSON-serializable picture of the whole game at one instant. This is
 * the canonical serialized form — safe to `JSON.stringify`, send to a server,
 * or hand to an LLM as structured tool output. `GameState.toPromptText()`
 * renders the same data as a compact text block for prompt injection.
 */
export interface GameStateSnapshot {
  map: { columns: number; rows: number };
  bases: BaseSnapshot[];
  units: UnitSnapshot[];
  resourceNodes: ResourceNodeSnapshot[];
}

/**
 * A player as seen in a state snapshot. Omits transient coordination state (e.g.
 * whether the human is mid-chat) — only the durable, serializable fields. Lives
 * in the PlayerRegistry's own snapshot, composed alongside GameStateSnapshot.
 */
export interface PlayerSnapshot {
  id: string;
  name: string;
  faction: Faction;
  controller: ControllerKind;
  agentId: string;
  directive: string;
  resources: PlayerResources;
}
