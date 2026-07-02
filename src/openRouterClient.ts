export interface ChatPromptResponse {
  message: string;
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
