const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

function aiConfig() {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
  return {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model,
    researchModel: process.env.AI_RESEARCH_MODEL || 'claude-haiku-4-5',
    writerModel: process.env.AI_WRITER_MODEL || model,
  };
}

/** USD per million tokens. Cache writes bill at 1.25x input, cache reads at 0.1x. */
const PRICES = [
  [/haiku/i, { input: 1, output: 5 }],
  [/opus/i, { input: 5, output: 25 }],
  [/sonnet/i, { input: 3, output: 15 }],
];
const PRICE_PER_SEARCH = 0.01;

function priceFor(model) {
  return (PRICES.find(([re]) => re.test(model || '')) || PRICES[2])[1];
}

function estimateCost(usage, model) {
  const p = priceFor(model);
  const usd =
    ((usage.input_tokens || 0) * p.input +
      (usage.cache_write_tokens || 0) * p.input * 1.25 +
      (usage.cache_read_tokens || 0) * p.input * 0.1 +
      (usage.output_tokens || 0) * p.output) /
      1e6 +
    (usage.web_searches || 0) * PRICE_PER_SEARCH;
  return Math.round(usd * 10000) / 10000;
}

/**
 * Mark the end of the conversation so the next call re-reads everything before it from cache.
 * Only the newest breakpoint is kept (the API allows 4, and older ones add nothing here).
 */
function withCacheBreakpoint(messages) {
  const out = messages.map((m) => ({
    ...m,
    content: Array.isArray(m.content)
      ? m.content.map(({ cache_control, ...b }) => b)
      : m.content,
  }));
  const last = out[out.length - 1];
  if (!last || last.role !== 'user') return out;
  if (typeof last.content === 'string') {
    last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }];
  } else if (last.content.length) {
    const i = last.content.length - 1;
    last.content[i] = { ...last.content[i], cache_control: { type: 'ephemeral' } };
  }
  return out;
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
  total.cache_write_tokens += usage.cache_creation_input_tokens || usage.cache_write_tokens || 0;
  total.cache_read_tokens += usage.cache_read_input_tokens || usage.cache_read_tokens || 0;
  total.web_searches += usage.server_tool_use?.web_search_requests || usage.web_searches || 0;
  return total;
}

function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, web_searches: 0 };
}

module.exports = {
  claude,
  aiConfig,
  aiConfigured,
  addUsage,
  emptyUsage,
  estimateCost,
  withCacheBreakpoint,
};
