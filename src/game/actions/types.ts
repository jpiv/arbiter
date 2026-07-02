import { ResourceKind, UnitState } from '../world';

/** Outcome of invoking a game action. Serializable and LLM-readable. */
export interface ActionResult {
  ok: boolean;
  /** Human/LLM-readable summary of what happened, or why it failed. */
  message: string;
}

/** Minimal JSON Schema subset used to describe an action's parameters. */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
}

/** Something a unit can be ordered to attack — an enemy base or an enemy unit. */
export interface AttackTarget {
  id: string;
  name: string;
  kind: 'base' | 'unit';
}

/** A resource node a Collector can be ordered to gather from. */
export interface CollectTarget {
  id: string;
  name: string;
  resource: ResourceKind;
}

/**
 * The player on whose behalf an action is invoked. Bound once when a
 * GameInterface is created (per agent session / per human seat), so individual
 * tool calls never carry it. An object rather than a bare id leaves room to add
 * fields (e.g. the operating mode) without another signature change.
 */
export interface Actor {
  playerId: string;
}

/**
 * Bridge from the (Phaser-agnostic) action layer to live game state. The
 * GameScene implements this; actions call into it to inspect and mutate the
 * world without knowing anything about rendering or input.
 */
export interface GameContext {
  /** Look up a unit by id, or undefined if none exists. */
  getUnit(unitId: string): UnitState | undefined;
  /** Resolve an attack target (base or unit) by id, or undefined if none exists. */
  getAttackTarget(targetId: string): AttackTarget | undefined;
  /** Order `unitId` to path toward `targetId` and attack once in range. */
  issueAttackOrder(unitId: string, targetId: string): void;
  /** Resolve a gatherable resource node by id, or undefined if none exists. */
  getCollectTarget(nodeId: string): CollectTarget | undefined;
  /** Order `unitId` to path toward `nodeId` and gather from it once in range. */
  issueCollectOrder(unitId: string, nodeId: string): void;
  /** The map's grid dimensions, so actions can keep destinations in bounds. */
  getMapBounds(): { columns: number; rows: number };
  /** Order `unitId` to path to the grid tile at column `tileX`, row `tileY`. */
  issueMoveOrder(unitId: string, tileX: number, tileY: number): void;
  /** Units owned by `playerId` (its faction's units). */
  getUnitsForPlayer(playerId: string): readonly UnitState[];
  /** Whether `unitId` belongs to `playerId` — for scoping move/attack later. */
  playerOwnsUnit(playerId: string, unitId: string): boolean;
  /** Set a player's standing directive; false if no such player exists. */
  setPlayerDirective(playerId: string, directive: string): boolean;
}

/**
 * A single action an agent (an LLM or a human via input handlers) can take.
 * Self-describing so it can be surfaced as an LLM tool; `execute` performs it
 * against the game context and reports the result. `actor` identifies the player
 * on whose behalf the action runs — actions that don't care may ignore it.
 */
export interface GameAction<Args extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: Args, context: GameContext, actor: Actor): ActionResult;
}
