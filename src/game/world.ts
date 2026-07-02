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
  Builder = 'Builder',
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
      range: 2,
      hp: 120,
      power: 22,
    },
  },
};

export const prototypeWorld: WorldState = {
  map: {
    columns: 16,
    rows: 9,
    tileSize: 54,
    terrain: [
      [TerrainKind.Forest, TerrainKind.Forest, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ridge, TerrainKind.Ridge, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Forest, TerrainKind.Forest, TerrainKind.Forest, TerrainKind.Ground],
      [TerrainKind.Forest, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ridge, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Forest, TerrainKind.Ground, TerrainKind.Ground],
      [TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Water, TerrainKind.Water, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground],
      [TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Water, TerrainKind.Water, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground],
      [TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Forest, TerrainKind.Forest, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground],
      [TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Forest, TerrainKind.Forest, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ridge, TerrainKind.Ridge, TerrainKind.Ground],
      [TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ridge, TerrainKind.Ground, TerrainKind.Ground],
      [TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Forest, TerrainKind.Forest, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground],
      [TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Forest, TerrainKind.Forest, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground, TerrainKind.Ground],
    ],
  },
  base: {
    id: 'base-alpha',
    name: 'Base Alpha',
    faction: Faction.Player,
    position: { x: 1, y: 3 },
    size: { x: 3, y: 3 },
    health: 100,
  },
  enemyBase: {
    id: 'base-omega',
    name: 'Base Omega',
    faction: Faction.Enemy,
    position: { x: 12, y: 3 },
    size: { x: 3, y: 3 },
    health: 100,
  },
  units: [
    {
      id: 'unit-scout-1',
      name: 'Scout 1',
      config: UNIT_CONFIGS[UnitRole.Scout],
      faction: Faction.Player,
      position: { x: 5, y: 3 },
    },
    {
      id: 'unit-soldier-1',
      name: 'Soldier 1',
      config: UNIT_CONFIGS[UnitRole.Soldier],
      faction: Faction.Player,
      position: { x: 5, y: 4 },
    },
    {
      id: 'unit-builder-1',
      name: 'Builder 1',
      config: UNIT_CONFIGS[UnitRole.Builder],
      faction: Faction.Player,
      position: { x: 4, y: 5 },
    },
  ],
};
