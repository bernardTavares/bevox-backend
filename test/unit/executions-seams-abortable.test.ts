/**
 * M5-P2a Item 9 — AbortSignal threading em deliverToChannel.
 * Spec: docs/superpowers/specs/2026-05-21-backend-m5-p2-tech-debt-design.md §4.6
 * Plan: docs/superpowers/plans/2026-05-21-backend-m5-p2a-tech-debt.md Task 7
 *
 * Testa apenas o helper abortableSleep (exportado). O wiring em
 * deliverToChannel é env-gated (RETRY_ABORTABLE default false em V1);
 * Marco 4 baseline preservado.
 */

import { describe, expect, it } from "vitest";

import { abortableSleep, AbortError } from "@/modules/executions/seams.js";

describe("abortableSleep (M5-P2a Item 9)", () => {
  it("resolves after ms when not aborted", async () => {
    const start = Date.now();
    await abortableSleep(50, new AbortController().signal);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it("rejects with AbortError when signal aborts mid-sleep", async () => {
    const ctrl = new AbortController();
    const p = abortableSleep(1000, ctrl.signal);
    setTimeout(() => ctrl.abort(), 50);
    await expect(p).rejects.toBeInstanceOf(AbortError);
  });

  it("rejects immediately if signal already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(abortableSleep(1000, ctrl.signal)).rejects.toBeInstanceOf(AbortError);
  });
});
