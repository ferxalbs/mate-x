import OpenAI from 'openai';

const RAINY_BASE_URL = 'https://api.rainy.dev/v3';
const DEFAULT_RAINY_MODEL = 'rainy-coder-security';

async function getRainyClient(): Promise<OpenAI> {
  const apiKey = await window.mate?.settings?.getApiKey();
  if (!apiKey) {
    throw new Error('Rainy API key is not configured. Add it in Settings to start using MaTE X.');
  }

  return new OpenAI({
    apiKey,
    baseURL: RAINY_BASE_URL,
    dangerouslyAllowBrowser: true,
  });
}

export async function chatStream(prompt: string, onUpdate: (chunk: string) => void) {
  const client = await getRainyClient();
  const stream = await client.chat.completions.create({
    model: DEFAULT_RAINY_MODEL,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content ?? '';
    if (content) {
      onUpdate(content);
    }
  }
}
