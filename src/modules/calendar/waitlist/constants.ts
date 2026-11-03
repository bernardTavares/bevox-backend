/** C3 Waitlist — nomes de fila/job/cron + chaves Redis. */
export const WAITLIST_MATCH_QUEUE = "bevox.waitlist.match";
export const WAITLIST_MATCH_JOB_NAME = "waitlist-match";
export const WAITLIST_MATCH_SWEEP_JOB_NAME = "waitlist-match-sweep";

/** Single-flight por calendário (mesma higiene de google/lock.ts). */
export function waitlistMatchLockKey(calendarId: string): string {
  return `waitlist:match:lock:${calendarId}`;
}
/** TTL do single-flight (s). Match é curto; 60s cobre folga. */
export const WAITLIST_MATCH_LOCK_TTL_SECONDS = 60;

/** Idempotência da action seam waitlist-add (espelha booking:idem:). */
export function waitlistIdemKey(orgId: string, key: string): string {
  return `waitlist:idem:${orgId}:${key}`;
}
export const WAITLIST_IDEM_TTL_SECONDS = 86400;
