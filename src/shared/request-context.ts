/**
 * Request-scoped context propagation via AsyncLocalStorage.
 *
 * Permite que qualquer função fundo do call-stack (service, repository,
 * worker, helper) recupere `requestId`, `organizationId`, `actorId` sem precisar
 * passá-los explicitamente. Cobre o caso onde uma fila ou callback escapa
 * do contexto Fastify mas ainda queremos correlation ID nos logs.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  // Carimbados pelos plugins clerk-auth / staff-auth / organization-scope
  // (Task 3) quando aplicáveis.
  organizationId?: string;
  actorType?: "organization_user" | "staff" | "system";
  actorId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Executa `fn` com o contexto associado. Qualquer chamada a `getContext()`
 * dentro de `fn` (ou em qualquer Promise/timer descendente) verá o ctx.
 */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Retorna o contexto atual ou `undefined` quando estamos fora de uma request
 * (ex.: bootstrap, scripts, cron).
 */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Atualiza campos do contexto atual em-place. Útil para plugins que descobrem
 * `organizationId`/`actorId` no meio da request.
 */
export function patchContext(patch: Partial<RequestContext>): void {
  const ctx = storage.getStore();
  if (ctx) Object.assign(ctx, patch);
}
