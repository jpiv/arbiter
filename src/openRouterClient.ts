import type { ToolSpec } from './game/actions';

export interface ChatPromptResponse {
  message: string;
}

/** A tool call the model asked for, assembled from streamed fragments. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // raw JSON string exactly as the model emitted it
}

// A single turn in an agent conversation. `system` messages are supplied
// separately (per agent), so the transcript only ever holds user/assistant/tool
// turns. Assistant turns may carry `toolCalls`; `tool` turns carry the matching
// `toolCallId` and the tool's result as `content`.
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface StreamChatRequest {
  system: string;
  messages: ChatMessage[];
  // Tool definitions to advertise to the model. Omitted → a plain chat turn.
  tools?: ToolSpec[];
}

/** What a single streamed turn produced once it finishes. */
export interface StreamChatResult {
  content: string;
  toolCalls: ToolCall[];
}

export interface StreamChatHandlers {
  onDelta: (chunk: string) => void;
  // Fired for a reasoning model's "thinking" tokens, which stream before the answer.
  onReasoning?: (chunk: string) => void;
  onDone: (result: StreamChatResult) => void;
  onError: (message: string) => void;
}

export async function sendChatPrompt(prompt: string): Promise<ChatPromptResponse> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
  });

  const payload = (await response.json()) as Partial<ChatPromptResponse> & {
    error?: string;
  };

  if (!response.ok) throw new Error(payload.error ?? 'OpenRouter request failed.');
  if (!payload.message) throw new Error('OpenRouter returned an empty response.');

  return { message: payload.message };
}

// Streamed tool-call fragment as forwarded by the server (OpenAI delta shape).
interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

// POST a conversation to the streaming endpoint and surface tokens as they arrive.
// The server speaks Server-Sent Events; each `data:` frame is a small JSON object
// ({ content } | { reasoning } | { toolCall } | { done } | { error }). Answer text
// and tool-call fragments are accumulated and returned via `onDone`. Pass an
// AbortSignal to cancel mid-stream (no handlers fire after an abort).
export async function streamChat(
  request: StreamChatRequest,
  handlers: StreamChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let answer = '';
  const toolAccum = new Map<number, ToolCall>();

  const assembleToolCalls = (): ToolCall[] =>
    [...toolAccum.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => call)
      .filter((call) => call.name);

  const done = () => handlers.onDone({ content: answer, toolCalls: assembleToolCalls() });

  let response: Response;
  try {
    response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return;
    handlers.onError(error instanceof Error ? error.message : 'Network error.');
    return;
  }

  if (!response.ok || !response.body) {
    let message = 'OpenRouter request failed.';
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    handlers.onError(message);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? ''; // keep the trailing partial frame for the next read

      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        if (!data) continue;

        let event: {
          content?: string;
          reasoning?: string;
          toolCall?: ToolCallDelta[];
          done?: boolean;
          error?: string;
        };
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        if (event.error) {
          handlers.onError(event.error);
          return;
        }
        if (event.reasoning) handlers.onReasoning?.(event.reasoning);
        if (event.content) {
          answer += event.content;
          handlers.onDelta(event.content);
        }
        if (event.toolCall) accumulateToolCalls(toolAccum, event.toolCall);
        if (event.done) {
          done();
          return;
        }
      }
    }

    done();
  } catch (error) {
    if (signal?.aborted) return;
    handlers.onError(error instanceof Error ? error.message : 'Stream interrupted.');
  }
}

// Merge streamed tool-call fragments into the accumulator. The model streams a
// call's `arguments` as a sequence of string fragments keyed by `index`, so we
// append them; `id` and `name` arrive once.
function accumulateToolCalls(accum: Map<number, ToolCall>, deltas: ToolCallDelta[]): void {
  for (const delta of deltas) {
    const index = typeof delta.index === 'number' ? delta.index : 0;
    const current = accum.get(index) ?? { id: '', name: '', arguments: '' };
    if (delta.id) current.id = delta.id;
    if (delta.function?.name) current.name = delta.function.name;
    if (delta.function?.arguments) current.arguments += delta.function.arguments;
    accum.set(index, current);
  }
}
