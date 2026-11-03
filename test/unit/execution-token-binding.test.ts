/**
 * Execution-token binding: a token minted for execution A must not act on
 * execution B. The callbacks resolve the token to an execution_id; the
 * route's `:id` must equal it, otherwise 403 before any handler/DB work.
 */

import fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integration/harness-callbacks.repository.js", () => ({
  applyStatusTransition: vi.fn(async () => true),
  findExecution: vi.fn(async (id: string) => ({
    id,
    organization_id: "00000000-0000-7000-8000-0000000000aa",
    execution_mode: "manual_assisted",
    status: "running",
  })),
  finalizeCompletion: vi.fn(),
  insertExecutionAudit: vi.fn(),
  insertExecutionTraces: vi.fn(async () => 1),
  lockForCompletion: vi.fn(),
  markExecutionDeadLetter: vi.fn(async () => "marked"),
}));
vi.mock("@/modules/realtime/publish.js", () => ({ publishRealtime: vi.fn(async () => undefined) }));
vi.mock("@/lib/redis.js", () => ({
  getRedis: () => ({ rpush: vi.fn(async () => 1), expire: vi.fn(async () => 1) }),
}));

import errorHandlerPlugin from "@/plugins/error-handler.js";
import executionToken, {
  setExecutionTokenLookup,
  setExecutionTokenLookupAnyStatus,
} from "@/plugins/execution-token.js";
import { harnessCallbackRoutes } from "@/integration/harness-callbacks.routes.js";
import * as repo from "@/integration/harness-callbacks.repository.js";

const EXEC_A = "00000000-0000-7000-8000-00000000000a";
const EXEC_B = "00000000-0000-7000-8000-00000000000b";
const TOKEN_A = "a".repeat(64);

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  setExecutionTokenLookup(async () => EXEC_A);
  setExecutionTokenLookupAnyStatus(async () => EXEC_A);
  app = fastify();
  await app.register(errorHandlerPlugin);
  await app.register(executionToken);
  await app.register(harnessCallbackRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const headers = { "x-execution-token": TOKEN_A, "content-type": "application/json" };

describe("execution token is bound to its own execution", () => {
  it("PATCH /status on another execution → 403, no transition", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/executions/${EXEC_B}/status`,
      headers,
      payload: { status: "cancelled" },
    });
    expect(res.statusCode).toBe(403);
    expect(repo.applyStatusTransition).not.toHaveBeenCalled();
  });

  it("PATCH /status dead_letter on another execution → 403, nothing marked", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/executions/${EXEC_B}/status`,
      headers,
      payload: { status: "dead_letter" },
    });
    expect(res.statusCode).toBe(403);
    expect(repo.markExecutionDeadLetter).not.toHaveBeenCalled();
  });

  it("POST /traces on another execution → 403, nothing inserted", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/executions/${EXEC_B}/traces`,
      headers,
      payload: { traces: [] },
    });
    expect(res.statusCode).toBe(403);
    expect(repo.insertExecutionTraces).not.toHaveBeenCalled();
  });

  it("POST /stream on another execution → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/executions/${EXEC_B}/stream`,
      headers,
      payload: { index: 0, chunk: "x" },
    });
    expect(res.statusCode).toBe(403);
    expect(repo.findExecution).not.toHaveBeenCalled();
  });

  it("POST /complete on another execution → 403, nothing locked", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/executions/${EXEC_B}/complete`,
      headers,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(repo.findExecution).not.toHaveBeenCalled();
    expect(repo.lockForCompletion).not.toHaveBeenCalled();
  });

  it("PATCH /status on its own execution still works → 200", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/executions/${EXEC_A}/status`,
      headers,
      payload: { status: "cancelled" },
    });
    expect(res.statusCode).toBe(200);
    expect(repo.applyStatusTransition).toHaveBeenCalledWith(EXEC_A, "cancelled");
  });
});
