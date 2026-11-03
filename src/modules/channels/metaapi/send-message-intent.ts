/**
 * Pure helpers — outbound message validate + build + idempotency key.
 *
 * Marco 4 P2. Mirrors meta-api sendMessageBodySchema shape (channel + to +
 * from? + type:'text' + content:{body}). V1 = text only; template/image
 * deferred per parent spec §12.
 *
 * Output:
 *  - kind:'ok' → { idempotencyKey, payload } ready para client.sendMessage
 *  - kind:'skip' → reason in {empty_text, missing_recipient}; caller decides DeliveryResult
 */

export interface SendMessageInput {
  channel: "whatsapp" | "instagram";
  to: string;
  from?: string;
  responseText: string;
  executionId: string;
}

export interface MetaApiSendBody {
  channel: "whatsapp" | "instagram";
  to: string;
  from?: string;
  type: "text";
  content: { body: string };
}

export type ValidationOutcome =
  | { kind: "ok"; idempotencyKey: string; payload: MetaApiSendBody }
  | { kind: "skip"; reason: "empty_text" | "missing_recipient" };

export function buildIdempotencyKey(executionId: string): string {
  return `delivery:${executionId}`;
}

export function validateAndBuild(input: SendMessageInput): ValidationOutcome {
  const trimmedText = input.responseText.trim();
  if (trimmedText.length === 0) {
    return { kind: "skip", reason: "empty_text" };
  }
  const trimmedTo = input.to.trim();
  if (trimmedTo.length === 0) {
    return { kind: "skip", reason: "missing_recipient" };
  }

  const payload: MetaApiSendBody = {
    channel: input.channel,
    to: trimmedTo,
    type: "text",
    content: { body: trimmedText },
  };
  if (input.from !== undefined) {
    payload.from = input.from;
  }

  return {
    kind: "ok",
    idempotencyKey: buildIdempotencyKey(input.executionId),
    payload,
  };
}
