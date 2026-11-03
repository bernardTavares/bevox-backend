/**
 * Payments P4 — cron handler de expiry de CustomerPackage. Cron noturno
 * (PACKAGE_EXPIRY_CRON, default "0 2 * * *"). Idempotente: re-run não
 * re-expira (WHERE status='active'). Audit batch via insertPackageAudit.
 */
import * as repo from "./repository.js";
import { logger } from "@/shared/logger.js";

export const PACKAGE_EXPIRY_QUEUE = "bevox.package.expiry";
export const PACKAGE_EXPIRY_JOB_NAME = "package-expiry-sweep";

export async function handlePackageExpirySweep(): Promise<void> {
  const log = logger();
  try {
    const out = await repo.expireDuePackages();
    const expired = out.expiredIds.length;
    for (const row of out.expiredIds) {
      await repo.insertPackageAudit({
        organizationId: row.organization_id,
        customerPackageId: row.id,
        action: "package.expired_by_cron",
        actorType: "system",
        afterJson: { cron_run_at: new Date().toISOString() },
      });
    }
    log.info({ expired_count: expired }, "package-expiry sweep done");
  } catch (err) {
    log.error({ err }, "package-expiry sweep failed");
    throw err; // BullMQ marks job failed; cron next-tick retries.
  }
}
