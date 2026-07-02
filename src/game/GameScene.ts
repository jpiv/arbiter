import Phaser from 'phaser';
import { BaseState, Faction, GameMap, GridPoint, TerrainKind, UnitRole, UnitState, WorldState, prototypeWorld } from './world';
import { AttackTarget, GameContext, GameInterface, GameToolset } from './actions';

interface BaseColors {
  fill: number;
  stroke: number;
  inner: number;
}

// Visual objects for a unit. Rebuilt from scratch on every layout/resize.
interface UnitView {
  body: Phaser.GameObjects.Arc;
  initial: Phaser.GameObjects.Text;
  roleLabel: Phaser.GameObjects.Text;
  radius: number;
}

// Movement/combat state for a unit. Lives in grid-space so it is independent of
// tile size, and persists across layout rebuilds (unlike the visuals above).
interface UnitRuntime {
  cx: number; // fractional grid coordinate of the unit's center (x)
  cy: number; // fractional grid coordinate of the unit's center (y)
  targetBase?: BaseState;
  attackTimer: number;
}

interface BaseView {
  base: BaseState;
  hpText: Phaser.GameObjects.Text;
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

const STATS_PANEL_WIDTH = 246;
const STATS_PANEL_HEIGHT = 144;
const HUD_MARGIN = 24;

// A unit's `speed` stat is interpreted as this many tiles travelled per second.
const SPEED_TILES_PER_SEC = 0.5;
// How often an in-range unit lands a hit on a base (milliseconds).
const ATTACK_INTERVAL_MS = 700;

export class GameScene extends Phaser.Scene implements GameContext {
  private readonly world: WorldState;
  private readonly unitViews = new Map<string, UnitView>();
  private readonly unitRuntime = new Map<string, UnitRuntime>();
  private readonly baseViews = new Map<string, BaseView>();
  private tileSize = 0;
  private originX = 0;
  private originY = 0;
  private selectedUnitId?: string;
  private selectedUnitBody?: Phaser.GameObjects.Arc;
  private selectedUnitMarker?: Phaser.GameObjects.Arc;
  private statsPanelText?: Phaser.GameObjects.Text;

  // The single interface every action flows through. Human input (below) and
  // LLM tool calls both invoke actions here.
  private readonly gameInterface = new GameInterface(this);
  // LLM tool wrapper around the interface. Not wired to a model yet — this is
  // the handle future LLM code uses to get tool specs and dispatch tool calls.
  readonly commandTools = new GameToolset(this.gameInterface);

  constructor(world: WorldState = prototypeWorld) {
    super('GameScene');
    this.world = world;
  }

  // --- GameContext: the bridge the action layer calls into ------------------

  getUnit(unitId: string): UnitState | undefined {
    return this.world.units.find((unit) => unit.id === unitId);
  }

  getAttackTarget(targetId: string): AttackTarget | undefined {
    // Only bases are attackable in the current sim; units become targets once
    // the update loop supports unit-vs-unit combat.
    const base = this.findBase(targetId);
    return base ? { id: base.id, name: base.name, kind: 'base' } : undefined;
  }

  issueAttackOrder(unitId: string, targetId: string): void {
    const runtime = this.unitRuntime.get(unitId);
    const base = this.findBase(targetId);
    if (!runtime || !base) return;

    runtime.targetBase = base;
    runtime.attackTimer = 0;
  }

  private findBase(baseId: string): BaseState | undefined {
    return [this.world.base, this.world.enemyBase].find((base) => base.id === baseId);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#080d15');
    this.input.mouse?.disableContextMenu();
    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  // Rebuild the whole scene sized to the current viewport. Called on create and
  // on every window resize so the map always fills the window. Unit movement and
  // combat state (unitRuntime) survives across rebuilds; only visuals are recreated.
  private layout(): void {
    this.children.removeAll(true);
    this.unitViews.clear();
    this.baseViews.clear();
    this.selectedUnitBody = undefined;
    this.selectedUnitMarker = undefined;
    this.statsPanelText = undefined;

    this.computeMetrics(this.world.map);
    this.drawMap(this.world.map);
    this.drawBase(this.world.base);
    this.drawBase(this.world.enemyBase);
    this.world.units.forEach((unit) => this.drawUnit(unit));
    this.drawHud();
    this.drawStatsPanel();

    if (this.selectedUnitId) {
      const unit = this.world.units.find((candidate) => candidate.id === this.selectedUnitId);
      if (unit) this.selectUnit(unit);
      else this.selectedUnitId = undefined;
    }
  }

  // Fit the fixed-aspect grid into the viewport with square tiles, centered.
  private computeMetrics(map: GameMap): void {
    const { width, height } = this.scale.gameSize;
    this.tileSize = Math.min(width / map.columns, height / map.rows);
    this.originX = (width - this.tileSize * map.columns) / 2;
    this.originY = (height - this.tileSize * map.rows) / 2;
  }

  private drawMap(map: GameMap): void {
    map.terrain.forEach((row, y) => {
      row.forEach((terrain, x) => {
        const position = this.tileToWorld({ x, y });

        this.add
          .rectangle(position.x, position.y, this.tileSize, this.tileSize, TERRAIN_COLORS[terrain])
          .setOrigin(0)
          .setStrokeStyle(1, 0x536079, 0.45);
      });
    });
  }

  private drawBase(base: BaseState): void {
    const position = this.tileToWorld(base.position);
    const width = base.size.x * this.tileSize;
    const height = base.size.y * this.tileSize;
    const colors = BASE_COLORS[base.faction];
    const inset = this.tileSize * 0.6;

    const rect = this.add
      .rectangle(position.x, position.y, width, height, colors.fill, 0.92)
      .setOrigin(0)
      .setStrokeStyle(3, colors.stroke, 0.86)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);

    this.add.rectangle(position.x + width / 2, position.y + height / 2, width - inset, height - inset, colors.inner, 0.78);
    this.add.text(position.x + 16, position.y + 14, base.name, this.getLabelStyle('#f6f7fb', '18px'));
    const hpText = this.add.text(position.x + 16, position.y + 42, `HP ${base.health}`, this.getLabelStyle('#c8d8f3', '13px'));

    this.baseViews.set(base.id, { base, hpText });

    rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.orderAttack(base);
    });
  }

  private drawUnit(unit: UnitState): void {
    let runtime = this.unitRuntime.get(unit.id);
    if (!runtime) {
      runtime = { cx: unit.position.x + 0.5, cy: unit.position.y + 0.5, attackTimer: 0 };
      this.unitRuntime.set(unit.id, runtime);
    }

    const px = this.originX + runtime.cx * this.tileSize;
    const py = this.originY + runtime.cy * this.tileSize;
    const radius = this.tileSize * 0.28;
    const role = unit.config.role;

    const body = this.add
      .circle(px, py, radius, UNIT_COLORS[role])
      .setStrokeStyle(3, 0x0a1020, 0.8)
      .setInteractive({ useHandCursor: true });

    const initial = this.add
      .text(px, py - 7, this.getUnitInitial(unit), this.getLabelStyle('#08111f', '16px'))
      .setOrigin(0.5);
    const roleLabel = this.add
      .text(px, py + radius + 8, role, this.getLabelStyle('#dbe7ff', '12px'))
      .setOrigin(0.5, 0);

    this.unitViews.set(unit.id, { body, initial, roleLabel, radius });

    body.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      this.selectUnit(unit);
    });
    body.on('pointerover', () => body.setStrokeStyle(3, 0xf6f7fb, 0.9));
    body.on('pointerout', () => {
      if (this.selectedUnitId !== unit.id) body.setStrokeStyle(3, 0x0a1020, 0.8);
    });
  }

  private drawHud(): void {
    const { height } = this.scale.gameSize;
    this.add.text(
      HUD_MARGIN,
      height - 30,
      'Click a unit to select it, then right-click a base to march in and attack.',
      this.getLabelStyle('#aeb8cc', '14px'),
    );
  }

  private drawStatsPanel(): void {
    const x = this.scale.gameSize.width - STATS_PANEL_WIDTH - HUD_MARGIN;
    const y = HUD_MARGIN;

    this.add.rectangle(x, y, STATS_PANEL_WIDTH, STATS_PANEL_HEIGHT, 0x0f172a, 0.9).setOrigin(0).setStrokeStyle(1, 0x6b7a99, 0.6);
    this.add.text(x + 16, y + 14, 'Selected Unit', this.getLabelStyle('#f6f7fb', '18px'));
    this.statsPanelText = this.add.text(x + 16, y + 48, this.selectedUnitId ? '' : 'None selected', {
      color: '#aeb8cc',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '14px',
      lineSpacing: 8,
    });
  }

  private selectUnit(unit: UnitState): void {
    const view = this.unitViews.get(unit.id);
    const runtime = this.unitRuntime.get(unit.id);
    if (!view || !runtime) return;

    this.selectedUnitBody?.setStrokeStyle(3, 0x0a1020, 0.8);
    this.selectedUnitId = unit.id;
    this.selectedUnitBody = view.body;

    const px = this.originX + runtime.cx * this.tileSize;
    const py = this.originY + runtime.cy * this.tileSize;

    this.selectedUnitMarker?.destroy();
    this.selectedUnitMarker = this.add.circle(px, py, view.radius + 8, 0xffffff, 0).setStrokeStyle(3, 0xf6f7fb, 0.95);
    view.body.setStrokeStyle(3, 0xf6f7fb, 0.95);

    const { stats } = unit.config;

    this.statsPanelText?.setText([
      `${unit.name} - ${unit.config.role}`,
      `Speed: ${stats.speed}`,
      `Range: ${stats.range}`,
      `HP: ${stats.hp}`,
      `Power: ${stats.power}`,
    ]);
  }

  // Order the currently selected unit to march toward `base` and attack it.
  // Routed through the game interface so mouse input takes the exact same path
  // an LLM tool call will.
  private orderAttack(base: BaseState): void {
    if (!this.selectedUnitId) return;
    this.gameInterface.invoke('attack', { unitId: this.selectedUnitId, targetId: base.id });
  }

  update(_time: number, delta: number): void {
    this.world.units.forEach((unit) => {
      const runtime = this.unitRuntime.get(unit.id);
      if (!runtime || !runtime.targetBase) return;

      const base = runtime.targetBase;
      const left = base.position.x;
      const top = base.position.y;
      const right = base.position.x + base.size.x;
      const bottom = base.position.y + base.size.y;

      // Nearest point on the base's footprint, in grid units.
      const nearestX = Phaser.Math.Clamp(runtime.cx, left, right);
      const nearestY = Phaser.Math.Clamp(runtime.cy, top, bottom);
      const dx = nearestX - runtime.cx;
      const dy = nearestY - runtime.cy;
      const distance = Math.hypot(dx, dy);
      const range = unit.config.stats.range;

      if (distance > range) {
        const step = unit.config.stats.speed * SPEED_TILES_PER_SEC * (delta / 1000);
        const travel = Math.min(step, distance - range);
        runtime.cx += (dx / distance) * travel;
        runtime.cy += (dy / distance) * travel;
        this.updateUnitPosition(unit.id);
      } else {
        this.attackBase(unit, runtime, delta);
      }
    });
  }

  private updateUnitPosition(unitId: string): void {
    const view = this.unitViews.get(unitId);
    const runtime = this.unitRuntime.get(unitId);
    if (!view || !runtime) return;

    const px = this.originX + runtime.cx * this.tileSize;
    const py = this.originY + runtime.cy * this.tileSize;

    view.body.setPosition(px, py);
    view.initial.setPosition(px, py - 7);
    view.roleLabel.setPosition(px, py + view.radius + 8);
    if (this.selectedUnitId === unitId) {
      this.selectedUnitMarker?.setPosition(px, py);
    }
  }

  private attackBase(unit: UnitState, runtime: UnitRuntime, delta: number): void {
    const base = runtime.targetBase;
    if (!base) return;

    if (base.health <= 0) {
      runtime.targetBase = undefined;
      return;
    }

    runtime.attackTimer -= delta;
    if (runtime.attackTimer > 0) return;
    runtime.attackTimer = ATTACK_INTERVAL_MS;

    base.health = Math.max(0, base.health - unit.config.stats.power);
    this.baseViews.get(base.id)?.hpText.setText(`HP ${base.health}`);

    if (base.health <= 0) runtime.targetBase = undefined;
  }

  private tileToWorld(point: GridPoint): GridPoint {
    return {
      x: this.originX + point.x * this.tileSize,
      y: this.originY + point.y * this.tileSize,
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
