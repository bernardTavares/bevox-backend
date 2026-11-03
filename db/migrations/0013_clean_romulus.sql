CREATE TABLE "channel_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"url" text NOT NULL,
	"signing_secret_ciphertext" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_subscriptions_subscription_id_unique" UNIQUE("subscription_id")
);
--> statement-breakpoint
CREATE TABLE "organization_meta_api_tenant" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"meta_api_tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_meta_api_tenant_meta_api_tenant_id_unique" UNIQUE("meta_api_tenant_id")
);
--> statement-breakpoint
ALTER TABLE "organization_meta_api_tenant" ADD CONSTRAINT "organization_meta_api_tenant_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;