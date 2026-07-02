import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 8787);

enum ChatRole {
  System = 'system',
  User = 'user',
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
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
    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'Arbiter',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: ChatRole.System,
            content: 'You are an AI commander assistant for a 2D RTS browser game prototype.',
          },
          {
            role: ChatRole.User,
            content: prompt,
          },
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

app.listen(port, () => {
  console.log(`OpenRouter API listening on http://localhost:${port}`);
});
