import { UnitState } from '../world';

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

/** Something a unit can be ordered to attack. Bases today; units later. */
export interface AttackTarget {
  id: string;
  name: string;
  kind: 'base' | 'unit';
}

/**
 * Bridge from the (Phaser-agnostic) action layer to live game state. The
 * GameScene implements this; actions call into it to inspect and mutate the
 * world without knowing anything about rendering or input.
 */
export interface GameContext {
  /** Look up a unit by id, or undefined if none exists. */
  getUnit(unitId: string): UnitState | undefined;
  /** Resolve an attack target by id, or undefined if it isn't attackable. */
  getAttackTarget(targetId: string): AttackTarget | undefined;
  /** Order `unitId` to path toward `targetId` and attack once in range. */
  issueAttackOrder(unitId: string, targetId: string): void;
}

/**
 * A single action an agent (an LLM or a human via input handlers) can take.
 * Self-describing so it can be surfaced as an LLM tool; `execute` performs it
 * against the game context and reports the result.
 */
export interface GameAction<Args extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(args: Args, context: GameContext): ActionResult;
}
