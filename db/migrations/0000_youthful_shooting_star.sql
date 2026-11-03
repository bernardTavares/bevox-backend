-- Postgres extensions (PRD bevox-backend §11.4). Devem existir ANTES
-- de qualquer DDL: gen_uuid_v7() é o nome canônico do gerador UUIDv7
-- (PRD §11.2/§11.4). As builds de pg_uuidv7 divergem no nome exposto
-- (`gen_uuid_v7` vs `uuid_generate_v7`); criamos um wrapper estável
-- `gen_uuid_v7()` que delega para o que a extensão prover, mantendo o
-- contrato do PRD independente da build da imagem.
CREATE EXTENSION IF NOT EXISTS pg_uuidv7;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DO $$
BEGIN
  IF to_regprocedure('public.gen_uuid_v7()') IS NULL THEN
    IF to_regprocedure('public.uuid_generate_v7()') IS NOT NULL THEN
      CREATE FUNCTION public.gen_uuid_v7() RETURNS uuid
        LANGUAGE sql VOLATILE PARALLEL SAFE
        AS 'SELECT public.uuid_generate_v7()';
    ELSIF to_regprocedure('public.uuidv7()') IS NOT NULL THEN
      CREATE FUNCTION public.gen_uuid_v7() RETURNS uuid
        LANGUAGE sql VOLATILE PARALLEL SAFE
        AS 'SELECT public.uuidv7()';
    ELSE
      RAISE EXCEPTION 'pg_uuidv7 não expõe gen_uuid_v7/uuid_generate_v7/uuidv7';
    END IF;
  END IF;
END$$;--> statement-breakpoint
CREATE TYPE "public"."ai_mode" AS ENUM('manual_assisted', 'copilot', 'autonomous_supervised');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_status" AS ENUM('pending', 'approved', 'edited', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_type" AS ENUM('reply', 'faq', 'rule', 'handoff', 'slot', 'charge');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'ai', 'system', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('active', 'archived', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."impersonation_category" AS ENUM('support', 'audit', 'incident');--> statement-breakpoint
CREATE TYPE "public"."onboarding_stage_enum" AS ENUM('welcome', 'business_profile', 'professionals', 'services', 'schedule', 'calendar_sync', 'channels', 'payments', 'knowledge', 'manual_assisted', 'copilot_active');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'disabled', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."professional_role_type" AS ENUM('provider', 'operator', 'provider_operator');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('bevox_admin', 'bevox_support', 'bevox_observer');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'operator', 'professional_viewer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_execution_id" uuid,
	"suggestion_type" "ai_suggestion_type" NOT NULL,
	"status" "ai_suggestion_status" DEFAULT 'pending' NOT NULL,
	"payload_json" jsonb NOT NULL,
	"rejection_reason_code" text,
	"rejection_reason_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" uuid,
	"reason_text" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"custom_duration_minutes" integer,
	"custom_price_amount" numeric(10, 2),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professionals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role_type" "professional_role_type" NOT NULL,
	"user_id" uuid,
	"bio" text,
	"is_bookable" boolean DEFAULT true NOT NULL,
	"can_take_handoffs" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_policies" (
	"service_id" uuid PRIMARY KEY NOT NULL,
	"booking_notice_minutes" integer,
	"reschedule_notice_minutes" integer,
	"cancel_notice_minutes" integer,
	"late_tolerance_minutes" integer,
	"fit_in_policy_json" jsonb,
	"waitlist_policy_json" jsonb,
	"payment_policy_json" jsonb,
	"handoff_policy_json" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"price_amount" numeric(10, 2),
	"currency" text NOT NULL,
	"max_concurrent" integer DEFAULT 1 NOT NULL,
	"buffer_before_minutes" integer,
	"buffer_after_minutes" integer,
	"allow_waitlist" boolean DEFAULT false NOT NULL,
	"allow_fit_in" boolean DEFAULT false NOT NULL,
	"max_fit_ins_per_slot" integer,
	"requires_prepayment" boolean DEFAULT false NOT NULL,
	"requires_human_approval" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_user_id" text NOT NULL,
	"display_name" text,
	"phone_number" text,
	"handle" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_facts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"fact_key" text NOT NULL,
	"fact_value" text NOT NULL,
	"category" text,
	"confidence" numeric(4, 3),
	"source_type" text NOT NULL,
	"source_execution_id" uuid,
	"superseded_by" uuid,
	"is_private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_facts_confidence_range" CHECK ("customer_facts"."confidence" >= 0 AND "customer_facts"."confidence" <= 1),
	CONSTRAINT "customer_facts_source_type_check" CHECK ("customer_facts"."source_type" IN ('ai_extracted','manual','imported'))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"preferred_name" text,
	"primary_phone" text,
	"primary_email" text,
	"notes_internal" text,
	"risk_flags_json" jsonb,
	"preferences_json" jsonb,
	"consent_granted_at" timestamp with time zone,
	"ai_opt_out" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"status" "customer_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"buffer_window_id" uuid,
	"execution_mode" text NOT NULL,
	"status" text NOT NULL,
	"execution_token_hash" text NOT NULL,
	"processing_endpoint_url" text NOT NULL,
	"processing_timeout_ms" integer NOT NULL,
	"dispatched_at" timestamp with time zone,
	"timeout_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executions_execution_mode_check" CHECK ("executions"."execution_mode" IN ('manual_assisted','copilot','autonomous_supervised')),
	CONSTRAINT "executions_status_check" CHECK ("executions"."status" IN ('pending','dispatching','processing','waiting_input','completing','waiting_approval','done','error','timeout','cancelled','dead_letter'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_active_at" timestamp with time zone,
	"clerk_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"default_reply_tone" text,
	"default_language" text,
	"allow_same_day_booking" boolean DEFAULT true NOT NULL,
	"default_booking_notice_minutes" integer,
	"default_cancel_notice_minutes" integer,
	"default_reschedule_notice_minutes" integer,
	"reminder_policy_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_name" text NOT NULL,
	"legal_name" text,
	"niche" text NOT NULL,
	"timezone" text NOT NULL,
	"currency" text NOT NULL,
	"locale" text NOT NULL,
	"onboarding_stage" "onboarding_stage_enum" DEFAULT 'welcome' NOT NULL,
	"ai_mode" "ai_mode" DEFAULT 'manual_assisted' NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"mfa_secret" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "staff_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_impersonations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"category" "impersonation_category" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"approved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "staff_refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_sha256" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_refresh_tokens_token_sha256_unique" UNIQUE("token_sha256")
);
--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_source_execution_id_executions_id_fk" FOREIGN KEY ("source_execution_id") REFERENCES "public"."executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_policies" ADD CONSTRAINT "service_policies_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_channels" ADD CONSTRAINT "customer_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_channels" ADD CONSTRAINT "customer_channels_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_facts" ADD CONSTRAINT "customer_facts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_facts" ADD CONSTRAINT "customer_facts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_facts" ADD CONSTRAINT "customer_facts_source_execution_id_executions_id_fk" FOREIGN KEY ("source_execution_id") REFERENCES "public"."executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_facts" ADD CONSTRAINT "customer_facts_superseded_by_fkey" FOREIGN KEY ("superseded_by") REFERENCES "public"."customer_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_impersonations" ADD CONSTRAINT "staff_impersonations_staff_id_staff_accounts_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_impersonations" ADD CONSTRAINT "staff_impersonations_approved_by_staff_accounts_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_refresh_tokens" ADD CONSTRAINT "staff_refresh_tokens_staff_id_staff_accounts_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_created_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "professional_services_org_prof_service_uniq" ON "professional_services" USING btree ("organization_id","professional_id","service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_channels_org_provider_external_uniq" ON "customer_channels" USING btree ("organization_id","provider","external_user_id");--> statement-breakpoint
CREATE INDEX "idx_customer_facts_active" ON "customer_facts" USING btree ("organization_id","customer_id") WHERE superseded_by IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_executions_token_hash" ON "executions" USING btree ("execution_token_hash") WHERE status NOT IN ('done','error','cancelled','dead_letter');--> statement-breakpoint
CREATE UNIQUE INDEX "users_clerk_user_id_uniq" ON "users" USING btree ("clerk_user_id");--> statement-breakpoint
-- PRD §11.2: IDs UUIDv7 com DEFAULT gen_uuid_v7() no servidor
-- (app também gera via $defaultFn; o default cobre inserts SQL diretos).
ALTER TABLE "ai_suggestions" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "professional_services" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "professionals" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "customer_channels" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "customer_facts" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "executions" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "staff_accounts" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "staff_impersonations" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();--> statement-breakpoint
ALTER TABLE "staff_refresh_tokens" ALTER COLUMN "id" SET DEFAULT gen_uuid_v7();
