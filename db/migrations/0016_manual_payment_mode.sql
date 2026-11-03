ALTER TABLE "charges" DROP CONSTRAINT "charges_payment_method_check";--> statement-breakpoint
ALTER TABLE "payment_accounts" DROP CONSTRAINT "payment_accounts_provider_check";--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_provider_status_uniq" ON "payments" USING btree ("organization_id","provider_payment_id","status");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_payment_method_check" CHECK ("charges"."payment_method" IS NULL OR "charges"."payment_method" IN ('pix','payment_link','cash','pix_manual','bank_transfer','boleto_manual','card_manual','other'));--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_provider_check" CHECK ("payment_accounts"."provider" IN ('stripe','manual'));