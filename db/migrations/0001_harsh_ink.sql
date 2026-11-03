CREATE TABLE "buffer_windows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"inbox_id" uuid,
	"conversation_id" uuid,
	"conversation_key" text NOT NULL,
	"window_sequence" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cutoff_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"latest_execution_id" uuid,
	"latest_execution_status" text
);
--> statement-breakpoint
CREATE TABLE "conversation_pipeline_state" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"conversation_key" text NOT NULL,
	"external_conversation_id" text,
	"chatwoot_account_id" text,
	"pipeline_status" text,
	"active_execution_id" uuid,
	"version" text DEFAULT '1' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel_connection_id" uuid,
	"customer_channel_id" uuid,
	"status" text NOT NULL,
	"current_owner_type" text NOT NULL,
	"current_owner_id" uuid,
	"last_intent" text,
	"last_message_at" timestamp with time zone,
	"linked_appointment_id" uuid,
	"priority_score" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_status_check" CHECK ("conversations"."status" IN ('open','waiting_human','waiting_customer','closed')),
	CONSTRAINT "conversations_current_owner_type_check" CHECK ("conversations"."current_owner_type" IN ('ai','user','queue'))
);
--> statement-breakpoint
CREATE TABLE "execution_traces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"step_type" text NOT NULL,
	"step_name" text NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"ingest_status" text DEFAULT 'ingested' NOT NULL,
	"ingest_attempts" integer DEFAULT 0 NOT NULL,
	"ingest_error" text,
	"input_json" jsonb,
	"output_json" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"received_event_id" uuid,
	"conversation_key" text NOT NULL,
	"chatwoot_message_id" text NOT NULL,
	"direction" text NOT NULL,
	"content_text" text,
	"message_created_at" timestamp with time zone,
	"sender_snapshot_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "received_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb,
	"normalized_payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_valid" boolean
);
--> statement-breakpoint
ALTER TABLE "buffer_windows" ADD CONSTRAINT "buffer_windows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buffer_windows" ADD CONSTRAINT "buffer_windows_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_pipeline_state" ADD CONSTRAINT "conversation_pipeline_state_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_pipeline_state" ADD CONSTRAINT "conversation_pipeline_state_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_traces" ADD CONSTRAINT "execution_traces_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_traces" ADD CONSTRAINT "execution_traces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_records" ADD CONSTRAINT "message_records_received_event_id_received_events_id_fk" FOREIGN KEY ("received_event_id") REFERENCES "public"."received_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_buffer_windows_open_cutoff" ON "buffer_windows" USING btree ("cutoff_at") WHERE state = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_pipeline_state_conversation_key_uniq" ON "conversation_pipeline_state" USING btree ("conversation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_pipeline_state_conversation_id_uniq" ON "conversation_pipeline_state" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_org_status_idx" ON "conversations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "conversations_org_last_message_at_idx" ON "conversations" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "idx_execution_traces_execution_id" ON "execution_traces" USING btree ("execution_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_execution_traces_critical" ON "execution_traces" USING btree ("execution_id","is_critical","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_records_conversation_key_chatwoot_message_id_uniq" ON "message_records" USING btree ("conversation_key","chatwoot_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "received_events_source_source_event_key_uniq" ON "received_events" USING btree ("source","source_event_key");--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_buffer_window_id_buffer_windows_id_fk" FOREIGN KEY ("buffer_window_id") REFERENCES "public"."buffer_windows"("id") ON DELETE set null ON UPDATE no action;