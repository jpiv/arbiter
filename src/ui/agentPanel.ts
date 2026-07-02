import { Agent, AGENTS, agentInitials } from '../agents';
import { runAgent } from '../agentRunner';
import { ChatMessage } from '../openRouterClient';
import type { GameToolset } from '../game/actions';
import './agentPanel.css';

export interface AgentPanelDeps {
  // The game's tool wrapper — its actions become tools every agent can call.
  toolset: GameToolset;
  // Produces the current game-state text injected into the agent's context.
  buildStateText: () => string;
  // Suspends/resumes the game's keyboard controls. The composer calls this on
  // focus/blur so the game doesn't capture the keys the user is trying to type
  // (SPACE, WASD, the arrows and ±, all bound to camera pan/zoom).
  setGameKeyboardEnabled?: (enabled: boolean) => void;
  // Publishes whether the human is mid-chat with their agent, so the autonomous
  // loop defers to this direct control (mode 1 preempts mode 2). Set true while a
  // reply is streaming, false when it ends.
  setChatBusy?: (busy: boolean) => void;
  agents?: Agent[];
}

// Overlay UI listing the player's AI agents and letting them chat with one over a
// streaming OpenRouter connection. Agents can also act in the game: their replies
// may call the game's tools (move, attack, …), which run against the live state.
// Conversations are kept per agent for the life of the page so switching agents
// (or closing/reopening the panel) preserves history.
export class AgentPanel {
  private readonly agents: Agent[];
  private readonly toolset: GameToolset;
  private readonly buildStateText: () => string;
  private readonly setGameKeyboardEnabled: (enabled: boolean) => void;
  private readonly setChatBusy: (busy: boolean) => void;
  private readonly conversations = new Map<string, ChatMessage[]>();

  private activeAgent?: Agent;
  private abortController?: AbortController;
  private get streaming(): boolean {
    return this.abortController !== undefined;
  }

  // DOM references, wired up once in build().
  private root!: HTMLDivElement;
  private headerTitle!: HTMLDivElement;
  private headerSub!: HTMLDivElement;
  private backBtn!: HTMLButtonElement;
  private roster!: HTMLDivElement;
  private messagesEl!: HTMLDivElement;
  private composer!: HTMLDivElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;

  constructor(deps: AgentPanelDeps) {
    this.toolset = deps.toolset;
    this.buildStateText = deps.buildStateText;
    this.setGameKeyboardEnabled = deps.setGameKeyboardEnabled ?? (() => {});
    this.setChatBusy = deps.setChatBusy ?? (() => {});
    this.agents = deps.agents ?? AGENTS;
  }

  mount(parent: HTMLElement = document.body): void {
    this.build();
    parent.appendChild(this.root);
    this.renderRoster();
  }

  // ---- construction ---------------------------------------------------------

  private build(): void {
    this.root = el('div', 'agent-root');
    this.root.dataset.open = 'false';
    this.root.dataset.view = 'roster';

    // Launcher (visible when the panel is closed).
    const launcher = el('button', 'agent-launcher');
    launcher.type = 'button';
    launcher.append(el('span', 'agent-launcher-dot'), text('Agents'));
    launcher.addEventListener('click', () => this.open());

    // Panel shell.
    const panel = el('aside', 'agent-panel');

    const header = el('div', 'agent-header');
    this.backBtn = iconButton('‹', 'Back to agents', () => this.showRoster());
    this.backBtn.style.display = 'none';
    const titles = el('div', 'agent-header-title-wrap');
    this.headerTitle = el('div', 'agent-header-title');
    this.headerTitle.textContent = 'Agents';
    this.headerSub = el('div', 'agent-header-sub');
    titles.append(this.headerTitle, this.headerSub);
    const closeBtn = iconButton('✕', 'Close panel', () => this.close());
    header.append(this.backBtn, titles, closeBtn);

    // Roster view.
    this.roster = el('div', 'agent-roster');

    // Chat view.
    const chat = el('div', 'agent-chat');
    this.messagesEl = el('div', 'agent-messages');

    const composer = el('div', 'agent-composer');
    this.composer = composer;
    this.input = document.createElement('textarea');
    this.input.className = 'agent-input';
    this.input.rows = 1;
    this.input.placeholder = 'Message your agent…';
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.onSend();
      }
    });
    this.input.addEventListener('input', () => this.autoGrow());
    // Hand keyboard control to the composer while it's focused so the game stops
    // eating the keys the user is typing (SPACE/WASD/arrows/± are camera controls);
    // give it back on blur.
    this.input.addEventListener('focus', () => this.setGameKeyboardEnabled(false));
    this.input.addEventListener('blur', () => this.setGameKeyboardEnabled(true));
    this.sendBtn = el('button', 'agent-send');
    this.sendBtn.type = 'button';
    this.sendBtn.textContent = 'Send';
    this.sendBtn.addEventListener('click', () => this.onSend());
    composer.append(this.input, this.sendBtn);

    chat.append(this.messagesEl, composer);
    panel.append(header, this.roster, chat);
    this.root.append(launcher, panel);

    // Clicking anywhere outside the composer should blur the input. The browser
    // does this for free when the click lands on a DOM element, but a click on
    // the Phaser canvas (the map) doesn't steal focus: Phaser calls
    // preventDefault() on canvas pointer-downs, which suppresses the default
    // focus shift and leaves the textarea focused. Blur it ourselves on any
    // pointer-down that isn't inside the composer. Capture phase so it fires
    // regardless of what downstream handlers do, and doesn't disturb the click.
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (document.activeElement !== this.input) return;
        const target = event.target as Node | null;
        if (target && this.composer.contains(target)) return;
        this.input.blur();
      },
      true,
    );
  }

  // ---- open / close / navigation -------------------------------------------

  private open(): void {
    this.root.dataset.open = 'true';
  }

  private close(): void {
    this.root.dataset.open = 'false';
  }

  private showRoster(): void {
    // Leaving a chat cancels any in-flight stream for that agent.
    this.cancelStream();
    this.activeAgent = undefined;
    this.root.dataset.view = 'roster';
    this.backBtn.style.display = 'none';
    this.headerTitle.textContent = 'Agents';
    this.headerSub.textContent = `${this.agents.length} available`;
  }

  private renderRoster(): void {
    this.roster.replaceChildren();
    this.headerSub.textContent = `${this.agents.length} available`;

    for (const agent of this.agents) {
      const card = el('button', 'agent-card');
      card.type = 'button';

      const avatar = el('div', 'agent-avatar');
      avatar.style.background = agent.accent;
      avatar.textContent = agentInitials(agent);

      const body = el('div', 'agent-card-body');
      const name = el('div', 'agent-card-name');
      name.append(text(agent.name), el('span', 'agent-status'));
      const role = el('div', 'agent-card-role');
      role.textContent = agent.role;
      const blurb = el('div', 'agent-card-blurb');
      blurb.textContent = agent.blurb;
      body.append(name, role, blurb);

      card.append(avatar, body);
      card.addEventListener('click', () => this.openAgent(agent));
      this.roster.appendChild(card);
    }
  }

  private openAgent(agent: Agent): void {
    this.activeAgent = agent;
    this.root.dataset.view = 'chat';
    this.backBtn.style.display = '';
    this.headerTitle.textContent = agent.name;
    this.headerSub.textContent = agent.role;
    this.renderConversation();
    this.updateSendButton();
    this.input.focus();
  }

  // ---- messaging ------------------------------------------------------------

  private conversation(agent: Agent): ChatMessage[] {
    let history = this.conversations.get(agent.id);
    if (!history) {
      history = [];
      this.conversations.set(agent.id, history);
    }
    return history;
  }

  private renderConversation(): void {
    if (!this.activeAgent) return;
    this.messagesEl.replaceChildren();

    const history = this.conversation(this.activeAgent);
    if (history.length === 0) {
      const empty = el('div', 'agent-msg-empty');
      empty.textContent = `Say hello to ${this.activeAgent.name}.`;
      this.messagesEl.appendChild(empty);
      return;
    }

    for (const message of history) {
      if (message.role === 'tool') {
        this.appendToolLineFromResult(message.content);
      } else if (message.role === 'assistant' && !message.content) {
        // Pure tool-call turn; the activity is shown by the tool result lines.
      } else {
        this.appendBubble(message.role, message.content);
      }
    }
    this.scrollToBottom();
  }

  private onSend(): void {
    // While a reply is streaming the Send button doubles as Stop.
    if (this.streaming) {
      this.cancelStream();
      this.finishStream();
      return;
    }
    if (!this.activeAgent) return;

    const content = this.input.value.trim();
    if (!content) return;

    const agent = this.activeAgent;
    const history = this.conversation(agent);

    // Drop the "say hello" placeholder on the first real message.
    if (history.length === 0) this.messagesEl.replaceChildren();

    history.push({ role: 'user', content });
    this.appendBubble('user', content);

    this.input.value = '';
    this.autoGrow();

    this.abortController = new AbortController();
    // Tell the autonomous loop to hold off while the human is steering directly.
    this.setChatBusy(true);
    this.updateSendButton();

    // The agent may take several model turns (calling tools between them). Each
    // turn streams into its own bubble, created lazily on the first answer token
    // so pure tool-call turns don't leave an empty bubble behind.
    let bubble: HTMLDivElement | undefined;
    let answerEl: HTMLSpanElement | undefined;
    let answer = '';

    const finalizeBubble = () => {
      if (!bubble) return;
      bubble.classList.remove('agent-msg-streaming');
      if (!answer) bubble.remove();
      bubble = undefined;
      answerEl = undefined;
      answer = '';
    };

    void runAgent({
      system: agent.commandPrompt,
      buildStateText: this.buildStateText,
      history,
      toolset: this.toolset,
      signal: this.abortController.signal,
      handlers: {
        onAnswerDelta: (chunk) => {
          if (!bubble) {
            bubble = el('div', 'agent-msg agent-msg-assistant agent-msg-streaming');
            answerEl = el('span', 'agent-msg-answer');
            bubble.append(answerEl);
            this.messagesEl.appendChild(bubble);
          }
          answer += chunk;
          answerEl!.textContent = answer;
          this.scrollToBottom();
        },
        onToolActivity: (activity) => {
          this.appendToolLine(activity.message || activity.name, activity.ok);
          this.scrollToBottom();
        },
        onRoundEnd: () => finalizeBubble(),
        onDone: () => this.finishStream(),
        onError: (message) => {
          finalizeBubble();
          this.appendError(message);
          this.scrollToBottom();
          this.finishStream();
        },
      },
    });
  }

  private cancelStream(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
      this.setChatBusy(false);
    }
  }

  private finishStream(): void {
    this.abortController = undefined;
    this.setChatBusy(false);
    this.updateSendButton();
  }

  private updateSendButton(): void {
    if (this.streaming) {
      this.sendBtn.textContent = 'Stop';
      this.sendBtn.classList.add('is-stop');
    } else {
      this.sendBtn.textContent = 'Send';
      this.sendBtn.classList.remove('is-stop');
    }
  }

  // ---- small DOM helpers ----------------------------------------------------

  private appendBubble(role: ChatMessage['role'], content: string): HTMLDivElement {
    const bubble = el('div', `agent-msg agent-msg-${role}`);
    bubble.textContent = content;
    this.messagesEl.appendChild(bubble);
    return bubble;
  }

  private appendError(message: string): void {
    const bubble = el('div', 'agent-msg agent-msg-error');
    bubble.textContent = message;
    this.messagesEl.appendChild(bubble);
  }

  // A compact line showing a tool the agent ran and its result (e.g. an order it
  // issued in the game). Failed actions are styled distinctly.
  private appendToolLine(message: string, ok: boolean): void {
    const line = el('div', `agent-tool-line${ok ? '' : ' agent-tool-line-error'}`);
    line.textContent = `⚙ ${message}`;
    this.messagesEl.appendChild(line);
  }

  // Re-render a tool line from a stored tool result (JSON `{ ok, message }`).
  private appendToolLineFromResult(json: string): void {
    let ok = true;
    let message = '';
    try {
      const parsed = JSON.parse(json) as { ok?: boolean; message?: string };
      ok = parsed.ok !== false;
      message = parsed.message ?? '';
    } catch {
      // Unparseable result; nothing useful to show.
    }
    if (message) this.appendToolLine(message, ok);
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private autoGrow(): void {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, 120)}px`;
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

function iconButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = el('button', 'agent-icon-btn');
  button.type = 'button';
  button.textContent = glyph;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}
