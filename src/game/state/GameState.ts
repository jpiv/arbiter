import { BaseState, Faction, GameMap, ResourceNodeState, UnitState, WorldState } from '../world';
import {
  BaseSnapshot,
  GameOutcome,
  GameStateSnapshot,
  ResourceNodeSnapshot,
  UnitOrder,
  UnitSnapshot,
} from './types';

// Live, mutating state for a single unit. Position is the unit's center in
// fractional grid coordinates so movement is smooth and tile-size independent.
interface UnitLive {
  x: number;
  y: number;
  order: UnitOrder;
}

/**
 * The single authoritative model of the game world. Owns the map, the bases
 * (with mutable health) and units, plus each unit's live position and current
 * order. Various parts of the app read and mutate through it: the scene's
 * simulation loop, the action layer (via GameContext), the HUD, and — once
 * wired — LLM context building via {@link snapshot} / {@link toPromptText}.
 *
 * It holds no Phaser objects and does no rendering; it is pure game state.
 */
export class GameState {
  readonly map: GameMap;
  private readonly bases: BaseState[];
  private readonly units: UnitState[];
  private readonly resourceNodes: ResourceNodeState[];
  private readonly live = new Map<string, UnitLive>();

  constructor(world: WorldState) {
    this.map = world.map;
    this.bases = [world.base, world.enemyBase];
    this.units = world.units;
    this.resourceNodes = world.resourceNodes;
    for (const unit of this.units) {
      this.live.set(unit.id, {
        x: unit.position.x + 0.5,
        y: unit.position.y + 0.5,
        order: { kind: 'idle' },
      });
    }
  }

  // --- Reads ----------------------------------------------------------------

  getMap(): GameMap {
    return this.map;
  }

  getUnits(): readonly UnitState[] {
    return this.units;
  }

  getUnit(unitId: string): UnitState | undefined {
    return this.units.find((unit) => unit.id === unitId);
  }

  getBases(): readonly BaseState[] {
    return this.bases;
  }

  getBase(baseId: string): BaseState | undefined {
    return this.bases.find((base) => base.id === baseId);
  }

  getResourceNodes(): readonly ResourceNodeState[] {
    return this.resourceNodes;
  }

  getResourceNode(nodeId: string): ResourceNodeState | undefined {
    return this.resourceNodes.find((node) => node.id === nodeId);
  }

  /** Live center position (fractional grid coords), or undefined if no unit. */
  getUnitPosition(unitId: string): { x: number; y: number } | undefined {
    const live = this.live.get(unitId);
    return live ? { x: live.x, y: live.y } : undefined;
  }

  getUnitOrder(unitId: string): UnitOrder {
    return this.live.get(unitId)?.order ?? { kind: 'idle' };
  }

  /**
   * The match result if it has been decided, else null. `victory` means every
   * enemy base is destroyed ("all enemies" down); `defeat` means every player
   * base is destroyed (the player at 0 HP). Derived purely from base health, so
   * it stays correct however the bases got there.
   */
  getOutcome(): GameOutcome | null {
    const allDestroyed = (faction: Faction) => {
      const owned = this.bases.filter((base) => base.faction === faction);
      return owned.length > 0 && owned.every((base) => base.health <= 0);
    };
    if (allDestroyed(Faction.Enemy)) return 'victory';
    if (allDestroyed(Faction.Player)) return 'defeat';
    return null;
  }

  // --- Mutations (driven by the sim loop and actions) -----------------------

  setUnitPosition(unitId: string, x: number, y: number): void {
    const live = this.live.get(unitId);
    if (!live) return;
    live.x = x;
    live.y = y;
  }

  orderAttack(unitId: string, targetId: string): void {
    const live = this.live.get(unitId);
    if (live) live.order = { kind: 'attack', targetId };
  }

  orderMove(unitId: string, tileX: number, tileY: number): void {
    const live = this.live.get(unitId);
    if (live) live.order = { kind: 'move', x: tileX, y: tileY };
  }

  orderCollect(unitId: string, nodeId: string): void {
    const live = this.live.get(unitId);
    if (live) live.order = { kind: 'collect', nodeId };
  }

  clearOrder(unitId: string): void {
    const live = this.live.get(unitId);
    if (live) live.order = { kind: 'idle' };
  }

  /** Apply damage to a base and return its remaining health (0 if destroyed). */
  damageBase(baseId: string, amount: number): number {
    const base = this.getBase(baseId);
    if (!base) return 0;
    base.health = Math.max(0, base.health - amount);
    return base.health;
  }

  /**
   * Mine up to `amount` from a node, capped by its remaining reserve. Returns how
   * much was actually extracted (0 if the node is missing or already depleted) so
   * the caller can credit exactly that to the collecting player.
   */
  extractFromNode(nodeId: string, amount: number): number {
    const node = this.getResourceNode(nodeId);
    if (!node || node.amount <= 0 || amount <= 0) return 0;
    const extracted = Math.min(amount, node.amount);
    node.amount -= extracted;
    return extracted;
  }

  // --- Serialization --------------------------------------------------------

  /** A plain, JSON-serializable snapshot of the whole game state. */
  snapshot(): GameStateSnapshot {
    const bases: BaseSnapshot[] = this.bases.map((base) => ({
      id: base.id,
      name: base.name,
      faction: base.faction,
      position: { x: base.position.x, y: base.position.y },
      size: { x: base.size.x, y: base.size.y },
      health: base.health,
      destroyed: base.health <= 0,
    }));

    const units: UnitSnapshot[] = this.units.map((unit) => {
      const live = this.live.get(unit.id);
      return {
        id: unit.id,
        name: unit.name,
        role: unit.config.role,
        faction: unit.faction,
        // Report the tile the unit occupies (integer grid coords), matching
        // how bases report position — sub-tile precision isn't useful here.
        position: {
          x: live ? Math.floor(live.x) : unit.position.x,
          y: live ? Math.floor(live.y) : unit.position.y,
        },
        stats: { ...unit.config.stats },
        order: live ? live.order : { kind: 'idle' },
      };
    });

    const resourceNodes: ResourceNodeSnapshot[] = this.resourceNodes.map((node) => ({
      id: node.id,
      name: node.name,
      resource: node.resource,
      position: { x: node.position.x, y: node.position.y },
      amount: node.amount,
      depleted: node.amount <= 0,
    }));

    return {
      map: { columns: this.map.columns, rows: this.map.rows },
      bases,
      units,
      resourceNodes,
    };
  }

  /**
   * Render the current state as a compact, labeled text block suitable for
   * injecting into an LLM context. Entity ids are included in [brackets] so a
   * model can reference them directly in tool calls (e.g. the attack action).
   */
  toPromptText(): string {
    const snapshot = this.snapshot();
    const lines: string[] = [];

    lines.push('=== Game State ===');
    lines.push(
      `Map: ${snapshot.map.columns}x${snapshot.map.rows} tile grid. Coordinates are [x,y] with origin at the top-left.`,
    );

    lines.push('');
    lines.push('Bases:');
    for (const base of snapshot.bases) {
      const status = base.destroyed ? 'DESTROYED' : `HP ${base.health}`;
      lines.push(
        `- ${base.name} [${base.id}] — ${base.faction}, at [${base.position.x},${base.position.y}], ` +
          `${base.size.x}x${base.size.y} tiles — ${status}`,
      );
    }

    lines.push('');
    lines.push('Resource Nodes:');
    if (snapshot.resourceNodes.length === 0) {
      lines.push('- (none)');
    }
    for (const node of snapshot.resourceNodes) {
      const status = node.depleted ? 'DEPLETED' : `${node.amount} ${node.resource} left`;
      lines.push(
        `- ${node.name} [${node.id}] — ${node.resource}, at [${node.position.x},${node.position.y}] — ${status}`,
      );
    }

    lines.push('');
    lines.push('Units:');
    for (const unit of snapshot.units) {
      lines.push(
        `- ${unit.name} [${unit.id}] — ${unit.faction} ${unit.role}, at [${unit.position.x},${unit.position.y}] — ` +
          `HP ${unit.stats.hp}, power ${unit.stats.power}, range ${unit.stats.range}, speed ${unit.stats.speed} — ` +
          `${describeOrder(unit.order)}`,
      );
    }

    return lines.join('\n');
  }
}

function describeOrder(order: UnitOrder): string {
  switch (order.kind) {
    case 'attack':
      return `attacking ${order.targetId}`;
    case 'move':
      return `moving to [${order.x},${order.y}]`;
    case 'collect':
      return `gathering from ${order.nodeId}`;
    case 'idle':
    default:
      return 'idle';
  }
}
