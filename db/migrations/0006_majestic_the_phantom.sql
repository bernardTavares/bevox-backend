CREATE TABLE "staff_manual_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"execution_id" uuid,
	"buffer_window_id" uuid,
	"action_type" text NOT NULL,
	"reason" text NOT NULL,
	"actor_staff_id" text NOT NULL,
	"request_payload_json" jsonb,
	"result_snapshot_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_manual_actions" ADD CONSTRAINT "staff_manual_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_manual_actions" ADD CONSTRAINT "staff_manual_actions_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_manual_actions" ADD CONSTRAINT "staff_manual_actions_buffer_window_id_buffer_windows_id_fk" FOREIGN KEY ("buffer_window_id") REFERENCES "public"."buffer_windows"("id") ON DELETE set null ON UPDATE no action;