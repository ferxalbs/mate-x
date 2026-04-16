import OpenAI from 'openai';

// Since this is a client-side Electron app, for a real deployment 
// the user would likely provide this via settings. For now we use the env map.
const getClient = () => {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY || localStorage.getItem('openai_api_key');
  if (!apiKey) {
    throw new Error('OpenAI API key is missing. Please set VITE_OPENAI_API_KEY or save it in settings.');
  }

  return new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true // This is required since we run in the renderer process
  });
};

export async function chatStream(prompt: string, onUpdate: (chunk: string) => void) {
  const openai = getClient();
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o', // Fast default model
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      onUpdate(content);
    }
  }
}
