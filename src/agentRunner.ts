import type { GameToolset, ToolSpec } from './game/actions';
import { ChatMessage, StreamChatResult, streamChat } from './openRouterClient';

/** A tool the agent invoked, with its parsed args and result, for display. */
export interface ToolActivity {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  message: string;
}

export interface AgentRunHandlers {
  // A new model turn is starting (there may be several per user message when
  // the model chains tool calls).
  onRoundStart?: () => void;
  onReasoning?: (chunk: string) => void;
  onAnswerDelta: (chunk: string) => void;
  // A streamed turn finished (before any of its tool calls run).
  onRoundEnd?: () => void;
  onToolActivity?: (activity: ToolActivity) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export interface RunAgentParams {
  // The agent's own system prompt. The current game state and tool guidance are
  // appended automatically each round.
  system: string;
  // Produces the latest game-state text; re-read each round so the model always
  // sees the effect of its own tool calls.
  buildStateText: () => string;
  // The running conversation. runAgent appends the assistant/tool turns it
  // generates so history stays complete for the next user message.
  history: ChatMessage[];
  toolset: GameToolset;
  handlers: AgentRunHandlers;
  signal?: AbortSignal;
}

// Guidance appended to the system prompt so the model knows it can act and how
// to reference entities by the ids shown in the game state.
const TOOL_GUIDE =
  'You can act in the game by calling the provided tools (for example: move, attack). ' +
  'Use the exact unit and target ids shown in the CURRENT GAME STATE below. When the ' +
  'player asks you to do something in the game, call the appropriate tool rather than ' +
  'only describing it. After the tools run you will see their results and can report ' +
  'back to the player. If no action is needed, just reply normally.';

// Stop runaway loops: at most this many model↔tool round-trips per user turn.
const MAX_TOOL_ROUNDS = 8;

/**
 * Drive one user turn to completion: stream the model's reply, execute any tool
 * calls it makes against the live game via the toolset, feed the results back,
 * and repeat until the model answers without calling a tool (or the round cap is
 * hit). All game actions the model can take come from `toolset.specs()`, so new
 * actions registered in the game are automatically available here.
 */
export async function runAgent(params: RunAgentParams): Promise<void> {
  const { system, buildStateText, history, toolset, handlers, signal } = params;
  const tools = toolset.specs();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal?.aborted) return;

    handlers.onRoundStart?.();
    const roundSystem = `${system}\n\n${TOOL_GUIDE}\n\n=== CURRENT GAME STATE ===\n${buildStateText()}`;

    const result = await streamRound(roundSystem, history, tools, handlers, signal);
    handlers.onRoundEnd?.();
    if (!result) return; // aborted, or an error was already surfaced

    // Record the assistant turn (answer text and/or tool calls) for context.
    history.push({
      role: 'assistant',
      content: result.content,
      toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
    });

    if (result.toolCalls.length === 0) {
      handlers.onDone();
      return;
    }

    // Execute each requested tool against the live game and feed results back.
    for (const call of result.toolCalls) {
      const outcome = toolset.call(call.name, call.arguments);
      handlers.onToolActivity?.({
        name: call.name,
        args: safeParseArgs(call.arguments),
        ok: outcome.ok,
        message: outcome.message,
      });
      history.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome) });
    }
    // Loop so the model gets another turn to react to the tool results.
  }

  handlers.onError('Agent stopped after too many tool-use rounds.');
}

// Stream a single model turn, resolving with its result — or null if the request
// was aborted or errored (the error is surfaced via handlers before resolving).
function streamRound(
  system: string,
  history: ChatMessage[],
  tools: ToolSpec[],
  handlers: AgentRunHandlers,
  signal?: AbortSignal,
): Promise<StreamChatResult | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);

    const onAbort = () => resolve(null);
    signal?.addEventListener('abort', onAbort, { once: true });
    const settle = (value: StreamChatResult | null) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    };

    void streamChat(
      { system, messages: history, tools },
      {
        onReasoning: handlers.onReasoning,
        onDelta: handlers.onAnswerDelta,
        onDone: (result) => settle(result),
        onError: (message) => {
          handlers.onError(message);
          settle(null);
        },
      },
      signal,
    );
  });
}

function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
