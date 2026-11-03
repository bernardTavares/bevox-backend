CREATE TABLE "autonomy_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"current_mode" "ai_mode" DEFAULT 'manual_assisted' NOT NULL,
	"allowed_actions_json" jsonb,
	"required_approvals_json" jsonb,
	"confidence_thresholds_json" jsonb,
	"readiness_score" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "autonomy_profiles" ADD CONSTRAINT "autonomy_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autonomy_profiles_organization_id_uniq" ON "autonomy_profiles" USING btree ("organization_id");