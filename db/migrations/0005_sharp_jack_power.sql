ALTER TABLE "ai_suggestions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ai_suggestions" CASCADE;--> statement-breakpoint
ALTER TABLE "executions" DROP CONSTRAINT "executions_status_check";--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_status_check" CHECK ("executions"."status" IN ('pending','dispatching','processing','waiting_input','completing','waiting_approval','done','error','timeout','cancelled','dead_letter','rejected','expired'));--> statement-breakpoint
DROP TYPE "public"."ai_suggestion_status";--> statement-breakpoint
DROP TYPE "public"."ai_suggestion_type";