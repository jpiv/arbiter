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

// A unit's `speed` stat is interpreted as this many tiles travelled per second.
const SPEED_TILES_PER_SEC = 0.5;
// How often an in-range unit lands a hit on a base (milliseconds).
const ATTACK_INTERVAL_MS = 700;

interface UnitView {
  unit: UnitState;
  body: Phaser.GameObjects.Arc;
  initial: Phaser.GameObjects.Text;
  roleLabel: Phaser.GameObjects.Text;
  radius: number;
  x: number;
  y: number;
  targetBase?: BaseState;
  attackTimer: number;
}

interface BaseView {
  base: BaseState;
  hpText: Phaser.GameObjects.Text;
  bounds: { left: number; top: number; right: number; bottom: number };
}

export class GameScene extends Phaser.Scene {
  private readonly world: WorldState;
  private readonly unitViews = new Map<string, UnitView>();
  private readonly baseViews = new Map<string, BaseView>();
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
    this.input.mouse?.disableContextMenu();
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

    const rect = this.add
      .rectangle(position.x, position.y, width, height, colors.fill, 0.92)
      .setOrigin(0)
      .setStrokeStyle(3, colors.stroke, 0.86)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);

    this.add.rectangle(position.x + width / 2, position.y + height / 2, width - 34, height - 34, colors.inner, 0.78);
    this.add.text(position.x + 16, position.y + 14, base.name, this.getLabelStyle('#f6f7fb', '18px'));
    const hpText = this.add.text(position.x + 16, position.y + 42, `HP ${base.health}`, this.getLabelStyle('#c8d8f3', '13px'));

    this.baseViews.set(base.id, {
      base,
      hpText,
      bounds: { left: position.x, top: position.y, right: position.x + width, bottom: position.y + height },
    });

    rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.orderAttack(base);
    });
  }

  private drawUnit(map: GameMap, unit: UnitState): void {
    const center = this.tileCenterToWorld(map, unit.position);
    const radius = map.tileSize * 0.28;
    const role = unit.config.role;

    const body = this.add
      .circle(center.x, center.y, radius, UNIT_COLORS[role])
      .setStrokeStyle(3, 0x0a1020, 0.8)
      .setInteractive({ useHandCursor: true });

    const initial = this.add
      .text(center.x, center.y - 7, this.getUnitInitial(unit), this.getLabelStyle('#08111f', '16px'))
      .setOrigin(0.5);
    const roleLabel = this.add
      .text(center.x, center.y + radius + 8, role, this.getLabelStyle('#dbe7ff', '12px'))
      .setOrigin(0.5, 0);

    const view: UnitView = { unit, body, initial, roleLabel, radius, x: center.x, y: center.y, attackTimer: 0 };
    this.unitViews.set(unit.id, view);

    body.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      this.selectUnit(view);
    });
    body.on('pointerover', () => body.setStrokeStyle(3, 0xf6f7fb, 0.9));
    body.on('pointerout', () => {
      if (this.selectedUnit?.id !== unit.id) body.setStrokeStyle(3, 0x0a1020, 0.8);
    });
  }

  private drawHud(): void {
    this.add.text(24, 516, 'Click a unit to select it, then right-click a base to march in and attack.', this.getLabelStyle('#aeb8cc', '14px'));
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

  private selectUnit(view: UnitView): void {
    this.selectedUnitBody?.setStrokeStyle(3, 0x0a1020, 0.8);
    this.selectedUnit = view.unit;
    this.selectedUnitBody = view.body;
    this.selectedUnitMarker?.destroy();
    this.selectedUnitMarker = this.add.circle(view.x, view.y, view.radius + 8, 0xffffff, 0).setStrokeStyle(3, 0xf6f7fb, 0.95);
    view.body.setStrokeStyle(3, 0xf6f7fb, 0.95);

    const { stats } = view.unit.config;

    this.statsPanelText?.setText([
      `${view.unit.name} - ${view.unit.config.role}`,
      `Speed: ${stats.speed}`,
      `Range: ${stats.range}`,
      `HP: ${stats.hp}`,
      `Power: ${stats.power}`,
    ]);
  }

  private orderAttack(base: BaseState): void {
    if (!this.selectedUnit) return;
    const view = this.unitViews.get(this.selectedUnit.id);
    if (!view) return;

    view.targetBase = base;
    view.attackTimer = 0;
  }

  update(_time: number, delta: number): void {
    const tileSize = this.world.map.tileSize;

    this.unitViews.forEach((view) => {
      if (!view.targetBase) return;
      const baseView = this.baseViews.get(view.targetBase.id);
      if (!baseView) return;

      const { left, top, right, bottom } = baseView.bounds;
      const nearestX = Phaser.Math.Clamp(view.x, left, right);
      const nearestY = Phaser.Math.Clamp(view.y, top, bottom);
      const dx = nearestX - view.x;
      const dy = nearestY - view.y;
      const distance = Math.hypot(dx, dy);
      const rangePx = view.unit.config.stats.range * tileSize;

      if (distance > rangePx) {
        const stepPx = view.unit.config.stats.speed * SPEED_TILES_PER_SEC * tileSize * (delta / 1000);
        const travel = Math.min(stepPx, distance - rangePx);
        view.x += (dx / distance) * travel;
        view.y += (dy / distance) * travel;
        this.updateUnitPosition(view);
      } else {
        this.attackBase(view, baseView, delta);
      }
    });
  }

  private updateUnitPosition(view: UnitView): void {
    view.body.setPosition(view.x, view.y);
    view.initial.setPosition(view.x, view.y - 7);
    view.roleLabel.setPosition(view.x, view.y + view.radius + 8);
    if (this.selectedUnit?.id === view.unit.id) {
      this.selectedUnitMarker?.setPosition(view.x, view.y);
    }
  }

  private attackBase(view: UnitView, baseView: BaseView, delta: number): void {
    if (baseView.base.health <= 0) {
      view.targetBase = undefined;
      return;
    }

    view.attackTimer -= delta;
    if (view.attackTimer > 0) return;
    view.attackTimer = ATTACK_INTERVAL_MS;

    baseView.base.health = Math.max(0, baseView.base.health - view.unit.config.stats.power);
    baseView.hpText.setText(`HP ${baseView.base.health}`);

    if (baseView.base.health <= 0) view.targetBase = undefined;
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
