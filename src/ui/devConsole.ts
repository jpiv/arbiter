import type { GameState } from '../game/state';
import './devConsole.css';

// How often the live view refreshes while the console is open (ms). Fast enough
// to watch unit positions and base health tick during the sim, cheap enough to
// leave running.
const REFRESH_MS = 250;

type DevView = 'json' | 'text';

// Developer overlay for inspecting live game state. A floating launcher (bottom
// right, opposite the agent panel) opens a docked panel that re-reads the
// GameState snapshot on a timer, so it always mirrors what the simulation is
// doing right now. Two views: the JSON snapshot (the canonical serialized form)
// and the compact prompt text handed to an LLM.
export class DevConsole {
  private readonly getState: () => GameState;

  private view: DevView = 'json';
  private timer?: number;

  // DOM references, wired up once in build().
  private root!: HTMLDivElement;
  private body!: HTMLPreElement;
  private jsonTab!: HTMLButtonElement;
  private textTab!: HTMLButtonElement;
  private copyBtn!: HTMLButtonElement;

  constructor(getState: () => GameState) {
    this.getState = getState;
  }

  mount(parent: HTMLElement = document.body): void {
    this.build();
    parent.appendChild(this.root);
  }

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
    tabs.append(this.jsonTab, this.textTab);

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
    // the scene — it only ever reads through the getState callback.
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
    const state = this.getState();
    return this.view === 'json'
      ? JSON.stringify(state.snapshot(), null, 2)
      : state.toPromptText();
  }

  private render(): void {
    this.jsonTab.classList.toggle('is-active', this.view === 'json');
    this.textTab.classList.toggle('is-active', this.view === 'text');
    this.body.textContent = this.content();
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
