/**
 * Schema de ingestão — PRD §11.2 (received_events, message_records).
 * PK UUIDv7 (ADR-001). `received_events` sem tenant FK (ingestão crua, fiel).
 */

import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { createdAt, uuidFk, uuidv7PrimaryKey } from "./_shared.js";

export const receivedEvents = pgTable(
  "received_events",
  {
    id: uuidv7PrimaryKey(),
    source: text("source").notNull(),
    sourceEventKey: text("source_event_key").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: jsonb("payload_json"),
    normalizedPayloadJson: jsonb("normalized_payload_json"),
    receivedAt: createdAt(),
    signatureValid: boolean("signature_valid"),
  },
  (table) => ({
    sourceKeyUniq: uniqueIndex("received_events_source_source_event_key_uniq").on(
      table.source,
      table.sourceEventKey,
    ),
  }),
);

export const messageRecords = pgTable(
  "message_records",
  {
    id: uuidv7PrimaryKey(),
    receivedEventId: uuidFk("received_event_id").references(() => receivedEvents.id, {
      onDelete: "set null",
    }),
    conversationKey: text("conversation_key").notNull(),
    externalMessageId: text("external_message_id").notNull(),
    direction: text("direction").notNull(),
    contentText: text("content_text"),
    messageCreatedAt: timestamp("message_created_at", {
      withTimezone: true,
      mode: "date",
    }),
    senderSnapshotJson: jsonb("sender_snapshot_json"),
    mediaJson: jsonb("media_json"),
  },
  (table) => ({
    convKeyMsgIdUniq: uniqueIndex("message_records_conversation_key_external_message_id_uniq").on(
      table.conversationKey,
      table.externalMessageId,
    ),
  }),
);

export type ReceivedEvent = typeof receivedEvents.$inferSelect;
export type NewReceivedEvent = typeof receivedEvents.$inferInsert;
export type MessageRecord = typeof messageRecords.$inferSelect;
export type NewMessageRecord = typeof messageRecords.$inferInsert;
