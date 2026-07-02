import type { GameState, PlayerRegistry } from '../game/state';
import type { AgentLoopSink } from '../game/agents/AgentLoop';
import './devConsole.css';

// How often the live view refreshes while the console is open (ms). Fast enough
// to watch unit positions and base health tick during the sim, cheap enough to
// leave running.
const REFRESH_MS = 250;

// Cap on the autonomous-tick log so it can be left running all game.
const AGENT_LOG_LIMIT = 300;

type DevView = 'json' | 'text' | 'agent';

// Developer overlay for inspecting live game state. A floating launcher (bottom
// right, opposite the agent panel) opens a docked panel that re-reads the
// GameState + PlayerRegistry snapshots on a timer, so it always mirrors what the
// simulation is doing right now. Three views: the JSON snapshot (the canonical
// serialized form), the compact prompt text handed to an LLM, and an Agent log
// that surfaces what the autonomous loop does each tick (kept out of the chat).
export class DevConsole {
  private readonly getState: () => GameState;
  private readonly getPlayers: () => PlayerRegistry;

  private view: DevView = 'json';
  private timer?: number;
  // Autonomous-tick log lines, oldest first, written by the AgentLoop sink.
  private readonly agentLog: string[] = [];

  // DOM references, wired up once in build().
  private root!: HTMLDivElement;
  private body!: HTMLPreElement;
  private jsonTab!: HTMLButtonElement;
  private textTab!: HTMLButtonElement;
  private agentTab!: HTMLButtonElement;
  private copyBtn!: HTMLButtonElement;

  constructor(getState: () => GameState, getPlayers: () => PlayerRegistry) {
    this.getState = getState;
    this.getPlayers = getPlayers;
  }

  mount(parent: HTMLElement = document.body): void {
    this.build();
    parent.appendChild(this.root);
  }

  // The sink handed to the AgentLoop: it appends readable lines to the agent log.
  readonly agentSink: AgentLoopSink = {
    onTickStart: (playerId) => this.log(`${playerId}: tick start`),
    onToolActivity: (playerId, activity) =>
      this.log(`${playerId}:   ${activity.ok ? '⚙' : '⚠'} ${activity.message || activity.name}`),
    onAnswer: (playerId, text) => this.log(`${playerId}:   "${text}"`),
    onTickEnd: (playerId, status, detail) =>
      this.log(`${playerId}: ${status}${detail ? ` (${detail})` : ''}`),
  };

  // ---- construction ---------------------------------------------------------

  private build(): void {
    this.root = el('div', 'dev-root');
    this.root.dataset.open = 'false';

    // Launcher (visible when the panel is closed).
    const launcher = el('button', 'dev-launcher');
    launcher.type = 'button';
    launcher.append(el('span', 'dev-launcher-dot'), text('Dev'));
    launcher.addEventListener('click', () => this.open());

    // Panel shell.
    const panel = el('aside', 'dev-panel');

    const header = el('div', 'dev-header');
    const titles = el('div', 'dev-header-title-wrap');
    const title = el('div', 'dev-header-title');
    title.textContent = 'Game state';
    const sub = el('div', 'dev-header-sub');
    sub.textContent = 'Live snapshot';
    titles.append(title, sub);

    // View toggle + copy, then close.
    const tabs = el('div', 'dev-tabs');
    this.jsonTab = tabButton('JSON', () => this.setView('json'));
    this.textTab = tabButton('Prompt', () => this.setView('text'));
    this.agentTab = tabButton('Agent', () => this.setView('agent'));
    tabs.append(this.jsonTab, this.textTab, this.agentTab);

    this.copyBtn = iconButton('⧉', 'Copy to clipboard', () => this.copy());
    const closeBtn = iconButton('✕', 'Close console', () => this.close());
    header.append(titles, tabs, this.copyBtn, closeBtn);

    this.body = document.createElement('pre');
    this.body.className = 'dev-body';

    panel.append(header, this.body);
    this.root.append(launcher, panel);
  }

  // ---- open / close ---------------------------------------------------------

  private open(): void {
    this.root.dataset.open = 'true';
    this.render();
    // Poll instead of hooking the sim loop so this stays fully decoupled from
    // the scene — it only ever reads through the getState/getPlayers callbacks.
    this.timer = window.setInterval(() => this.render(), REFRESH_MS);
  }

  private close(): void {
    this.root.dataset.open = 'false';
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private setView(view: DevView): void {
    this.view = view;
    this.render();
  }

  // ---- rendering ------------------------------------------------------------

  private content(): string {
    if (this.view === 'agent') {
      return this.agentLog.length ? this.agentLog.join('\n') : 'No autonomous ticks yet.';
    }
    const state = this.getState();
    const players = this.getPlayers();
    if (this.view === 'json') {
      return JSON.stringify({ ...state.snapshot(), players: players.snapshot() }, null, 2);
    }
    return `${state.toPromptText()}\n\n${players.toPromptText()}`;
  }

  private render(): void {
    this.jsonTab.classList.toggle('is-active', this.view === 'json');
    this.textTab.classList.toggle('is-active', this.view === 'text');
    this.agentTab.classList.toggle('is-active', this.view === 'agent');
    this.body.textContent = this.content();
  }

  // Append a line to the autonomous-tick log, trimming to the cap. Re-renders
  // immediately if the console is open on the agent view.
  private log(line: string): void {
    this.agentLog.push(line);
    while (this.agentLog.length > AGENT_LOG_LIMIT) this.agentLog.shift();
    if (this.root?.dataset.open === 'true' && this.view === 'agent') this.render();
  }

  private copy(): void {
    void navigator.clipboard?.writeText(this.content()).then(
      () => this.flashCopy('Copied'),
      () => this.flashCopy('Copy failed'),
    );
  }

  private flashCopy(label: string): void {
    this.copyBtn.title = label;
    this.copyBtn.classList.add('is-flash');
    window.setTimeout(() => {
      this.copyBtn.classList.remove('is-flash');
      this.copyBtn.title = 'Copy to clipboard';
    }, 900);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function text(value: string): Text {
  return document.createTextNode(value);
}

function tabButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', 'dev-tab');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function iconButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', 'dev-icon-btn');
  button.type = 'button';
  button.textContent = glyph;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}
