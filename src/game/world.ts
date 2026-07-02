export enum TerrainKind {
  Ground = 'ground',
  Forest = 'forest',
  Ridge = 'ridge',
  Water = 'water',
}

export enum Faction {
  Player = 'player',
  Enemy = 'enemy',
}

export enum UnitRole {
  Scout = 'Scout',
  Soldier = 'Soldier',
  RangedSoldier = 'Ranged Soldier',
  Builder = 'Builder',
  Collector = 'Collector',
}

/**
 * A gatherable resource type. Just one to start ("Resource 1"); resources are
 * modeled as a keyed record so more kinds can be added later without reshaping
 * any player or snapshot structure.
 */
export enum ResourceKind {
  Resource1 = 'resource1',
}

/** How much of each resource a player currently holds. */
export type PlayerResources = Record<ResourceKind, number>;

/** A fresh, zeroed stockpile — one entry per known {@link ResourceKind}. */
export function emptyResources(): PlayerResources {
  return { [ResourceKind.Resource1]: 0 };
}

/** Who drives a player: the human at the keyboard, or an autonomous agent loop. */
export type ControllerKind = 'user' | 'ai';

/**
 * A player in the game. Multiplayer-ready: many of these exist, all agent-driven,
 * and any number can share a faction (team). Each base/unit names its owning
 * player via `ownerId`; `faction` is only the team (used for coloring and the
 * win condition). Serializable — holds no live objects. Defined here (not in
 * state/) so world.ts stays dependency-free and avoids a circular import with
 * state/types.ts, which imports from this file.
 */
export interface PlayerRecord {
  id: string;
  name: string;
  faction: Faction;
  controller: ControllerKind;
  // Joins to an Agent def in agents.ts (its command/play prompts).
  agentId: string;
  // Standing operating plan the autonomous loop reads each tick; '' = none.
  directive: string;
  // Stockpile of gathered resources, keyed by kind. Collectors credit this.
  resources: PlayerResources;
}

export interface UnitStats {
  speed: number;
  range: number;
  hp: number;
  power: number;
}

export interface UnitConfig {
  role: UnitRole;
  stats: UnitStats;
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface GameMap {
  columns: number;
  rows: number;
  tileSize: number;
  terrain: TerrainKind[][];
}

export interface BaseState {
  id: string;
  name: string;
  faction: Faction;
  // The player that owns this base (PlayerRecord.id).
  ownerId: string;
  position: GridPoint;
  size: GridPoint;
  health: number;
}

export interface UnitState {
  id: string;
  name: string;
  config: UnitConfig;
  faction: Faction;
  // The player that owns/commands this unit (PlayerRecord.id).
  ownerId: string;
  position: GridPoint;
}

/**
 * A resource deposit on the map. A single tile a Collector can gather from; its
 * `amount` is a finite reserve that depletes as it's mined. Neutral map terrain
 * (no faction) — whichever side sends a Collector reaps it.
 */
export interface ResourceNodeState {
  id: string;
  name: string;
  resource: ResourceKind;
  position: GridPoint;
  amount: number;
}

export interface WorldState {
  map: GameMap;
  // Every base in the match (one per seat), player and enemy alike.
  bases: BaseState[];
  units: UnitState[];
  // Gatherable resource deposits scattered on the map (see prototypeWorld).
  resourceNodes: ResourceNodeState[];
  // Every player in the match — see prototypeWorld / SEATS below.
  players: PlayerRecord[];
}

export const UNIT_CONFIGS: Record<UnitRole, UnitConfig> = {
  [UnitRole.Builder]: {
    role: UnitRole.Builder,
    stats: {
      speed: 3,
      range: 1,
      hp: 90,
      power: 8,
    },
  },
  [UnitRole.Scout]: {
    role: UnitRole.Scout,
    stats: {
      speed: 6,
      range: 3,
      hp: 70,
      power: 10,
    },
  },
  [UnitRole.Soldier]: {
    role: UnitRole.Soldier,
    stats: {
      speed: 4,
      // Melee: must close to point-blank before it can land a hit.
      range: 1,
      hp: 120,
      power: 22,
    },
  },
  [UnitRole.RangedSoldier]: {
    role: UnitRole.RangedSoldier,
    stats: {
      speed: 4,
      // Ranged: strikes from well outside the melee soldier's reach (and the
      // scout's), trading durability and per-hit punch for that standoff.
      range: 4,
      hp: 90,
      power: 16,
    },
  },
  // A non-combat gatherer. `range` is how close it must get to a node to mine
  // it; `power` doubles as the amount of resource pulled per collection tick.
  [UnitRole.Collector]: {
    role: UnitRole.Collector,
    stats: {
      speed: 4,
      range: 1,
      hp: 80,
      power: 10,
    },
  },
};

// A large map so there is more world than fits on screen at once, which is what
// makes the pan controls (see GameScene) meaningful.
const MAP_COLUMNS = 60;
const MAP_ROWS = 24;
const MAP_TILE_SIZE = 54;

const DEFAULT_BASE_SIZE: GridPoint = { x: 3, y: 3 };
const DEFAULT_BASE_HEALTH = 100;

// The standing "play to win" plan every enemy starts with, so the autonomous
// loop drives it from the first tick (an empty directive would stay passive).
// Phrased without hard-coded ids — the agent reads the state to find the player
// base — so it holds however many players are in the match.
const ENEMY_DIRECTIVE =
  "Win the game: destroy the player's base and eliminate their forces while keeping your own " +
  'base alive. Advance your units on the player base and press the attack — do not stall.';

// One player in the match: a base placement, some starting units, the agent that
// commands it, and its team. The whole world (players, bases, units) is generated
// from this list, so adding another player — friend or foe — is just one more
// entry here; no other code changes.
interface SeatSpec {
  id: string;
  name: string;
  faction: Faction;
  controller: ControllerKind;
  agentId: string;
  directive: string;
  basePosition: GridPoint;
  baseSize?: GridPoint;
  baseHealth?: number;
  // Roles to spawn near the base at game start, in order.
  startingUnits: UnitRole[];
}

// The human commander.
const PLAYER_SEAT: SeatSpec = {
  id: 'player-1',
  name: 'Commander',
  faction: Faction.Player,
  controller: 'user',
  agentId: 'arbiter-prime',
  directive: '',
  basePosition: { x: 18, y: 10 },
  startingUnits: [
    UnitRole.Scout,
    UnitRole.Soldier,
    UnitRole.RangedSoldier,
    UnitRole.Builder,
    UnitRole.Collector,
  ],
};

// The AI opponents. Add or remove entries to change how many enemies the match
// starts with; each becomes its own agent-driven player with a base and one
// soldier. They share the Enemy team, so the player wins by destroying every
// enemy base (see GameState.getOutcome).
const ENEMY_SEATS: SeatSpec[] = [
  {
    id: 'enemy-1',
    name: 'Adversary I',
    faction: Faction.Enemy,
    controller: 'ai',
    agentId: 'adversary-prime',
    directive: ENEMY_DIRECTIVE,
    basePosition: { x: 40, y: 5 },
    startingUnits: [UnitRole.Soldier],
  },
  {
    id: 'enemy-2',
    name: 'Adversary II',
    faction: Faction.Enemy,
    controller: 'ai',
    agentId: 'adversary-prime',
    directive: ENEMY_DIRECTIVE,
    basePosition: { x: 40, y: 17 },
    startingUnits: [UnitRole.Soldier],
  },
];

// Every seat in the match. Order is cosmetic; the human need not be first.
const SEATS: SeatSpec[] = [PLAYER_SEAT, ...ENEMY_SEATS];

function seatBaseSize(seat: SeatSpec): GridPoint {
  return seat.baseSize ?? DEFAULT_BASE_SIZE;
}

function buildBase(seat: SeatSpec): BaseState {
  return {
    id: `base-${seat.id}`,
    name: `${seat.name} Base`,
    faction: seat.faction,
    ownerId: seat.id,
    position: seat.basePosition,
    size: seatBaseSize(seat),
    health: seat.baseHealth ?? DEFAULT_BASE_HEALTH,
  };
}

function buildUnits(seat: SeatSpec): UnitState[] {
  const size = seatBaseSize(seat);
  // Line the starting units up in a row just below the seat's base.
  return seat.startingUnits.map((role, i) => ({
    id: `unit-${seat.id}-${i + 1}`,
    name: `${seat.name} ${role}`,
    config: UNIT_CONFIGS[role],
    faction: seat.faction,
    ownerId: seat.id,
    position: { x: seat.basePosition.x + i, y: seat.basePosition.y + size.y },
  }));
}

function buildPlayer(seat: SeatSpec): PlayerRecord {
  return {
    id: seat.id,
    name: seat.name,
    faction: seat.faction,
    controller: seat.controller,
    agentId: seat.agentId,
    directive: seat.directive,
    resources: emptyResources(),
  };
}

// A couple of Resource 1 deposits near the player's base. Their tiles (and a
// one-tile ring) are cleared to ground in generateTerrain so a Collector can
// always path onto and stand beside them.
const RESOURCE_NODES: ResourceNodeState[] = [
  { id: 'node-r1-a', name: 'Resource Node A', resource: ResourceKind.Resource1, position: { x: 15, y: 8 }, amount: 500 },
  { id: 'node-r1-b', name: 'Resource Node B', resource: ResourceKind.Resource1, position: { x: 16, y: 14 }, amount: 500 },
];

// Small deterministic PRNG (mulberry32) so the generated map is identical on
// every load rather than reshuffling on each refresh.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a columns x rows grid that is mostly Ground with scattered forest
// clumps, water lakes and ridge lines stamped in by a seeded RNG. Large and
// varied, but stable across reloads.
function generateTerrain(columns: number, rows: number, seed = 20260701): TerrainKind[][] {
  const rand = mulberry32(seed);
  const terrain: TerrainKind[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => TerrainKind.Ground),
  );

  const inBounds = (x: number, y: number) => x >= 0 && x < columns && y >= 0 && y < rows;
  const stamp = (cx: number, cy: number, radius: number, kind: TerrainKind) => {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        // Rough circular falloff with a little jitter for organic edges.
        if (inBounds(x, y) && Math.hypot(x - cx, y - cy) <= radius - rand() * 1.2) {
          terrain[y][x] = kind;
        }
      }
    }
  };

  const blobCount = Math.round((columns * rows) / 45);
  for (let i = 0; i < blobCount; i++) {
    const roll = rand();
    const kind = roll < 0.5 ? TerrainKind.Forest : roll < 0.8 ? TerrainKind.Water : TerrainKind.Ridge;
    stamp(Math.floor(rand() * columns), Math.floor(rand() * rows), 1 + Math.floor(rand() * 3), kind);
  }

  // Carve a clear ground staging area around every seat's base (and the units
  // spawned just below it) so nobody starts on a lake or ridge.
  for (const seat of SEATS) {
    const size = seatBaseSize(seat);
    const { x: bx, y: by } = seat.basePosition;
    for (let y = by - 2; y < by + size.y + 2; y++) {
      for (let x = bx - 2; x < bx + size.x + 2; x++) {
        if (inBounds(x, y)) terrain[y][x] = TerrainKind.Ground;
      }
    }
  }

  // Clear each resource node's tile plus a one-tile ring so a Collector can
  // always reach it — nodes must never sit on water or be walled in by ridge.
  for (const node of RESOURCE_NODES) {
    for (let y = node.position.y - 1; y <= node.position.y + 1; y++) {
      for (let x = node.position.x - 1; x <= node.position.x + 1; x++) {
        if (inBounds(x, y)) terrain[y][x] = TerrainKind.Ground;
      }
    }
  }

  return terrain;
}

// The starting match, generated entirely from SEATS: one base, its starting
// units and a player record per seat. Change the roster by editing SEATS above.
export const prototypeWorld: WorldState = {
  map: {
    columns: MAP_COLUMNS,
    rows: MAP_ROWS,
    tileSize: MAP_TILE_SIZE,
    terrain: generateTerrain(MAP_COLUMNS, MAP_ROWS),
  },
  bases: SEATS.map(buildBase),
  units: SEATS.flatMap(buildUnits),
  resourceNodes: RESOURCE_NODES.map((node) => ({ ...node })),
  players: SEATS.map(buildPlayer),
};
