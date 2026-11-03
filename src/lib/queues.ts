/**
 * BullMQ queues — fábricas centralizadas para evitar drift de configuração.
 *
 * Cada Worker/QueueScheduler precisa de conexão Redis dedicada com
 * `maxRetriesPerRequest: null` (createBullMQConnection já cuida disso).
 *
 * Convenções:
 *   - removeOnComplete TTL 7 dias.
 *   - attempts: 7 com backoff exponencial 5s base (5+10+20+40+80+160+320
 *     = ~635s total retry window — absorve RDS Multi-AZ failover ~60-120s
 *     sem storm). Bump de 5→7 em M5-P2a T9 (Agent #3-R3 LOW-1).
 *   - jobId = UUIDv7 → idempotência da inserção (produtor que tenta
 *     enfileirar 2x não duplica).
 *
 * Marco 1 define apenas `bevox.execution.dispatch` (PRD bevox-backend §7.4:
 * backend orchestration → harness). As demais filas §7.4
 * (cutoff.jobs, reminders, timeout-watcher, google.watch.renewal,
 * waitlist.match, suggestion.expiration) entram em Marco 2+.
 */

import { Queue, type JobsOptions } from "bullmq";

import {
  GOOGLE_INCREMENTAL_SYNC_QUEUE,
  GOOGLE_PUSH_QUEUE,
} from "@/modules/calendar/google/constants.js";
import { WAITLIST_MATCH_QUEUE } from "@/modules/calendar/waitlist/constants.js";
import { uuidv7 } from "@/shared/uuid.js";

import { createBullMQConnection } from "./redis.js";

export const EXECUTION_DISPATCH_QUEUE = "bevox.execution.dispatch";
export const INGESTION_EVENT_QUEUE = "bevox.ingestion.event";
export const BUFFER_CUTOFF_QUEUE = "bevox.buffer.cutoff";

const SEVEN_DAYS_SECONDS = 7 * 24 * 3600;

// M5-P2a T9 (Agent #3-R3 LOW-1, spec §4.8): attempts cap 7 + exponential
// backoff 5s base → retry window 5+10+20+40+80+160+320 = ~635s.
// SEV-L-2 propagate-and-retry semantic em src/modules/executions/seams.ts
// (findExecutionDeliveryContext + findMetaApiTenant) só é safe COM cap
// definido — sem cap, DB-down dispara storm. Cap absorve RDS Multi-AZ
// failover (~60-120s) sem manual reconcile + DLQs após ~10min outage.
// Audit vocabulary action='retry_exhausted' (entity_type='execution')
// emitido quando BullMQ DLQs job após attempts exhausted.
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 7,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: SEVEN_DAYS_SECONDS, count: 10_000 },
  removeOnFail: { age: SEVEN_DAYS_SECONDS, count: 5_000 },
};

let executionDispatch: Queue | null = null;

export function getExecutionDispatchQueue(): Queue {
  if (!executionDispatch) {
    executionDispatch = new Queue(EXECUTION_DISPATCH_QUEUE, {
      connection: createBullMQConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return executionDispatch;
}

let ingestionEvent: Queue | null = null;

export function getIngestionEventQueue(): Queue {
  if (!ingestionEvent) {
    ingestionEvent = new Queue(INGESTION_EVENT_QUEUE, {
      connection: createBullMQConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return ingestionEvent;
}

let bufferCutoff: Queue | null = null;

export function getBufferCutoffQueue(): Queue {
  if (!bufferCutoff) {
    bufferCutoff = new Queue(BUFFER_CUTOFF_QUEUE, {
      connection: createBullMQConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return bufferCutoff;
}

let googlePush: Queue | null = null;

/** C2 Google — fila de drain do outbox (push backend→Google). */
export function getGooglePushQueue(): Queue {
  if (!googlePush) {
    googlePush = new Queue(GOOGLE_PUSH_QUEUE, {
      connection: createBullMQConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return googlePush;
}

let googleIncremental: Queue | null = null;

/** C2 Google — fila de incremental sync (pull Google→backend, por conexão). */
export function getGoogleIncrementalQueue(): Queue {
  if (!googleIncremental) {
    googleIncremental = new Queue(GOOGLE_INCREMENTAL_SYNC_QUEUE, {
      connection: createBullMQConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return googleIncremental;
}

let waitlistMatch: Queue | null = null;

/** C3 Waitlist — fila de match (drena waitlist_match_outbox). */
export function getWaitlistMatchQueue(): Queue {
  if (!waitlistMatch) {
    waitlistMatch = new Queue(WAITLIST_MATCH_QUEUE, {
      connection: createBullMQConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return waitlistMatch;
}

/**
 * Gera um jobId UUIDv7 para enfileiramento idempotente.
 */
export function newJobId(): string {
  return uuidv7();
}

export async function closeQueues(): Promise<void> {
  if (executionDispatch) {
    await executionDispatch.close();
    executionDispatch = null;
  }
  if (ingestionEvent) {
    await ingestionEvent.close();
    ingestionEvent = null;
  }
  if (bufferCutoff) {
    await bufferCutoff.close();
    bufferCutoff = null;
  }
  if (googlePush) {
    await googlePush.close();
    googlePush = null;
  }
  if (googleIncremental) {
    await googleIncremental.close();
    googleIncremental = null;
  }
  if (waitlistMatch) {
    await waitlistMatch.close();
    waitlistMatch = null;
  }
}

export function __resetQueuesForTests(): void {
  executionDispatch = null;
  ingestionEvent = null;
  bufferCutoff = null;
  googlePush = null;
  googleIncremental = null;
  waitlistMatch = null;
}
