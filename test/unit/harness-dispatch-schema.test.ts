/**
 * Schema-level guard against media-only dispatch (M5-P3c follow-on:
 * `media-only-dispatch-empty-messages`).
 *
 * Historically the wire `DispatchPayload.messages` accepted an empty
 * array. Combined with `buildDispatchMessages` filtering on
 * `content_text IS NOT NULL`, a buffer window holding only media-only
 * inbounds would dispatch with `messages: []` — the harness would
 * invoke the IA with no content. `.min(1)` makes the schema reject such
 * payloads at the wire, complementing the runtime
 * `EmptyDispatchMessagesError` thrown by the repository builder.
 */
import { describe, expect, it, vi } from "vitest";

import {
  DispatchMessageSchema,
  DispatchPayloadSchema,
} from "@/integration/harness-dispatch.schema.js";

vi.mock("@/db/client.js", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@/db/client.js";

import {
  buildDispatchMessages,
  EmptyDispatchMessagesError,
} from "@/modules/orchestration/repository.js";

const mockGetDb = vi.mocked(getDb);

const ORG = "01956b00-0000-7000-8000-000000000001";
const CONV = "01956b00-0000-7000-8000-000000000002";
const CH = "01956b00-0000-7000-8000-000000000003";
const EXEC = "01956b00-0000-7000-8000-000000000004";
const TOKEN = "a".repeat(64);

function baseValidPayload() {
  return {
    execution_id: EXEC,
    execution_token: TOKEN,
    callback_base_url: "http://backend.local",
    organization_id: ORG,
    execution_mode: "manual_assisted" as const,
    conversation: { id: CONV, channel_account_id: CH },
    messages: [
      {
        role: "user" as const,
        content: "Olá",
        message_id: "01956b00-0000-7000-8000-00000000000a",
      },
    ],
    context: { timezone: "America/Sao_Paulo", locale: "pt-BR" },
    agent_config: { default_model: "openai/gpt-4o-mini", system_prompt: "x" },
    skills: [],
  };
}

describe("DispatchPayloadSchema.messages (.min(1) guard)", () => {
  it("accepts payload with at least one message", () => {
    expect(DispatchPayloadSchema.safeParse(baseValidPayload()).success).toBe(true);
  });

  it("rejects payload with messages: [] (media-only-dispatch guard)", () => {
    const bad = { ...baseValidPayload(), messages: [] };
    const parsed = DispatchPayloadSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      // Surface the explicit guard message so future drift is detected.
      const messagesIssue = parsed.error.issues.find(
        (i) => i.path.length === 1 && i.path[0] === "messages",
      );
      expect(messagesIssue?.message).toMatch(/at least one message/i);
    }
  });

  it("DispatchMessageSchema itself still validates a well-formed message", () => {
    expect(DispatchMessageSchema.safeParse({ role: "user", content: "hi" }).success).toBe(true);
  });
});

function dbReturning(rows: unknown[]) {
  mockGetDb.mockReturnValue({
    execute: vi.fn().mockResolvedValue({ rows }),
  } as unknown as ReturnType<typeof getDb>);
}

describe("buildDispatchMessages — media-only guard", () => {
  it("throws EmptyDispatchMessagesError when no text messages exist", async () => {
    // Media-only conversation: the WHERE `content_text IS NOT NULL`
    // clause filters out the image-only inbound at the SQL layer, so
    // the helper sees an empty rowset.
    dbReturning([]);
    await expect(buildDispatchMessages("conv-key-media-only")).rejects.toBeInstanceOf(
      EmptyDispatchMessagesError,
    );
  });

  it("includes the conversation key in the error for observability", async () => {
    dbReturning([]);
    try {
      await buildDispatchMessages("conv-key-xyz");
      expect.unreachable("expected EmptyDispatchMessagesError");
    } catch (err) {
      expect(err).toBeInstanceOf(EmptyDispatchMessagesError);
      expect((err as EmptyDispatchMessagesError).conversationKey).toBe("conv-key-xyz");
      expect((err as Error).message).toContain("conv-key-xyz");
    }
  });

  it("returns mapped messages when at least one text row exists", async () => {
    dbReturning([
      {
        external_message_id: "wamid.text.1",
        direction: "incoming",
        content_text: "Olá",
      },
    ]);
    const msgs = await buildDispatchMessages("conv-key-with-text");
    expect(msgs).toEqual([{ role: "user", content: "Olá", message_id: "wamid.text.1" }]);
  });
});

// Dispatch-contract amendment (canon PRD §10.4 + ADR-019 Amendment 1, aceito
// 2026-06-03): the wire payload carries an absolute wall-clock `deadline_ms`
// and, on replay, the lineage root `original_execution_id`.
describe("DispatchPayloadSchema — dispatch-contract amendment 2026-06-03", () => {
  const ROOT = "01956b00-0000-7000-8000-0000000000ff";

  it("preserves deadline_ms (epoch ms) when present", () => {
    const parsed = DispatchPayloadSchema.parse({
      ...baseValidPayload(),
      deadline_ms: 1_900_000_000_000,
    });
    expect(parsed.deadline_ms).toBe(1_900_000_000_000);
  });

  it("treats deadline_ms as optional (absent on parse)", () => {
    expect(DispatchPayloadSchema.parse(baseValidPayload()).deadline_ms).toBeUndefined();
  });

  it("rejects a non-integer deadline_ms", () => {
    expect(
      DispatchPayloadSchema.safeParse({ ...baseValidPayload(), deadline_ms: 12.5 }).success,
    ).toBe(false);
  });

  it("preserves original_execution_id (uuid) on replay payloads", () => {
    const parsed = DispatchPayloadSchema.parse({
      ...baseValidPayload(),
      original_execution_id: ROOT,
    });
    expect(parsed.original_execution_id).toBe(ROOT);
  });

  it("rejects a non-uuid original_execution_id", () => {
    expect(
      DispatchPayloadSchema.safeParse({ ...baseValidPayload(), original_execution_id: "nope" })
        .success,
    ).toBe(false);
  });
});
