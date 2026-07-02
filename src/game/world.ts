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
}

/** Who drives a player: the human at the keyboard, or an autonomous agent loop. */
export type ControllerKind = 'user' | 'ai';

/**
 * A player in the game. Multiplayer-ready: many of these will exist, all
 * agent-driven in the long run, one per faction seat. Serializable — holds no
 * live objects. Ownership of bases/units stays implicit via {@link faction}.
 * Defined here (not in state/) so world.ts stays dependency-free and avoids a
 * circular import with state/types.ts, which imports from this file.
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
  position: GridPoint;
  size: GridPoint;
  health: number;
}

export interface UnitState {
  id: string;
  name: string;
  config: UnitConfig;
  faction: Faction;
  position: GridPoint;
}

export interface WorldState {
  map: GameMap;
  base: BaseState;
  enemyBase: BaseState;
  units: UnitState[];
  // The players in the match. Today: just the one human seat (see prototypeWorld).
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
};

// A large map so there is more world than fits on screen at once, which is what
// makes the pan controls (see GameScene) meaningful.
const MAP_COLUMNS = 60;
const MAP_ROWS = 24;
const MAP_TILE_SIZE = 54;

const PLAYER_BASE = { position: { x: 18, y: 10 }, size: { x: 3, y: 3 } };
const ENEMY_BASE = { position: { x: 39, y: 10 }, size: { x: 3, y: 3 } };

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

  // Carve a clear ground staging area around each base so nobody spawns on a lake.
  for (const base of [PLAYER_BASE, ENEMY_BASE]) {
    for (let y = base.position.y - 2; y < base.position.y + base.size.y + 2; y++) {
      for (let x = base.position.x - 2; x < base.position.x + base.size.x + 2; x++) {
        if (inBounds(x, y)) terrain[y][x] = TerrainKind.Ground;
      }
    }
  }

  return terrain;
}

export const prototypeWorld: WorldState = {
  map: {
    columns: MAP_COLUMNS,
    rows: MAP_ROWS,
    tileSize: MAP_TILE_SIZE,
    terrain: generateTerrain(MAP_COLUMNS, MAP_ROWS),
  },
  base: {
    id: 'base-alpha',
    name: 'Base Alpha',
    faction: Faction.Player,
    position: PLAYER_BASE.position,
    size: PLAYER_BASE.size,
    health: 100,
  },
  enemyBase: {
    id: 'base-omega',
    name: 'Base Omega',
    faction: Faction.Enemy,
    position: ENEMY_BASE.position,
    size: ENEMY_BASE.size,
    health: 100,
  },
  units: [
    {
      id: 'unit-scout-1',
      name: 'Scout 1',
      config: UNIT_CONFIGS[UnitRole.Scout],
      faction: Faction.Player,
      position: { x: 22, y: 10 },
    },
    {
      id: 'unit-soldier-1',
      name: 'Soldier 1',
      config: UNIT_CONFIGS[UnitRole.Soldier],
      faction: Faction.Player,
      position: { x: 22, y: 11 },
    },
    {
      id: 'unit-ranged-1',
      name: 'Ranged 1',
      config: UNIT_CONFIGS[UnitRole.RangedSoldier],
      faction: Faction.Player,
      position: { x: 21, y: 11 },
    },
    {
      id: 'unit-builder-1',
      name: 'Builder 1',
      config: UNIT_CONFIGS[UnitRole.Builder],
      faction: Faction.Player,
      position: { x: 21, y: 12 },
    },
    // Enemy forces, staged near Base Omega and commanded by the opponent agent.
    {
      id: 'unit-enemy-scout-1',
      name: 'Enemy Scout',
      config: UNIT_CONFIGS[UnitRole.Scout],
      faction: Faction.Enemy,
      position: { x: 37, y: 10 },
    },
    {
      id: 'unit-enemy-soldier-1',
      name: 'Enemy Soldier',
      config: UNIT_CONFIGS[UnitRole.Soldier],
      faction: Faction.Enemy,
      position: { x: 37, y: 11 },
    },
    {
      id: 'unit-enemy-builder-1',
      name: 'Enemy Builder',
      config: UNIT_CONFIGS[UnitRole.Builder],
      faction: Faction.Enemy,
      position: { x: 38, y: 12 },
    },
  ],
  // Two seats: the human (Arbiter Prime), passive until given a directive, and
  // the AI opponent (Adversary Prime), which starts with a standing win plan so
  // the autonomous loop drives it from the first tick.
  players: [
    {
      id: 'player-1',
      name: 'Commander',
      faction: Faction.Player,
      controller: 'user',
      agentId: 'arbiter-prime',
      directive: '',
    },
    {
      id: 'player-2',
      name: 'Adversary',
      faction: Faction.Enemy,
      controller: 'ai',
      agentId: 'adversary-prime',
      directive:
        'Win the game: mass your units and destroy the player base [base-alpha], while keeping ' +
        'your own base [base-omega] alive. Press the attack and do not stall.',
    },
  ],
};
