import Phaser from 'phaser';
import { BaseState, Faction, GameMap, GridPoint, TerrainKind, UnitRole, UnitState, WorldState, prototypeWorld } from './world';
import { AttackTarget, GameContext, GameInterface, GameToolset } from './actions';
import { GameState } from './state';

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

// Camera panning. The map is larger than the viewport, so the player scrolls
// the camera to see the rest of it (keyboard, screen-edge push, or mouse drag).
const PAN_KEY_SPEED = 900; // pixels/sec for keyboard + edge-scroll panning
const EDGE_SCROLL_MARGIN = 28; // px band at each screen edge that triggers a pan

export class GameScene extends Phaser.Scene implements GameContext {
  // The single source of truth for game state. The scene reads/writes through
  // it and it is the object that serializes into LLM context.
  private readonly gameState: GameState;
  private readonly unitViews = new Map<string, UnitView>();
  // Per-unit attack cooldown (ms remaining until the next hit). Purely a sim
  // cadence detail, so it lives here rather than in the shared GameState.
  private readonly attackTimers = new Map<string, number>();
  private readonly baseViews = new Map<string, BaseView>();
  private tileSize = 0;
  private originX = 0;
  private originY = 0;
  private selectedUnitId?: string;
  private selectedUnitBody?: Phaser.GameObjects.Arc;
  private selectedUnitMarker?: Phaser.GameObjects.Arc;
  private statsPanelText?: Phaser.GameObjects.Text;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private isDragPanning = false;
  private dragLastX = 0;
  private dragLastY = 0;
  // Edge-scroll only once the pointer is genuinely over the canvas, so the
  // camera doesn't drift on load (pointer defaults to 0,0) or while the mouse
  // is outside the window.
  private pointerInWindow = false;

  // The single interface every action flows through. Human input (below) and
  // LLM tool calls both invoke actions here.
  private readonly gameInterface = new GameInterface(this);
  // LLM tool wrapper around the interface. Not wired to a model yet — this is
  // the handle future LLM code uses to get tool specs and dispatch tool calls.
  readonly commandTools = new GameToolset(this.gameInterface);

  constructor(world: WorldState = prototypeWorld) {
    super('GameScene');
    this.gameState = new GameState(world);
  }

  /** The shared game state, for other parts of the app (HUD, LLM context, …). */
  getState(): GameState {
    return this.gameState;
  }

  // --- GameContext: the bridge the action layer calls into ------------------

  getUnit(unitId: string): UnitState | undefined {
    return this.gameState.getUnit(unitId);
  }

  getAttackTarget(targetId: string): AttackTarget | undefined {
    // Only bases are attackable in the current sim; units become targets once
    // the update loop supports unit-vs-unit combat.
    const base = this.gameState.getBase(targetId);
    return base ? { id: base.id, name: base.name, kind: 'base' } : undefined;
  }

  issueAttackOrder(unitId: string, targetId: string): void {
    this.gameState.orderAttack(unitId, targetId);
    // Reset the cooldown so an in-range unit lands its first hit immediately.
    this.attackTimers.set(unitId, 0);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#080d15');
    this.input.mouse?.disableContextMenu();
    this.setupPanControls();
    this.layout();

    // Start looking at the player's own base rather than the map's top-left corner.
    const base = this.gameState.getBases().find((candidate) => candidate.faction === Faction.Player);
    if (base) {
      this.cameras.main.centerOn(
        (base.position.x + base.size.x / 2) * this.tileSize,
        (base.position.y + base.size.y / 2) * this.tileSize,
      );
    }

    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  // Wire up the three ways to pan the camera: arrow/WASD keys and screen-edge
  // push (polled in update), plus click-and-drag with the middle mouse button.
  private setupPanControls(): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.createCursorKeys();
      this.wasd = keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
      }) as GameScene['wasd'];
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.middleButtonDown()) return;
      this.isDragPanning = true;
      this.dragLastX = pointer.x;
      this.dragLastY = pointer.y;
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragPanning) return;
      const cam = this.cameras.main;
      cam.scrollX -= pointer.x - this.dragLastX;
      cam.scrollY -= pointer.y - this.dragLastY;
      this.dragLastX = pointer.x;
      this.dragLastY = pointer.y;
    });
    const stopDrag = () => {
      this.isDragPanning = false;
    };
    this.input.on('pointerup', stopDrag);
    this.input.on('pointerupoutside', stopDrag);

    this.input.on(Phaser.Input.Events.POINTER_MOVE, () => {
      this.pointerInWindow = true;
    });
    this.input.on(Phaser.Input.Events.GAME_OVER, () => {
      this.pointerInWindow = true;
    });
    this.input.on(Phaser.Input.Events.GAME_OUT, () => {
      this.pointerInWindow = false;
      this.isDragPanning = false;
    });
  }

  // Rebuild the whole scene sized to the current viewport. Called on create and
  // on every window resize so the map always fills the window. Game state
  // (positions, orders, health) lives in GameState and survives across
  // rebuilds; only visuals are recreated.
  private layout(): void {
    this.children.removeAll(true);
    this.unitViews.clear();
    this.baseViews.clear();
    this.selectedUnitBody = undefined;
    this.selectedUnitMarker = undefined;
    this.statsPanelText = undefined;

    const map = this.gameState.getMap();
    this.computeMetrics(map);
    this.cameras.main.setBounds(0, 0, map.columns * this.tileSize, map.rows * this.tileSize);
    this.drawMap(map);
    this.gameState.getBases().forEach((base) => this.drawBase(base));
    this.gameState.getUnits().forEach((unit) => this.drawUnit(unit));
    this.drawHud();
    this.drawStatsPanel();

    if (this.selectedUnitId) {
      const unit = this.gameState.getUnit(this.selectedUnitId);
      if (unit) this.selectUnit(unit);
      else this.selectedUnitId = undefined;
    }
  }

  // Draw the map at a fixed tile size anchored at the world origin. The map is
  // intentionally larger than the viewport; the camera (see setupPanControls)
  // scrolls over it rather than everything being scaled to fit.
  private computeMetrics(map: GameMap): void {
    this.tileSize = map.tileSize;
    this.originX = 0;
    this.originY = 0;
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
    const pos = this.gameState.getUnitPosition(unit.id);
    if (!pos) return;

    const px = this.originX + pos.x * this.tileSize;
    const py = this.originY + pos.y * this.tileSize;
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
    this.add
      .text(
        HUD_MARGIN,
        height - 52,
        'Click a unit to select it, then right-click a base to march in and attack.',
        this.getLabelStyle('#aeb8cc', '14px'),
      )
      .setScrollFactor(0);
    this.add
      .text(
        HUD_MARGIN,
        height - 30,
        'Pan the map: WASD / arrow keys, push the mouse to a screen edge, or drag with the middle mouse button.',
        this.getLabelStyle('#8592ab', '13px'),
      )
      .setScrollFactor(0);
  }

  private drawStatsPanel(): void {
    const x = this.scale.gameSize.width - STATS_PANEL_WIDTH - HUD_MARGIN;
    const y = HUD_MARGIN;

    this.add
      .rectangle(x, y, STATS_PANEL_WIDTH, STATS_PANEL_HEIGHT, 0x0f172a, 0.9)
      .setOrigin(0)
      .setStrokeStyle(1, 0x6b7a99, 0.6)
      .setScrollFactor(0);
    this.add.text(x + 16, y + 14, 'Selected Unit', this.getLabelStyle('#f6f7fb', '18px')).setScrollFactor(0);
    this.statsPanelText = this.add
      .text(x + 16, y + 48, this.selectedUnitId ? '' : 'None selected', {
        color: '#aeb8cc',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '14px',
        lineSpacing: 8,
      })
      .setScrollFactor(0);
  }

  private selectUnit(unit: UnitState): void {
    const view = this.unitViews.get(unit.id);
    const pos = this.gameState.getUnitPosition(unit.id);
    if (!view || !pos) return;

    this.selectedUnitBody?.setStrokeStyle(3, 0x0a1020, 0.8);
    this.selectedUnitId = unit.id;
    this.selectedUnitBody = view.body;

    const px = this.originX + pos.x * this.tileSize;
    const py = this.originY + pos.y * this.tileSize;

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
    this.updatePan(delta);

    this.gameState.getUnits().forEach((unit) => {
      const order = this.gameState.getUnitOrder(unit.id);
      if (order.kind !== 'attack') return;

      const base = this.gameState.getBase(order.targetId);
      const pos = this.gameState.getUnitPosition(unit.id);
      if (!base || !pos) return;

      if (base.health <= 0) {
        this.gameState.clearOrder(unit.id);
        return;
      }

      const left = base.position.x;
      const top = base.position.y;
      const right = base.position.x + base.size.x;
      const bottom = base.position.y + base.size.y;

      // Nearest point on the base's footprint, in grid units.
      const nearestX = Phaser.Math.Clamp(pos.x, left, right);
      const nearestY = Phaser.Math.Clamp(pos.y, top, bottom);
      const dx = nearestX - pos.x;
      const dy = nearestY - pos.y;
      const distance = Math.hypot(dx, dy);
      const range = unit.config.stats.range;

      if (distance > range) {
        const step = unit.config.stats.speed * SPEED_TILES_PER_SEC * (delta / 1000);
        const travel = Math.min(step, distance - range);
        this.gameState.setUnitPosition(unit.id, pos.x + (dx / distance) * travel, pos.y + (dy / distance) * travel);
        this.updateUnitPosition(unit.id);
      } else {
        this.attackBase(unit, base, delta);
      }
    });
  }

  // Poll keyboard and screen-edge input each frame and scroll the camera.
  // (Middle-mouse drag panning is event-driven in setupPanControls.)
  private updatePan(delta: number): void {
    let dx = 0;
    let dy = 0;

    if (this.cursors?.left.isDown || this.wasd?.left.isDown) dx -= 1;
    if (this.cursors?.right.isDown || this.wasd?.right.isDown) dx += 1;
    if (this.cursors?.up.isDown || this.wasd?.up.isDown) dy -= 1;
    if (this.cursors?.down.isDown || this.wasd?.down.isDown) dy += 1;

    // Edge scrolling: pushing the pointer into a screen-edge band pans that way.
    const pointer = this.input.activePointer;
    if (this.pointerInWindow && !this.isDragPanning) {
      const { width, height } = this.scale.gameSize;
      if (pointer.x <= EDGE_SCROLL_MARGIN) dx -= 1;
      else if (pointer.x >= width - EDGE_SCROLL_MARGIN) dx += 1;
      if (pointer.y <= EDGE_SCROLL_MARGIN) dy -= 1;
      else if (pointer.y >= height - EDGE_SCROLL_MARGIN) dy += 1;
    }

    if (dx === 0 && dy === 0) return;

    const distance = (PAN_KEY_SPEED * delta) / 1000;
    const length = Math.hypot(dx, dy);
    const cam = this.cameras.main;
    cam.scrollX += (dx / length) * distance;
    cam.scrollY += (dy / length) * distance;
  }

  private updateUnitPosition(unitId: string): void {
    const view = this.unitViews.get(unitId);
    const pos = this.gameState.getUnitPosition(unitId);
    if (!view || !pos) return;

    const px = this.originX + pos.x * this.tileSize;
    const py = this.originY + pos.y * this.tileSize;

    view.body.setPosition(px, py);
    view.initial.setPosition(px, py - 7);
    view.roleLabel.setPosition(px, py + view.radius + 8);
    if (this.selectedUnitId === unitId) {
      this.selectedUnitMarker?.setPosition(px, py);
    }
  }

  private attackBase(unit: UnitState, base: BaseState, delta: number): void {
    let timer = (this.attackTimers.get(unit.id) ?? 0) - delta;
    if (timer > 0) {
      this.attackTimers.set(unit.id, timer);
      return;
    }
    timer = ATTACK_INTERVAL_MS;
    this.attackTimers.set(unit.id, timer);

    const health = this.gameState.damageBase(base.id, unit.config.stats.power);
    this.baseViews.get(base.id)?.hpText.setText(`HP ${health}`);

    if (health <= 0) this.gameState.clearOrder(unit.id);
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
