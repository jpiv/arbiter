import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 8787);

enum ChatRole {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
}

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_SYSTEM_PROMPT = 'You are an AI commander assistant for a 2D RTS browser game prototype.';

function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:5173',
    'X-Title': 'Arbiter',
  };
}

app.use(express.json());

app.post('/api/chat', async (request, response) => {
  const prompt = String(request.body?.prompt ?? '').trim();
  if (!prompt) return response.status(400).json({ error: 'Prompt is required.' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey) return response.status(500).json({ error: 'OPENROUTER_API_KEY is not configured.' });
  if (!model) return response.status(500).json({ error: 'OPENROUTER_MODEL is not configured.' });

  try {
    const openRouterResponse = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [
          { role: ChatRole.System, content: DEFAULT_SYSTEM_PROMPT },
          { role: ChatRole.User, content: prompt },
        ],
      }),
    });

    const payload = (await openRouterResponse.json()) as OpenRouterChatResponse & {
      error?: { message?: string };
    };

    if (!openRouterResponse.ok) {
      return response.status(openRouterResponse.status).json({
        error: payload.error?.message ?? 'OpenRouter request failed.',
      });
    }

    const message = payload.choices?.[0]?.message?.content?.trim();
    if (!message) return response.status(502).json({ error: 'OpenRouter returned an empty response.' });

    return response.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected OpenRouter error.';

    return response.status(500).json({ error: message });
  }
});

// Streaming chat used by the in-game agent panel. Accepts a running conversation
// (`messages`) plus an optional per-agent `system` prompt, proxies OpenRouter with
// `stream: true`, and re-emits each token as a Server-Sent Event so the browser can
// render the reply as it arrives:
//   data: {"reasoning": "..."} incremental reasoning/"thinking" token(s)
//   data: {"content": "..."}   incremental answer token(s)
//   data: {"done": true}       stream finished cleanly
//   data: {"error": "..."}     something went wrong
// (Reasoning models such as GLM stream a long `reasoning` phase before any answer
// `content`; forwarding both keeps the panel visibly live the whole time.)
app.post('/api/chat/stream', async (request, response) => {
  const body = request.body ?? {};
  const system = typeof body.system === 'string' && body.system.trim() ? body.system.trim() : DEFAULT_SYSTEM_PROMPT;
  const history: ChatMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter(
          (entry: unknown): entry is ChatMessage =>
            !!entry &&
            typeof (entry as ChatMessage).content === 'string' &&
            ((entry as ChatMessage).role === ChatRole.User || (entry as ChatMessage).role === ChatRole.Assistant),
        )
        .map((entry: ChatMessage) => ({ role: entry.role, content: entry.content }))
    : [];

  if (history.length === 0) return response.status(400).json({ error: 'At least one message is required.' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey) return response.status(500).json({ error: 'OPENROUTER_API_KEY is not configured.' });
  if (!model) return response.status(500).json({ error: 'OPENROUTER_MODEL is not configured.' });

  // Switch the connection over to Server-Sent Events before streaming anything.
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders?.();

  const send = (event: Record<string, unknown>) => response.write(`data: ${JSON.stringify(event)}\n\n`);

  // Abort the upstream request only if the client goes away *before* we finish.
  // We watch the response (not the request): a fully-received request can emit its
  // own 'close' as soon as the body is parsed, which would abort us prematurely.
  let finished = false;
  const controller = new AbortController();
  response.on('close', () => {
    if (!finished) controller.abort();
  });
  const finish = () => {
    finished = true;
    response.end();
  };

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: ChatRole.System, content: system }, ...history],
      }),
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const payload = (await upstream.json().catch(() => ({}))) as { error?: { message?: string } };
      send({ error: payload.error?.message ?? `OpenRouter request failed (${upstream.status}).` });
      return finish();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep the trailing partial line for the next chunk

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue; // skip blank lines & `:` keep-alive comments

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          send({ done: true });
          return finish();
        }

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string; reasoning?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.reasoning) send({ reasoning: delta.reasoning });
          if (delta?.content) send({ content: delta.content });
        } catch {
          // Ignore non-JSON payloads (comments / partial frames).
        }
      }
    }

    send({ done: true });
    finish();
  } catch (error) {
    if (controller.signal.aborted) return; // client disconnected; nothing to report
    const message = error instanceof Error ? error.message : 'Unexpected OpenRouter error.';
    send({ error: message });
    finish();
  }
});

app.listen(port, () => {
  console.log(`OpenRouter API listening on http://localhost:${port}`);
});
