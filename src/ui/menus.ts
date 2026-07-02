import type { GameOutcome } from '../game/state';
import './menus.css';

// The title screen and the game-over screen: two full-screen overlays layered
// over the Phaser canvas, following the same DOM-overlay pattern as the agent
// panel and dev console. Both use a shared `.screen` shell (see menus.css) that
// fades in over a semi-transparent, blurred backdrop, so the world stays faintly
// visible behind them.

/**
 * The title screen shown on load. It holds the world idle behind a backdrop
 * until the player chooses to begin; clicking "Start Game" fires {@link onStart}
 * and fades the menu away, handing input back to the canvas.
 */
export class StartMenu {
  /** Invoked once when the player starts the match. */
  onStart?: () => void;

  private root!: HTMLDivElement;

  mount(parent: HTMLElement = document.body): void {
    this.build();
    parent.appendChild(this.root);
  }

  private build(): void {
    this.root = el('div', 'screen screen-start');
    this.root.dataset.open = 'true';

    const card = el('div', 'screen-card');

    const title = el('h1', 'screen-title');
    title.textContent = 'Arbiter';

    const tagline = el('p', 'screen-tagline');
    tagline.textContent = 'Command your forces and raze the enemy base — before they raze yours.';

    const hints = el('ul', 'screen-hints');
    for (const hint of [
      'Left-click a unit to select it',
      'Right-click the ground to move, or an enemy base to attack',
      'WASD / arrows / screen edges pan · scroll or ± to zoom',
    ]) {
      const item = el('li', 'screen-hint');
      item.textContent = hint;
      hints.append(item);
    }

    const start = el('button', 'screen-btn screen-btn-primary');
    start.type = 'button';
    start.textContent = 'Start Game';
    start.addEventListener('click', () => {
      this.root.dataset.open = 'false';
      this.onStart?.();
    });

    card.append(title, tagline, hints, start);
    this.root.append(card);
  }
}

/**
 * The end-of-match screen. Hidden until {@link show} is called with the result,
 * at which point it fades in with victory/defeat copy and accent; "Play Again"
 * fires {@link onPlayAgain}.
 */
export class GameOverScreen {
  /** Invoked when the player chooses to play again. */
  onPlayAgain?: () => void;

  private root!: HTMLDivElement;
  private title!: HTMLHeadingElement;
  private message!: HTMLParagraphElement;

  mount(parent: HTMLElement = document.body): void {
    this.build();
    parent.appendChild(this.root);
  }

  /** Reveal the screen with the copy and accent for the given result. */
  show(outcome: GameOutcome): void {
    this.root.dataset.outcome = outcome;
    if (outcome === 'victory') {
      this.title.textContent = 'Victory';
      this.message.textContent = 'Every enemy base has been destroyed. The field is yours.';
    } else {
      this.title.textContent = 'Defeat';
      this.message.textContent = 'Your base has fallen. Regroup and try again.';
    }
    this.root.dataset.open = 'true';
  }

  private build(): void {
    this.root = el('div', 'screen screen-over');
    this.root.dataset.open = 'false';

    const card = el('div', 'screen-card');
    this.title = el('h1', 'screen-title');
    this.message = el('p', 'screen-tagline');

    const again = el('button', 'screen-btn screen-btn-primary');
    again.type = 'button';
    again.textContent = 'Play Again';
    again.addEventListener('click', () => this.onPlayAgain?.());

    card.append(this.title, this.message, again);
    this.root.append(card);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
