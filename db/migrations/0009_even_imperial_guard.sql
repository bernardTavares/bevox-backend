CREATE TABLE "appointment_google_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"google_connection_id" uuid NOT NULL,
	"google_event_id" text NOT NULL,
	"google_etag" text,
	"last_direction" text NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "age_direction_check" CHECK ("appointment_google_events"."last_direction" IN ('push','pull'))
);
--> statement-breakpoint
CREATE TABLE "calendar_provider_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"professional_id" uuid,
	"provider" text DEFAULT 'google' NOT NULL,
	"sync_mode" text DEFAULT 'two_way' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"google_account_email" text,
	"external_calendar_id" text DEFAULT 'primary' NOT NULL,
	"google_refresh_token_encrypted" "bytea",
	"google_access_token_encrypted" "bytea",
	"google_access_token_expires_at" timestamp with time zone,
	"google_watch_channel_id" text,
	"google_watch_resource_id" text,
	"google_watch_expires_at" timestamp with time zone,
	"google_sync_token" text,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cpc_sync_mode_check" CHECK ("calendar_provider_connections"."sync_mode" IN ('read_only','two_way')),
	CONSTRAINT "cpc_status_check" CHECK ("calendar_provider_connections"."status" IN ('connected','token_expired','revoked','error'))
);
--> statement-breakpoint
CREATE TABLE "google_calendar_webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"google_connection_id" uuid NOT NULL,
	"channel_id" text,
	"resource_id" text,
	"resource_state" text,
	"message_number" text,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_sync_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"op" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "gso_op_check" CHECK ("google_sync_outbox"."op" IN ('create','update','delete')),
	CONSTRAINT "gso_status_check" CHECK ("google_sync_outbox"."status" IN ('pending','processing','done','error','skipped'))
);
--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_source_check";--> statement-breakpoint
ALTER TABLE "appointment_google_events" ADD CONSTRAINT "appointment_google_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_google_events" ADD CONSTRAINT "appointment_google_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_google_events" ADD CONSTRAINT "appointment_google_events_google_connection_id_calendar_provider_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."calendar_provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_provider_connections" ADD CONSTRAINT "calendar_provider_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_provider_connections" ADD CONSTRAINT "calendar_provider_connections_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_provider_connections" ADD CONSTRAINT "calendar_provider_connections_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar_webhook_events" ADD CONSTRAINT "google_calendar_webhook_events_google_connection_id_calendar_provider_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."calendar_provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_sync_outbox" ADD CONSTRAINT "google_sync_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_sync_outbox" ADD CONSTRAINT "google_sync_outbox_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "age_conn_event_uniq" ON "appointment_google_events" USING btree ("google_connection_id","google_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "age_appt_conn_uniq" ON "appointment_google_events" USING btree ("appointment_id","google_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cpc_cal_prof_provider_uniq" ON "calendar_provider_connections" USING btree ("calendar_id","professional_id","provider") WHERE professional_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cpc_cal_provider_uniq" ON "calendar_provider_connections" USING btree ("calendar_id","provider") WHERE professional_id IS NULL;--> statement-breakpoint
CREATE INDEX "gcwe_conn_received_idx" ON "google_calendar_webhook_events" USING btree ("google_connection_id","received_at");--> statement-breakpoint
CREATE INDEX "gso_pending_idx" ON "google_sync_outbox" USING btree ("created_at") WHERE status = 'pending';--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_source_check" CHECK ("appointments"."source" IN ('ai','manual','external_sync'));