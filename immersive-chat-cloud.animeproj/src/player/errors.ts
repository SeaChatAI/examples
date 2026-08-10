type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringField(record: UnknownRecord | null, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export class PromptBudgetError extends Error {
  constructor() {
    super('Memory budget is too low to build context. Raise memory depth and retry.');
    this.name = 'PromptBudgetError';
  }
}

export function formatSeaChatError(
  error: unknown,
  fallback = 'Failed to generate a reply. Please try again.',
): string {
  if (error instanceof PromptBudgetError) return error.message;

  const source = asRecord(error);
  const body = asRecord(source?.body);
  const envelope = asRecord(body?.error);
  const status = typeof source?.status === 'number' ? source.status : undefined;
  const technicalMessage =
    stringField(envelope, 'message')
    ?? stringField(body, 'message')
    ?? (error instanceof Error ? error.message : undefined);
  const requestId =
    stringField(envelope, 'request_id', 'requestId')
    ?? stringField(body, 'request_id', 'requestId')
    ?? stringField(source, 'requestId');
  const suffix = requestId ? ` (request id: ${requestId})` : '';

  if (
    technicalMessage
    && /invalid_api_key|api key is invalid|api[_\s-]?key.*(?:invalid|missing)/i.test(
      technicalMessage,
    )
  ) {
    return `Model API key is invalid or missing. Please sign in again.${suffix}`;
  }
  if (
    technicalMessage
    && /(?:\bmessages?\b\s+(?:is\s+)?(?:invalid|missing|empty|required)|\b(?:invalid|missing|empty)\s+messages?\b)/i.test(
      technicalMessage,
    )
    && !/api[_\s-]?key|unauthorized|401/i.test(technicalMessage)
  ) {
    return `Memory budget is too low to build context. Raise memory depth in settings and retry.${suffix}`;
  }
  if (error instanceof Error && error.name === 'APIConnectionTimeoutError') {
    return `Model timed out. Please retry.${suffix}`;
  }
  if (status === 401) return 'Session expired. Please sign in again.';
  if (status === 403) return `This account cannot use that model.${suffix}`;
  if (status === 429) return `Too many requests. Please wait a moment.${suffix}`;
  if (status !== undefined && status >= 500) {
    return `Model service is temporarily unavailable. Please try again later.${suffix}`;
  }
  if (status === 0 || (error instanceof Error && error.name === 'APIConnectionError')) {
    return 'Network error. Check your connection and retry.';
  }
  if (
    technicalMessage
    && /llmMode|WORLD_COMPUTE|Actor|session|revision|stub|gateway|redis|postgres|llm status|llm_stream/i.test(
      technicalMessage,
    )
  ) {
    return `${technicalMessage}${suffix}`;
  }
  if (status === 400 || status === 422) {
    return technicalMessage && !/^SeaChat request failed with status \d+$/i.test(technicalMessage)
      ? `${technicalMessage}${suffix}`
      : `This request could not be processed. Adjust your input or chat settings and retry.${suffix}`;
  }
  if (technicalMessage && !/^SeaChat request failed with status \d+$/i.test(technicalMessage)) {
    return technicalMessage;
  }
  return `${fallback}${suffix}`;
}
