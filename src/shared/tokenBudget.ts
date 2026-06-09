const DEFAULT_CONTEXT_LIMIT = 128000;
const DEFAULT_RESERVE_TOKENS = 1024;
const CONTEXT_LIMITS: Array<{ pattern: RegExp; limit: number }> = [
  { pattern: /135168|kimi-k2|k2\.5|moonshot-v1-128k/i, limit: 135168 },
  { pattern: /128k|128000|131072|gpt-4\.1|gpt-4o|deepseek|qwen|glm|doubao/i, limit: 128000 },
  { pattern: /32k|32768/i, limit: 32768 },
  { pattern: /16k|16384/i, limit: 16384 },
  { pattern: /8k|8192/i, limit: 8192 }
];

function estimateTokensFromText(text: string): number {
  const asciiChars = text.replace(/[^\x00-\x7F]/g, "").length;
  const nonAsciiChars = text.length - asciiChars;
  return Math.ceil(asciiChars / 4 + nonAsciiChars * 1.5);
}

export function getModelContextLimit(model: string): number {
  const matched = CONTEXT_LIMITS.find((item) => item.pattern.test(model));
  return matched?.limit ?? DEFAULT_CONTEXT_LIMIT;
}

export function estimatePayloadTokens(payload: unknown): number {
  return estimateTokensFromText(JSON.stringify(payload));
}

export function resolveMaxOutputTokens(input: {
  configuredMaxTokens: number;
  model: string;
  payloadForInputEstimate: unknown;
  minimumOutputTokens?: number;
  reserveTokens?: number;
}): number {
  const configured = Number.isFinite(input.configuredMaxTokens)
    ? Math.max(1, Math.floor(input.configuredMaxTokens))
    : 1;
  const contextLimit = getModelContextLimit(input.model);
  const reserveTokens = input.reserveTokens ?? 1024;
  const minimumOutputTokens = input.minimumOutputTokens ?? 256;
  const estimatedInputTokens = estimatePayloadTokens(input.payloadForInputEstimate);
  const availableOutputTokens = contextLimit - estimatedInputTokens - reserveTokens;

  if (availableOutputTokens <= 0) {
    return Math.min(configured, minimumOutputTokens);
  }

  return Math.max(1, Math.min(configured, Math.max(minimumOutputTokens, availableOutputTokens)));
}

export function getInputTokenBudget(input: {
  configuredMaxTokens: number;
  model: string;
  reserveTokens?: number;
}): number {
  const contextLimit = getModelContextLimit(input.model);
  const reserveTokens = input.reserveTokens ?? DEFAULT_RESERVE_TOKENS;
  const desiredOutputTokens = Number.isFinite(input.configuredMaxTokens)
    ? Math.max(1, Math.floor(input.configuredMaxTokens))
    : 1;
  return Math.max(1, contextLimit - desiredOutputTokens - reserveTokens);
}

export function trimArrayToEstimatedTokenBudget<T>(input: {
  items: T[];
  headCount?: number;
  budgetTokens: number;
  estimatePayload: (items: T[]) => unknown;
}): T[] {
  const { items, budgetTokens, estimatePayload } = input;
  const headCount = Math.max(0, Math.min(items.length, input.headCount ?? 0));
  if (items.length <= headCount) {
    return items;
  }

  if (estimatePayloadTokens(estimatePayload(items)) <= budgetTokens) {
    return items;
  }

  const head = items.slice(0, headCount);
  const tail = items.slice(headCount);
  const keptTail: T[] = [];

  for (let index = tail.length - 1; index >= 0; index -= 1) {
    keptTail.unshift(tail[index]);
    const candidate = [...head, ...keptTail];
    if (estimatePayloadTokens(estimatePayload(candidate)) > budgetTokens) {
      keptTail.shift();
      break;
    }
  }

  if (keptTail.length === 0 && tail.length > 0) {
    keptTail.push(tail[tail.length - 1]);
  }

  return [...head, ...keptTail];
}
