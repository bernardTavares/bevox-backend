ALTER TABLE "conversation_pipeline_state" RENAME COLUMN "chatwoot_account_id" TO "channel_account_id";--> statement-breakpoint
ALTER TABLE "message_records" RENAME COLUMN "chatwoot_message_id" TO "external_message_id";--> statement-breakpoint
ALTER INDEX "message_records_conversation_key_chatwoot_message_id_uniq" RENAME TO "message_records_conversation_key_external_message_id_uniq";