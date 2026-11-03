/**
 * Realtime fan-out (PRD §10.4). Eventos do pipeline IA são publicados num
 * canal Redis por organização; o endpoint SSE (routes.ts) faz o fan-out
 * ao cliente. Sem entidade nova — payload é JSON livre por tipo de evento.
 */
import { getRedis } from "@/lib/redis.js";

export type RealtimeEventType =
  | "execution.updated"
  | "execution.traces"
  | "execution.stream"
  | "waitlist.offered";

export function realtimeChannel(orgId: string): string {
  return `realtime:${orgId}`;
}

export async function publishRealtime(
  orgId: string,
  type: RealtimeEventType,
  data: Record<string, unknown>,
): Promise<void> {
  await getRedis().publish(
    realtimeChannel(orgId),
    JSON.stringify({ type, data, ts: new Date().toISOString() }),
  );
}
