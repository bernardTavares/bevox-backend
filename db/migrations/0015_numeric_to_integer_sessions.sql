-- M5-P2a Item 6: numeric → integer migration on customer_packages.sessions_*
-- AND service_packages.sessions_included.
-- Spec: docs/superpowers/specs/2026-05-21-backend-m5-p2-tech-debt-design.md §4.3
-- Risk-7 maintenance window deployment required (pg-types text protocol
-- returns INTEGER as JS number imediato após ALTER → old pods quebram
-- até deploy de novos types). Single-phase ALTER + redeploy app sequencial.

-- Embedded validation step (Agent #3-R1 SEV-H fix): auto-abort se prod
-- data tem decimais (não deveria existir, defensive — schema Zod já
-- rejeita float ao insert via .int(), mas validamos defensive contra
-- bypass histórico ou dados de migration manual).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM customer_packages
     WHERE sessions_total <> trunc(sessions_total)
        OR sessions_used <> trunc(sessions_used)
        OR sessions_remaining <> trunc(sessions_remaining)
  ) THEN
    RAISE EXCEPTION 'm5-p2-migration-0015-block: fractional sessions present in customer_packages; investigate before re-run.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM service_packages
     WHERE sessions_included <> trunc(sessions_included)
  ) THEN
    RAISE EXCEPTION 'm5-p2-migration-0015-block: fractional sessions_included present in service_packages; investigate before re-run.';
  END IF;
END $$;
--> statement-breakpoint

-- Agent #3-R2 LOW-1 fix: lock_timeout fail-fast em 30s vs bloqueio
-- indefinido em ACCESS EXCLUSIVE lock contention. SET LOCAL escopo
-- transação Drizzle (cada arquivo roda em transaction).
SET LOCAL lock_timeout = '30s';
--> statement-breakpoint
ALTER TABLE "customer_packages" ALTER COLUMN "sessions_total" SET DATA TYPE integer USING sessions_total::integer;--> statement-breakpoint
ALTER TABLE "customer_packages" ALTER COLUMN "sessions_used" SET DATA TYPE integer USING sessions_used::integer;--> statement-breakpoint
ALTER TABLE "customer_packages" ALTER COLUMN "sessions_remaining" SET DATA TYPE integer USING sessions_remaining::integer;--> statement-breakpoint
ALTER TABLE "service_packages" ALTER COLUMN "sessions_included" SET DATA TYPE integer USING sessions_included::integer;
