ALTER TABLE "appointments" ADD COLUMN "customer_package_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_package_id_fk" FOREIGN KEY ("customer_package_id") REFERENCES "public"."customer_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_packages" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "service_packages" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "appointments_customer_package_idx" ON "appointments" USING btree ("organization_id","customer_package_id") WHERE customer_package_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_packages_charge_uniq" ON "customer_packages" USING btree ("organization_id","charge_id") WHERE charge_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "customer_packages_customer_idx" ON "customer_packages" USING btree ("organization_id","customer_id","status");--> statement-breakpoint
CREATE INDEX "customer_packages_expiry_idx" ON "customer_packages" USING btree ("status","valid_until") WHERE status = 'active' AND valid_until IS NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_packages" ADD CONSTRAINT "customer_packages_sessions_remaining_nonneg" CHECK ("customer_packages"."sessions_remaining" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "customer_packages" VALIDATE CONSTRAINT "customer_packages_sessions_remaining_nonneg";--> statement-breakpoint