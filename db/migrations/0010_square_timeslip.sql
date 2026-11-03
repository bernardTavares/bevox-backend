CREATE TABLE "waitlist_match_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"slot_start_at" timestamp with time zone NOT NULL,
	"service_id" uuid,
	"professional_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_match_outbox_status_check" CHECK ("waitlist_match_outbox"."status" IN ('pending','processing','done','dead'))
);
--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_source_check";--> statement-breakpoint
ALTER TABLE "waitlist_entries" DROP CONSTRAINT "waitlist_entries_status_check";--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "priority_score" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "offer_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "matched_appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist_match_outbox" ADD CONSTRAINT "waitlist_match_outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_match_outbox" ADD CONSTRAINT "waitlist_match_outbox_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waitlist_match_outbox_status_created_idx" ON "waitlist_match_outbox" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_matched_appointment_id_appointments_id_fk" FOREIGN KEY ("matched_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_source_check" CHECK ("appointments"."source" IN ('ai','manual','external_sync','waitlist'));--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_status_check" CHECK ("waitlist_entries"."status" IN ('waiting','offered','accepted','expired','cancelled'));