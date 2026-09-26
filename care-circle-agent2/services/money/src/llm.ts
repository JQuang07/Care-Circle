import OpenAI from 'openai';

/** Minimal JSON-output LLM interface so tests and the eval can swap in fakes. */
export interface Llm {
  json(system: string, user: string, schemaName: string, schema: Record<string, unknown>): Promise<unknown>;
}

/** Muse Spark via the openai SDK, using structured output (JSON schema). */
export function museLlm(env: { META_API_KEY: string; MUSE_MODEL?: string; MUSE_BASE_URL?: string }): Llm {
  const client = new OpenAI({
    apiKey: env.META_API_KEY,
    baseURL: env.MUSE_BASE_URL || 'https://api.meta.ai/v1',
    timeout: 8000,
    maxRetries: 1,
  });
  const model = env.MUSE_MODEL || 'muse-spark-1.1';
  return {
    async json(system, user, name, schema) {
      const res = await client.chat.completions.create({
        model,
        temperature: 0,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } },
      });
      const text = res.choices[0]?.message?.content ?? '';
      return JSON.parse(text.replace(/```json|```/g, '').trim());
    },
  };
}
