CREATE TABLE "channel_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"routing_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"operating_hours_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_connections_status_check" CHECK ("channel_connections"."status" IN ('pending','connected','error','revoked'))
);
--> statement-breakpoint
ALTER TABLE "buffer_windows" RENAME COLUMN "inbox_id" TO "channel_connection_id";--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_org_provider_external_account_uniq" ON "channel_connections" USING btree ("organization_id","provider","external_account_id");--> statement-breakpoint
ALTER TABLE "buffer_windows" ADD CONSTRAINT "buffer_windows_channel_connection_id_channel_connections_id_fk" FOREIGN KEY ("channel_connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_connection_id_channel_connections_id_fk" FOREIGN KEY ("channel_connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_channel_id_customer_channels_id_fk" FOREIGN KEY ("customer_channel_id") REFERENCES "public"."customer_channels"("id") ON DELETE set null ON UPDATE no action;