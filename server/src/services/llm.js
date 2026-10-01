const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

function aiConfig() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  };
}

function aiConfigured() {
  return Boolean(aiConfig().apiKey);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One Messages API call with retry on rate limits / overload. Returns the raw response JSON. */
async function claude({ system, messages, tools, toolChoice, maxTokens = 4096, model }) {
  const cfg = aiConfig();
  if (!cfg.apiKey) throw new Error('ANTHROPIC_API_KEY is not set on the server');

  const body = {
    model: model || cfg.model,
    max_tokens: maxTokens,
    messages,
    ...(system ? { system } : {}),
    ...(tools?.length ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
  };

  let lastErr;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    lastErr = new Error(data?.error?.message || `Claude API error ${res.status}`);
    if (!RETRYABLE.has(res.status)) break;
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
  }
  throw lastErr;
}

function addUsage(total, usage) {
  if (!usage) return total;
  total.input_tokens += usage.input_tokens || 0;
  total.output_tokens += usage.output_tokens || 0;
  total.web_searches += usage.server_tool_use?.web_search_requests || 0;
  return total;
}

function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, web_searches: 0 };
}

module.exports = { claude, aiConfig, aiConfigured, addUsage, emptyUsage };
