import Phaser from 'phaser';
import { BaseState, Faction, GameMap, GridPoint, TerrainKind, UnitRole, UnitState, WorldState, prototypeWorld } from './world';

interface BaseColors {
  fill: number;
  stroke: number;
  inner: number;
}

const BASE_COLORS: Record<Faction, BaseColors> = {
  [Faction.Player]: { fill: 0x3f6fb5, stroke: 0xb8d6ff, inner: 0x20395f },
  [Faction.Enemy]: { fill: 0xb5443f, stroke: 0xffbdb8, inner: 0x5f2320 },
};

const TERRAIN_COLORS: Record<TerrainKind, number> = {
  [TerrainKind.Ground]: 0x253047,
  [TerrainKind.Forest]: 0x244635,
  [TerrainKind.Ridge]: 0x554a3d,
  [TerrainKind.Water]: 0x1c4966,
};

const UNIT_COLORS: Record<UnitRole, number> = {
  [UnitRole.Builder]: 0xe9c46a,
  [UnitRole.Scout]: 0x8ecae6,
  [UnitRole.Soldier]: 0xf4a261,
};

const MAP_PADDING = 24;

export class GameScene extends Phaser.Scene {
  private readonly world: WorldState;
  private selectedUnit?: UnitState;
  private selectedUnitBody?: Phaser.GameObjects.Arc;
  private selectedUnitMarker?: Phaser.GameObjects.Arc;
  private statsPanelText?: Phaser.GameObjects.Text;

  constructor(world: WorldState = prototypeWorld) {
    super('GameScene');
    this.world = world;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#080d15');
    this.drawMap(this.world.map);
    this.drawBase(this.world.map, this.world.base);
    this.drawBase(this.world.map, this.world.enemyBase);
    this.world.units.forEach((unit) => this.drawUnit(this.world.map, unit));
    this.drawHud();
    this.drawStatsPanel();
  }

  private drawMap(map: GameMap): void {
    map.terrain.forEach((row, y) => {
      row.forEach((terrain, x) => {
        const position = this.tileToWorld(map, { x, y });

        this.add
          .rectangle(position.x, position.y, map.tileSize, map.tileSize, TERRAIN_COLORS[terrain])
          .setOrigin(0)
          .setStrokeStyle(1, 0x536079, 0.45);
      });
    });
  }

  private drawBase(map: GameMap, base: BaseState): void {
    const position = this.tileToWorld(map, base.position);
    const width = base.size.x * map.tileSize;
    const height = base.size.y * map.tileSize;
    const colors = BASE_COLORS[base.faction];

    this.add
      .rectangle(position.x, position.y, width, height, colors.fill, 0.92)
      .setOrigin(0)
      .setStrokeStyle(3, colors.stroke, 0.86);

    this.add.rectangle(position.x + width / 2, position.y + height / 2, width - 34, height - 34, colors.inner, 0.78);
    this.add.text(position.x + 16, position.y + 14, base.name, this.getLabelStyle('#f6f7fb', '18px'));
    this.add.text(position.x + 16, position.y + 42, `HP ${base.health}`, this.getLabelStyle('#c8d8f3', '13px'));
  }

  private drawUnit(map: GameMap, unit: UnitState): void {
    const center = this.tileCenterToWorld(map, unit.position);
    const radius = map.tileSize * 0.28;
    const role = unit.config.role;

    const body = this.add
      .circle(center.x, center.y, radius, UNIT_COLORS[role])
      .setStrokeStyle(3, 0x0a1020, 0.8)
      .setInteractive({ useHandCursor: true });

    body.on('pointerdown', () => this.selectUnit(unit, center, radius, body));
    body.on('pointerover', () => body.setStrokeStyle(3, 0xf6f7fb, 0.9));
    body.on('pointerout', () => {
      if (this.selectedUnit?.id !== unit.id) body.setStrokeStyle(3, 0x0a1020, 0.8);
    });

    this.add.text(center.x, center.y - 7, this.getUnitInitial(unit), this.getLabelStyle('#08111f', '16px')).setOrigin(0.5);
    this.add.text(center.x, center.y + radius + 8, role, this.getLabelStyle('#dbe7ff', '12px')).setOrigin(0.5, 0);
  }

  private drawHud(): void {
    this.add.text(24, 516, 'Click a unit to inspect prototype combat stats.', this.getLabelStyle('#aeb8cc', '14px'));
  }

  private drawStatsPanel(): void {
    const x = 690;
    const y = 372;
    const width = 246;
    const height = 144;

    this.add.rectangle(x, y, width, height, 0x0f172a, 0.9).setOrigin(0).setStrokeStyle(1, 0x6b7a99, 0.6);
    this.add.text(x + 16, y + 14, 'Selected Unit', this.getLabelStyle('#f6f7fb', '18px'));
    this.statsPanelText = this.add.text(x + 16, y + 48, 'None selected', {
      color: '#aeb8cc',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '14px',
      lineSpacing: 8,
    });
  }

  private selectUnit(unit: UnitState, center: GridPoint, radius: number, body: Phaser.GameObjects.Arc): void {
    this.selectedUnitBody?.setStrokeStyle(3, 0x0a1020, 0.8);
    this.selectedUnit = unit;
    this.selectedUnitBody = body;
    this.selectedUnitMarker?.destroy();
    this.selectedUnitMarker = this.add.circle(center.x, center.y, radius + 8, 0xffffff, 0).setStrokeStyle(3, 0xf6f7fb, 0.95);
    body.setStrokeStyle(3, 0xf6f7fb, 0.95);

    const { stats } = unit.config;

    this.statsPanelText?.setText([
      `${unit.name} - ${unit.config.role}`,
      `Speed: ${stats.speed}`,
      `HP: ${stats.hp}`,
      `Power: ${stats.power}`,
    ]);
  }

  private tileToWorld(map: GameMap, point: GridPoint): GridPoint {
    return {
      x: MAP_PADDING + point.x * map.tileSize,
      y: MAP_PADDING + point.y * map.tileSize,
    };
  }

  private tileCenterToWorld(map: GameMap, point: GridPoint): GridPoint {
    const position = this.tileToWorld(map, point);

    return {
      x: position.x + map.tileSize / 2,
      y: position.y + map.tileSize / 2,
    };
  }

  private getLabelStyle(color: string, fontSize: string): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      color,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize,
      fontStyle: '700',
    };
  }

  private getUnitInitial(unit: UnitState): string {
    return unit.config.role.slice(0, 1);
  }
}
