import Phaser from 'phaser';
import {
  BaseState,
  Faction,
  GameMap,
  GridPoint,
  ResourceKind,
  ResourceNodeState,
  TerrainKind,
  UnitRole,
  UnitState,
  WorldState,
  prototypeWorld,
} from './world';
import { AttackTarget, CollectTarget, GameContext, GameInterface, GameToolset } from './actions';
import { GameOutcome, GameState, PlayerRegistry } from './state';

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

interface NodeView {
  node: ResourceNodeState;
  amountText: Phaser.GameObjects.Text;
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
  [UnitRole.RangedSoldier]: 0xd62828,
  [UnitRole.Collector]: 0x9ae66e,
};

// A unit's fill is its role; its outline is its faction, so the two sides read
// apart at a glance (blue = player, red = enemy). Matches the base stroke hues.
const UNIT_STROKE: Record<Faction, number> = {
  [Faction.Player]: 0xb8d6ff,
  [Faction.Enemy]: 0xff9a93,
};

// Resource nodes on the map: an emerald tile with a light stroke, distinct from
// bases (blue/red) and terrain.
const RESOURCE_NODE_FILL = 0x2fbf71;
const RESOURCE_NODE_STROKE = 0xd9f7e6;

const STATS_PANEL_WIDTH = 246;
const STATS_PANEL_HEIGHT = 144;
const HUD_MARGIN = 24;

// A unit's `speed` stat is interpreted as this many tiles travelled per second.
const SPEED_TILES_PER_SEC = 0.5;
// How often an in-range unit lands a hit on a base (milliseconds).
const ATTACK_INTERVAL_MS = 700;
// How often an in-range Collector pulls resource from a node (milliseconds).
const COLLECT_INTERVAL_MS = 700;

// Camera panning. The map is larger than the viewport, so the player scrolls
// the camera to see the rest of it (keyboard, screen-edge push, or mouse drag).
const PAN_KEY_SPEED = 900; // pixels/sec for keyboard + edge-scroll panning
const EDGE_SCROLL_MARGIN = 28; // px band at each screen edge that triggers a pan

// Camera zoom, via mouse wheel (toward the cursor) or +/- keys (toward center).
const MIN_ZOOM = 0.5; // zoomed out far enough to take in most of the map
const MAX_ZOOM = 2.5; // zoomed in for a close look
const ZOOM_WHEEL_STEP = 1.12; // multiplicative zoom change per mouse-wheel notch
const ZOOM_KEY_RATE = 2.2; // multiplicative zoom growth per second while +/- held

export class GameScene extends Phaser.Scene implements GameContext {
  // The single source of truth for game state. The scene reads/writes through
  // it and it is the object that serializes into LLM context.
  private readonly gameState: GameState;
  private readonly unitViews = new Map<string, UnitView>();
  // Per-unit attack cooldown (ms remaining until the next hit). Purely a sim
  // cadence detail, so it lives here rather than in the shared GameState.
  private readonly attackTimers = new Map<string, number>();
  // Per-collector gather cooldown (ms remaining until the next pull), mirroring
  // attackTimers — a sim cadence detail kept out of the shared GameState.
  private readonly collectTimers = new Map<string, number>();
  private readonly baseViews = new Map<string, BaseView>();
  private readonly nodeViews = new Map<string, NodeView>();
  private tileSize = 0;
  private originX = 0;
  private originY = 0;
  private selectedUnitId?: string;
  private selectedUnitBody?: Phaser.GameObjects.Arc;
  private selectedUnitMarker?: Phaser.GameObjects.Arc;
  private statsPanelText?: Phaser.GameObjects.Text;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private zoomInKey?: Phaser.Input.Keyboard.Key;
  private zoomOutKey?: Phaser.Input.Keyboard.Key;
  private isDragPanning = false;
  private dragLastX = 0;
  private dragLastY = 0;
  // Edge-scroll only once the pointer is genuinely over the canvas, so the
  // camera doesn't drift on load (pointer defaults to 0,0) or while the mouse
  // is outside the window.
  private pointerInWindow = false;
  // A second camera locked at zoom 1 that renders only the HUD, so the on-screen
  // UI keeps a fixed size and position while the main camera zooms and pans.
  private uiCamera?: Phaser.Cameras.Scene2D.Camera;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];

  // The players in the match (their controller, linked agent and directive).
  private readonly players: PlayerRegistry;
  // The human seat's id, used to route mouse input through that player's door.
  private readonly humanPlayerId: string;

  // One action interface + tool wrapper per player, built and cached on demand.
  // Every action a player takes — LLM tool call or (routed) human input — flows
  // through its bound interface, so each stays the single door for that player.
  private readonly interfaces = new Map<string, GameInterface>();
  private readonly toolsets = new Map<string, GameToolset>();

  // Match lifecycle. The battle sim only advances while `running` (the world sits
  // idle behind the start menu until the player begins, and freezes once decided).
  // `outcome` latches the result so the game-over notification fires exactly once.
  private running = false;
  private outcome: GameOutcome | null = null;
  /** Fired once when the match is decided. The app wires this to the game-over screen. */
  onGameOver?: (outcome: GameOutcome) => void;

  constructor(world: WorldState = prototypeWorld) {
    super('GameScene');
    this.gameState = new GameState(world);
    this.players = new PlayerRegistry(world.players);
    this.humanPlayerId = this.players.getPlayerByFaction(Faction.Player)?.id ?? '';
  }

  /** The shared game state, for other parts of the app (HUD, LLM context, …). */
  getState(): GameState {
    return this.gameState;
  }

  /** The players registry, for other parts of the app (LLM context, dev console). */
  getPlayers(): PlayerRegistry {
    return this.players;
  }

  /** The human player's id — what the agent panel and dev console act as. */
  getUserPlayerId(): string {
    return this.humanPlayerId;
  }

  /**
   * Begin the battle simulation. The start menu calls this once the player
   * chooses to play; until then the world is drawn but stays frozen. Safe to call
   * before the scene has booted — `update` simply starts advancing once it runs.
   */
  start(): void {
    this.running = true;
  }

  /** The action interface bound to `playerId`. Cached so a session reuses one door. */
  private interfaceFor(playerId: string): GameInterface {
    let iface = this.interfaces.get(playerId);
    if (!iface) {
      iface = new GameInterface(this, { playerId });
      this.interfaces.set(playerId, iface);
    }
    return iface;
  }

  /** The LLM tool wrapper bound to `playerId`. Every order it issues is that
   *  player's. Hand this to an agent session (chat panel or autonomous loop). */
  toolsetFor(playerId: string): GameToolset {
    let toolset = this.toolsets.get(playerId);
    if (!toolset) {
      toolset = new GameToolset(this.interfaceFor(playerId));
      this.toolsets.set(playerId, toolset);
    }
    return toolset;
  }

  /**
   * Suspend or resume the scene's keyboard controls so DOM overlays layered over
   * the canvas (e.g. the agent composer) can receive keys the game would swallow.
   * Phaser captures the pan/zoom keys — SPACE (via `createCursorKeys`), WASD, the
   * arrows and ± — at the window level and calls `preventDefault` on their
   * keydowns regardless of what's focused, so those characters never reach a
   * focused text field. While suspended we also stop tracking key state (and
   * clear any held keys) so the same keystrokes don't pan the camera behind the
   * text field. Callers re-enable on blur.
   */
  setKeyboardEnabled(enabled: boolean): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    keyboard.enabled = enabled;
    if (enabled) {
      keyboard.enableGlobalCapture();
    } else {
      keyboard.disableGlobalCapture();
      keyboard.resetKeys();
    }
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

  getCollectTarget(nodeId: string): CollectTarget | undefined {
    const node = this.gameState.getResourceNode(nodeId);
    return node ? { id: node.id, name: node.name, resource: node.resource } : undefined;
  }

  issueCollectOrder(unitId: string, nodeId: string): void {
    this.gameState.orderCollect(unitId, nodeId);
    // Reset the cooldown so an in-range collector pulls its first load immediately.
    this.collectTimers.set(unitId, 0);
  }

  getMapBounds(): { columns: number; rows: number } {
    const map = this.gameState.getMap();
    return { columns: map.columns, rows: map.rows };
  }

  issueMoveOrder(unitId: string, tileX: number, tileY: number): void {
    // orderMove replaces whatever order the unit had, so a move automatically
    // supersedes any attack (and vice versa) — the two are mutually exclusive.
    this.gameState.orderMove(unitId, tileX, tileY);
  }

  getUnitsForPlayer(playerId: string): readonly UnitState[] {
    const player = this.players.getPlayer(playerId);
    if (!player) return [];
    return this.gameState.getUnits().filter((unit) => unit.faction === player.faction);
  }

  playerOwnsUnit(playerId: string, unitId: string): boolean {
    const player = this.players.getPlayer(playerId);
    const unit = this.gameState.getUnit(unitId);
    return !!player && !!unit && unit.faction === player.faction;
  }

  setPlayerDirective(playerId: string, directive: string): boolean {
    return this.players.setDirective(playerId, directive);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#080d15');
    this.input.mouse?.disableContextMenu();

    // The HUD camera is transparent and never zooms/scrolls, so the UI stays put
    // and unscaled over the zooming/panning main camera. layout() decides which
    // objects each camera renders (see applyCameraLayers).
    const { width, height } = this.scale.gameSize;
    this.uiCamera = this.cameras.add(0, 0, width, height);

    this.setupPanControls();
    this.setupZoomControls();
    this.setupUnitOrders();
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
      // Divide by zoom so the grabbed world point stays under the cursor.
      cam.scrollX -= (pointer.x - this.dragLastX) / cam.zoom;
      cam.scrollY -= (pointer.y - this.dragLastY) / cam.zoom;
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

  // Wire up zooming: mouse wheel zooms toward the cursor, +/- keys (polled in
  // update) zoom toward the screen center.
  private setupZoomControls(): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.zoomInKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.PLUS);
      this.zoomOutKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.MINUS);
    }

    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, deltaY: number) => {
        const current = this.cameras.main.zoom;
        this.zoomTo(deltaY > 0 ? current / ZOOM_WHEEL_STEP : current * ZOOM_WHEEL_STEP, pointer.x, pointer.y);
      },
    );
  }

  // Set the main camera zoom (clamped) while keeping the world point under
  // (focusX, focusY) pinned to that same screen position.
  private zoomTo(target: number, focusX: number, focusY: number): void {
    const cam = this.cameras.main;
    const newZoom = Phaser.Math.Clamp(target, MIN_ZOOM, MAX_ZOOM);
    if (newZoom === cam.zoom) return;

    const { width, height } = this.scale.gameSize;
    const factor = 1 / cam.zoom - 1 / newZoom;
    cam.scrollX += (focusX - width / 2) * factor;
    cam.scrollY += (focusY - height / 2) * factor;
    cam.setZoom(newZoom);
  }

  // Right-click on empty terrain to move the selected unit there. Right-clicks
  // over a base or unit are left to those objects' own handlers (attack/select),
  // so `currentlyOver` being empty is what distinguishes a bare-ground order.
  private setupUnitOrders(): void {
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
        if (!pointer.rightButtonDown() || currentlyOver.length > 0) return;
        this.orderMoveToPointer(pointer);
      },
    );
  }

  // Rebuild the whole scene sized to the current viewport. Called on create and
  // on every window resize so the map always fills the window. Game state
  // (positions, orders, health) lives in GameState and survives across
  // rebuilds; only visuals are recreated.
  private layout(): void {
    this.children.removeAll(true);
    this.unitViews.clear();
    this.baseViews.clear();
    this.nodeViews.clear();
    this.hudObjects = [];
    this.selectedUnitBody = undefined;
    this.selectedUnitMarker = undefined;
    this.statsPanelText = undefined;

    const { width, height } = this.scale.gameSize;
    this.uiCamera?.setSize(width, height);

    const map = this.gameState.getMap();
    this.computeMetrics(map);
    this.cameras.main.setBounds(0, 0, map.columns * this.tileSize, map.rows * this.tileSize);
    this.drawMap(map);
    this.gameState.getBases().forEach((base) => this.drawBase(base));
    this.gameState.getResourceNodes().forEach((node) => this.drawResourceNode(node));
    this.gameState.getUnits().forEach((unit) => this.drawUnit(unit));
    this.drawStatsPanel();
    this.applyCameraLayers();

    if (this.selectedUnitId) {
      const unit = this.gameState.getUnit(this.selectedUnitId);
      if (unit) this.selectUnit(unit);
      else this.selectedUnitId = undefined;
    }
  }

  // Split the display list between the two cameras: the main camera renders the
  // world (and skips the HUD), the UI camera renders only the HUD.
  private applyCameraLayers(): void {
    if (!this.uiCamera) return;
    const hud = new Set<Phaser.GameObjects.GameObject>(this.hudObjects);
    this.cameras.main.ignore(this.hudObjects);
    this.uiCamera.ignore(this.children.list.filter((obj) => !hud.has(obj)));
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

  // A resource node occupies a single tile. Draw it as an emerald square with a
  // short kind label and its remaining reserve; right-clicking it with a
  // Collector selected issues a collect order (same door as an LLM tool call).
  private drawResourceNode(node: ResourceNodeState): void {
    const position = this.tileToWorld(node.position);
    const size = this.tileSize;

    const rect = this.add
      .rectangle(position.x, position.y, size, size, RESOURCE_NODE_FILL, 0.92)
      .setOrigin(0)
      .setStrokeStyle(3, RESOURCE_NODE_STROKE, 0.85)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, size, size), Phaser.Geom.Rectangle.Contains);

    this.add
      .text(position.x + size / 2, position.y + 8, resourceLabel(node.resource), this.getLabelStyle('#08201a', '14px'))
      .setOrigin(0.5, 0);
    const amountText = this.add
      .text(position.x + size / 2, position.y + size - 8, `${node.amount}`, this.getLabelStyle('#08201a', '13px'))
      .setOrigin(0.5, 1);

    this.nodeViews.set(node.id, { node, amountText });

    rect.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.orderCollect(node);
    });
  }

  private drawUnit(unit: UnitState): void {
    const pos = this.gameState.getUnitPosition(unit.id);
    if (!pos) return;

    const px = this.originX + pos.x * this.tileSize;
    const py = this.originY + pos.y * this.tileSize;
    const radius = this.tileSize * 0.28;
    const role = unit.config.role;
    const stroke = UNIT_STROKE[unit.faction];

    const body = this.add
      .circle(px, py, radius, UNIT_COLORS[role])
      .setStrokeStyle(3, stroke, 0.9)
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
      if (this.selectedUnitId !== unit.id) body.setStrokeStyle(3, stroke, 0.9);
    });
  }

  private drawStatsPanel(): void {
    const x = this.scale.gameSize.width - STATS_PANEL_WIDTH - HUD_MARGIN;
    const y = HUD_MARGIN;

    this.registerHud(
      this.add.rectangle(x, y, STATS_PANEL_WIDTH, STATS_PANEL_HEIGHT, 0x0f172a, 0.9).setOrigin(0).setStrokeStyle(1, 0x6b7a99, 0.6),
      this.add.text(x + 16, y + 14, 'Selected Unit', this.getLabelStyle('#f6f7fb', '18px')),
    );
    this.statsPanelText = this.add.text(x + 16, y + 48, this.selectedUnitId ? '' : 'None selected', {
      color: '#aeb8cc',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '14px',
      lineSpacing: 8,
    });
    this.registerHud(this.statsPanelText);
  }

  // Mark objects as HUD: pinned on screen (scroll factor 0) and, via
  // applyCameraLayers, rendered by the fixed-zoom UI camera instead of the world.
  private registerHud(...objects: Phaser.GameObjects.GameObject[]): void {
    for (const obj of objects) {
      (obj as unknown as Phaser.GameObjects.Components.ScrollFactor).setScrollFactor(0);
      this.hudObjects.push(obj);
    }
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
    // Created after applyCameraLayers, so keep it off the HUD camera explicitly.
    this.uiCamera?.ignore(this.selectedUnitMarker);
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
    this.interfaceFor(this.humanPlayerId).invoke('attack', {
      unitId: this.selectedUnitId,
      targetId: base.id,
    });
  }

  // Order the currently selected unit to gather from `node`. Routed through the
  // game interface so a right-click and an LLM `collect` tool call share one
  // path — the interface rejects non-Collector units with a clear message.
  private orderCollect(node: ResourceNodeState): void {
    if (!this.selectedUnitId) return;
    this.interfaceFor(this.humanPlayerId).invoke('collect', {
      unitId: this.selectedUnitId,
      nodeId: node.id,
    });
  }

  // Order the currently selected unit to the grid tile under the pointer. Like
  // orderAttack, this goes through the game interface so a right-click and an LLM
  // `move` tool call share the exact same path.
  private orderMoveToPointer(pointer: Phaser.Input.Pointer): void {
    if (!this.selectedUnitId) return;
    const tileX = Math.floor((pointer.worldX - this.originX) / this.tileSize);
    const tileY = Math.floor((pointer.worldY - this.originY) / this.tileSize);
    this.interfaceFor(this.humanPlayerId).invoke('move', {
      unitId: this.selectedUnitId,
      x: tileX,
      y: tileY,
    });
  }

  update(_time: number, delta: number): void {
    // Camera controls stay live even while the match is idle (menu / game over)
    // so the player can survey the map; only the battle sim is gated on `running`.
    this.updatePan(delta);
    this.updateZoom(delta);
    if (!this.running) return;

    this.gameState.getUnits().forEach((unit) => {
      const order = this.gameState.getUnitOrder(unit.id);
      // A unit carries out at most one order per frame; idle units do nothing.
      if (order.kind === 'attack') this.advanceAttack(unit, order.targetId, delta);
      else if (order.kind === 'move') this.advanceMove(unit, order.x, order.y, delta);
      else if (order.kind === 'collect') this.advanceCollect(unit, order.nodeId, delta);
    });

    const outcome = this.gameState.getOutcome();
    if (outcome) this.endGame(outcome);
  }

  // Latch the result, freeze the sim and notify once. Guarded so a decided match
  // can't fire the callback twice on subsequent frames.
  private endGame(outcome: GameOutcome): void {
    if (this.outcome) return;
    this.outcome = outcome;
    this.running = false;
    this.onGameOver?.(outcome);
  }

  // Path toward the attack target and start hitting it once within range.
  private advanceAttack(unit: UnitState, targetId: string, delta: number): void {
    const base = this.gameState.getBase(targetId);
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
  }

  // Walk toward the destination tile's center; snap onto it and go idle once
  // within a single frame's step of arriving.
  private advanceMove(unit: UnitState, tileX: number, tileY: number, delta: number): void {
    const pos = this.gameState.getUnitPosition(unit.id);
    if (!pos) return;

    const targetX = tileX + 0.5;
    const targetY = tileY + 0.5;
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;
    const distance = Math.hypot(dx, dy);
    const step = unit.config.stats.speed * SPEED_TILES_PER_SEC * (delta / 1000);

    if (distance <= step || distance === 0) {
      this.gameState.setUnitPosition(unit.id, targetX, targetY);
      this.gameState.clearOrder(unit.id);
    } else {
      this.gameState.setUnitPosition(unit.id, pos.x + (dx / distance) * step, pos.y + (dy / distance) * step);
    }
    this.updateUnitPosition(unit.id);
  }

  // Path toward a resource node's tile and start mining it once within range.
  // Mirrors advanceAttack, but the node is a single tile and instead of dealing
  // damage the collector credits its owner's stockpile (see collectFromNode).
  private advanceCollect(unit: UnitState, nodeId: string, delta: number): void {
    const node = this.gameState.getResourceNode(nodeId);
    const pos = this.gameState.getUnitPosition(unit.id);
    if (!node || !pos) return;

    if (node.amount <= 0) {
      this.gameState.clearOrder(unit.id);
      return;
    }

    // Distance to the node tile's center, in grid units.
    const targetX = node.position.x + 0.5;
    const targetY = node.position.y + 0.5;
    const dx = targetX - pos.x;
    const dy = targetY - pos.y;
    const distance = Math.hypot(dx, dy);
    const range = unit.config.stats.range;

    if (distance > range) {
      const step = unit.config.stats.speed * SPEED_TILES_PER_SEC * (delta / 1000);
      const travel = Math.min(step, distance - range);
      this.gameState.setUnitPosition(unit.id, pos.x + (dx / distance) * travel, pos.y + (dy / distance) * travel);
      this.updateUnitPosition(unit.id);
    } else {
      this.collectFromNode(unit, node, delta);
    }
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

    const cam = this.cameras.main;
    // Divide by zoom so on-screen pan speed feels the same at every zoom level.
    const distance = (PAN_KEY_SPEED * delta) / 1000 / cam.zoom;
    const length = Math.hypot(dx, dy);
    cam.scrollX += (dx / length) * distance;
    cam.scrollY += (dy / length) * distance;
  }

  // Poll the +/- keys each frame and zoom toward the screen center.
  private updateZoom(delta: number): void {
    let dir = 0;
    if (this.zoomInKey?.isDown) dir += 1;
    if (this.zoomOutKey?.isDown) dir -= 1;
    if (dir === 0) return;

    const cam = this.cameras.main;
    const step = Math.pow(ZOOM_KEY_RATE, delta / 1000);
    const { width, height } = this.scale.gameSize;
    this.zoomTo(dir > 0 ? cam.zoom * step : cam.zoom / step, width / 2, height / 2);
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

  private collectFromNode(unit: UnitState, node: ResourceNodeState, delta: number): void {
    let timer = (this.collectTimers.get(unit.id) ?? 0) - delta;
    if (timer > 0) {
      this.collectTimers.set(unit.id, timer);
      return;
    }
    timer = COLLECT_INTERVAL_MS;
    this.collectTimers.set(unit.id, timer);

    const extracted = this.gameState.extractFromNode(node.id, unit.config.stats.power);
    if (extracted > 0) {
      // Credit the collector's owner (resolved by faction) with what it mined.
      const owner = this.players.getPlayerByFaction(unit.faction);
      if (owner) this.players.addResource(owner.id, node.resource, extracted);
    }

    this.nodeViews.get(node.id)?.amountText.setText(node.amount > 0 ? `${node.amount}` : 'empty');
    if (node.amount <= 0) this.gameState.clearOrder(unit.id);
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

// Short on-tile badge for a resource kind, e.g. resource1 -> "R1".
function resourceLabel(resource: ResourceKind): string {
  switch (resource) {
    case ResourceKind.Resource1:
      return 'R1';
    default:
      return resource;
  }
}
