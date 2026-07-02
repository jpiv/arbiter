import { Agent, AGENTS, agentInitials } from '../agents';
import { ChatMessage, streamChat } from '../openRouterClient';
import './agentPanel.css';

// Overlay UI listing the player's AI agents and letting them chat with one over a
// streaming OpenRouter connection. Conversations are kept per agent for the life of
// the page so switching agents (or closing/reopening the panel) preserves history.
export class AgentPanel {
  private readonly agents: Agent[];
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
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;

  constructor(agents: Agent[] = AGENTS) {
    this.agents = agents;
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
    this.sendBtn = el('button', 'agent-send');
    this.sendBtn.type = 'button';
    this.sendBtn.textContent = 'Send';
    this.sendBtn.addEventListener('click', () => this.onSend());
    composer.append(this.input, this.sendBtn);

    chat.append(this.messagesEl, composer);
    panel.append(header, this.roster, chat);
    this.root.append(launcher, panel);
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
      this.appendBubble(message.role, message.content);
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

    const userMessage: ChatMessage = { role: 'user', content };
    history.push(userMessage);
    this.appendBubble('user', content);

    this.input.value = '';
    this.autoGrow();

    // Placeholder assistant turn we stream tokens into.
    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    history.push(assistantMessage);

    // The live assistant bubble holds the streamed answer text. Reasoning tokens
    // from a thinking model are consumed but not shown (see onReasoning below).
    const bubble = el('div', 'agent-msg agent-msg-assistant agent-msg-streaming');
    const answerEl = el('span', 'agent-msg-answer');
    bubble.append(answerEl);
    this.messagesEl.appendChild(bubble);
    this.scrollToBottom();

    this.abortController = new AbortController();
    this.updateSendButton();

    let reasoning = '';

    // Called when the stream ends with no answer text. If the model only produced
    // reasoning, promote it to the visible reply; otherwise drop the empty bubble.
    const settleEmpty = () => {
      if (assistantMessage.content) return;
      if (reasoning) {
        assistantMessage.content = reasoning;
        answerEl.textContent = reasoning;
      } else {
        bubble.remove();
        const index = history.indexOf(assistantMessage);
        if (index !== -1) history.splice(index, 1);
      }
    };

    void streamChat(
      { system: agent.systemPrompt, messages: history.slice(0, -1) },
      {
        onReasoning: (chunk) => {
          // Kept only so a reasoning-only reply can fall back to it; never shown.
          reasoning += chunk;
        },
        onDelta: (chunk) => {
          assistantMessage.content += chunk;
          answerEl.textContent = assistantMessage.content;
          this.scrollToBottom();
        },
        onDone: () => {
          bubble.classList.remove('agent-msg-streaming');
          settleEmpty();
          this.finishStream();
        },
        onError: (message) => {
          bubble.classList.remove('agent-msg-streaming');
          settleEmpty();
          this.appendError(message);
          this.scrollToBottom();
          this.finishStream();
        },
      },
      this.abortController.signal,
    );
  }

  private cancelStream(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }
  }

  private finishStream(): void {
    this.abortController = undefined;
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
