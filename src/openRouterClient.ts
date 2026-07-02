export interface ChatPromptResponse {
  message: string;
}

// A single turn in an agent conversation. `system` messages are supplied
// separately (per agent), so the transcript only ever holds user/assistant turns.
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamChatRequest {
  system: string;
  messages: ChatMessage[];
}

export interface StreamChatHandlers {
  onDelta: (chunk: string) => void;
  // Fired for a reasoning model's "thinking" tokens, which stream before the answer.
  onReasoning?: (chunk: string) => void;
  onDone: () => void;
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

// POST a conversation to the streaming endpoint and surface tokens as they arrive.
// The server speaks Server-Sent Events; each `data:` frame is a small JSON object
// ({ content } | { done } | { error }). Pass an AbortSignal to cancel mid-stream.
export async function streamChat(
  request: StreamChatRequest,
  handlers: StreamChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
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
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? ''; // keep the trailing partial frame for the next read

      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        if (!data) continue;

        let event: { content?: string; reasoning?: string; done?: boolean; error?: string };
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
        if (event.content) handlers.onDelta(event.content);
        if (event.done) {
          handlers.onDone();
          return;
        }
      }
    }

    handlers.onDone();
  } catch (error) {
    if (signal?.aborted) return;
    handlers.onError(error instanceof Error ? error.message : 'Stream interrupted.');
  }
}
