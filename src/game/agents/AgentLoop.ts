import { Agent } from '../../agents';
import { runAgent, ToolActivity } from '../../agentRunner';
import { ChatMessage } from '../../openRouterClient';
import type { GameToolset } from '../actions';
import type { PlayerRegistry } from '../state';
import type { PlayerRecord } from '../world';

// How often each player's agent takes an autonomous turn (ms). Configurable via
// AgentLoopDeps.tickMs. Cost envelope: each tick is up to MAX_TOOL_ROUNDS model
// round-trips, and the loop fans out one independent tick chain per player — so
// raise this (or gate which players tick) before scaling to many agents.
const TICK_MS = 10_000;

// How many recent tick summaries to keep per player, so the agent doesn't
// re-issue an order it just made. Loop-local memory — NOT the mode-1 chat.
const MEMORY_LIMIT = 3;

/** Headless sink for autonomous-tick output (e.g. the dev-console agent log). */
export interface AgentLoopSink {
  onTickStart?(playerId: string): void;
  onToolActivity?(playerId: string, activity: ToolActivity): void;
  onAnswer?(playerId: string, text: string): void;
  onTickEnd?(playerId: string, status: 'acted' | 'skipped' | 'error', detail?: string): void;
}

export interface AgentLoopDeps {
  // The players to drive; each pairs with the agent that commands it and a directive.
  players: PlayerRegistry;
  // The actor-scoped tool wrapper for a player (orders it issues are that player's).
  toolsetFor: (playerId: string) => GameToolset;
  // The live game-state text injected into the agent's context each round.
  buildStateText: () => string;
  // Resolves the Agent driving a player (its play prompt lives there).
  agentFor: (playerId: string) => Agent | undefined;
  // Optional feed for tick output; without it the loop runs silently.
  sink?: AgentLoopSink;
  // Override the tick cadence (defaults to TICK_MS).
  tickMs?: number;
}

/**
 * The autonomous "play the game" loop. On a fixed cadence it pings every player's
 * agent in its second operating mode: read the standing directive plus live state
 * and act via tools. This is the counterpart to the user-facing chat (mode 1); the
 * two are linked by the directive, which mode 1 writes (set_directive) and this
 * loop reads each tick.
 *
 * Decoupled from the sim loop (mirrors DevConsole): it owns a setInterval and only
 * reads game state through injected getters. Reuses runAgent unchanged, with
 * headless handlers routed to a sink instead of chat bubbles.
 */
export class AgentLoop {
  private timer?: number;
  // Per-player in-flight guard: a tick currently running for that player.
  private readonly inFlight = new Map<string, AbortController>();
  // Short rolling memory of recent tick summaries, per player.
  private readonly memory = new Map<string, string[]>();

  constructor(private readonly deps: AgentLoopDeps) {}

  start(): void {
    if (this.timer !== undefined) return;
    const period = this.deps.tickMs ?? TICK_MS;
    this.timer = window.setInterval(() => this.tickAll(), period);
  }

  stop(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
  }

  // Fire one independent autonomous turn for every player. A slow tick for one
  // player never blocks another.
  private tickAll(): void {
    for (const player of this.deps.players.getPlayers()) void this.tickPlayer(player);
  }

  private async tickPlayer(player: PlayerRecord): Promise<void> {
    const { players, sink } = this.deps;
    const agent = this.deps.agentFor(player.id);
    if (!agent) return; // no agent drives this player — nothing to do

    // Don't overlap a still-running tick, and defer to the human while they chat.
    if (this.inFlight.has(player.id)) {
      sink?.onTickEnd?.(player.id, 'skipped', 'busy');
      return;
    }
    if (players.isChatBusy(player.id)) {
      sink?.onTickEnd?.(player.id, 'skipped', 'user chatting');
      return;
    }

    // Passive by default: with no standing orders, do nothing — and spend nothing.
    const directive = players.getDirective(player.id).trim();
    if (!directive) {
      sink?.onTickEnd?.(player.id, 'skipped', 'no directive');
      return;
    }

    const controller = new AbortController();
    this.inFlight.set(player.id, controller);
    sink?.onTickStart?.(player.id);

    // Mode 2 is stateless per tick: a fresh, throwaway history. The live game
    // state (re-read each round by runAgent) plus the directive plus a short
    // memory summary carry all the continuity the agent needs.
    const history: ChatMessage[] = [
      { role: 'user', content: this.tickUserMessage(player.id, directive) },
    ];

    const actions: string[] = [];
    let answer = '';
    let errored = false;

    try {
      await runAgent({
        system: `${agent.playPrompt}\n\n=== YOUR STANDING DIRECTIVE ===\n${directive}`,
        buildStateText: this.deps.buildStateText,
        history,
        toolset: this.deps.toolsetFor(player.id),
        signal: controller.signal,
        handlers: {
          onAnswerDelta: (chunk) => {
            answer += chunk;
          },
          onToolActivity: (activity) => {
            actions.push(activity.message || activity.name);
            sink?.onToolActivity?.(player.id, activity);
          },
          onDone: () => {
            if (answer.trim()) sink?.onAnswer?.(player.id, answer.trim());
          },
          onError: (message) => {
            errored = true;
            sink?.onTickEnd?.(player.id, 'error', message);
          },
        },
      });
      if (!errored) {
        this.rememberTick(player.id, actions);
        sink?.onTickEnd?.(player.id, 'acted', actions.length ? undefined : 'held');
      }
    } finally {
      this.inFlight.delete(player.id);
    }
  }

  // Build the "it's your turn" trigger, restating the directive inline and
  // surfacing recent actions so the agent doesn't repeat itself.
  private tickUserMessage(playerId: string, directive: string): string {
    const recent = this.memory.get(playerId) ?? [];
    const memoryText = recent.length ? recent.map((line) => `- ${line}`).join('\n') : '(none yet)';
    return (
      `It is your turn to act. Your standing directive is: "${directive}".\n\n` +
      `Recent actions you took (oldest first):\n${memoryText}\n\n` +
      'Review the current game state above and carry out the directive using your tools. If the ' +
      'directive is to hold, defend, or stand by, or the situation calls for no change, take no ' +
      "action and briefly say you're holding. Otherwise issue only the orders needed to advance " +
      "the directive — don't repeat orders your units are already carrying out — then briefly " +
      'report what you did.'
    );
  }

  // Append this tick's summary to the player's rolling memory, capped at MEMORY_LIMIT.
  private rememberTick(playerId: string, actions: string[]): void {
    const summary = actions.length ? actions.join('; ') : 'held (no action)';
    const recent = this.memory.get(playerId) ?? [];
    recent.push(summary);
    while (recent.length > MEMORY_LIMIT) recent.shift();
    this.memory.set(playerId, recent);
  }
}
