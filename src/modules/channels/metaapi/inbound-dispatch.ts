/**
 * Pure helper — extract message_records-ready fields from a
 * `message.received` envelope.
 *
 * M5-P3c: returns the BASE fields for ANY valid `message.received`, with
 * `contentText: string | null` (null = message sem texto, ex. media-only).
 * Antes (M4 P4) non-text retornava null e o dispatch dropava media-only
 * silenciosamente — CRITICAL bug corrigido aqui. Media refs são extraídos
 * separadamente por `extractInboundMedia`.
 *
 * Multi-message batches (data.messages[N>1] em WA) deferred — V1 processa
 * só data.messages[0].
 *
 * Marco 4 P4 / Marco 5 P3c.
 */

import type { MetaApiEventEnvelope } from "./schemas.js";

export interface ExtractedInboundMessage {
  externalMessageId: string;
  contentText: string | null; // null = message sem texto (media, etc.)
  messageCreatedAt: string; // ISO 8601
  senderSnapshotJson: unknown;
  direction: "incoming";
}

/** Media ref derivado do envelope (WA-first; IG deferred a P3d). */
export interface ExtractedMedia {
  media_key: string;
  mime_type: string;
  filename: string | null;
  caption: string | null;
}

const MEDIA_TYPES = ["image", "audio", "document", "video", "sticker"] as const;

/**
 * Parse IG-side timestamp defensively. IG webhooks podem chegar com:
 *   - typeof number (Unix milliseconds)
 *   - typeof string contendo só dígitos (Unix-ms-as-string)
 *   - typeof string ISO 8601
 * `parseInt("2026-05-20...")` retorna `2026` (wrong). Branch explícito.
 * Returns Date-millis (Number) ou Date.now() em fallback defensivo.
 */
export function parseIgTimestamp(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export function extractInboundMessage(
  envelope: MetaApiEventEnvelope,
): ExtractedInboundMessage | null {
  if (envelope.event_type !== "message.received") return null;
  if (!envelope.data || typeof envelope.data !== "object") return null;
  const data = envelope.data as Record<string, unknown>;

  // WhatsApp shape: data.messages[0]. Texto opcional (media-only ok).
  if (data.messaging_product === "whatsapp") {
    if (!Array.isArray(data.messages) || data.messages.length === 0) return null;
    const msg = data.messages[0] as Record<string, unknown>;
    const id = msg.id;
    const timestamp = msg.timestamp;
    if (typeof id !== "string") return null;
    if (typeof timestamp !== "string" && typeof timestamp !== "number") return null;
    const tsSeconds = typeof timestamp === "string" ? Number.parseInt(timestamp, 10) : timestamp;
    if (!Number.isFinite(tsSeconds)) return null;
    const text = msg.text as { body?: unknown } | undefined;
    const contentText =
      msg.type === "text" && text && typeof text.body === "string" ? text.body : null;
    const senderSnapshot =
      Array.isArray(data.contacts) && data.contacts.length > 0 ? data.contacts[0] : null;
    return {
      externalMessageId: id,
      contentText,
      messageCreatedAt: new Date(tsSeconds * 1000).toISOString(),
      senderSnapshotJson: senderSnapshot,
      direction: "incoming",
    };
  }

  // Instagram shape: data.recipient.id + data.sender.id + data.message.mid.
  // Texto opcional (media-only ok); media IG deferred a P3d.
  const recipient = data.recipient;
  const sender = data.sender;
  if (
    recipient &&
    typeof recipient === "object" &&
    typeof (recipient as Record<string, unknown>).id === "string" &&
    sender &&
    typeof sender === "object" &&
    typeof (sender as Record<string, unknown>).id === "string"
  ) {
    const message = data.message as { mid?: unknown; text?: unknown } | undefined;
    if (!message) return null;
    if (typeof message.mid !== "string") return null;
    const contentText = typeof message.text === "string" ? message.text : null;
    const millis = parseIgTimestamp(data.timestamp);
    return {
      externalMessageId: message.mid,
      contentText,
      messageCreatedAt: new Date(millis).toISOString(),
      senderSnapshotJson: sender,
      direction: "incoming",
    };
  }

  return null;
}

/**
 * Pure helper — extract media refs do envelope `message.received`.
 *
 * WA-first V1: lê `data.messages[0].{type,<type>}` para os tipos de mídia
 * suportados (image/audio/document/video/sticker). Retorna `null` quando
 * a mensagem não é mídia (texto, batch vazio, sem id) ou não é WhatsApp.
 * IG media deferred a P3d.
 *
 * Marco 5 P3c.
 */
export function extractInboundMedia(envelope: MetaApiEventEnvelope): ExtractedMedia[] | null {
  if (envelope.event_type !== "message.received") return null;
  if (!envelope.data || typeof envelope.data !== "object") return null;
  const data = envelope.data as Record<string, unknown>;

  if (data.messaging_product === "whatsapp") {
    if (!Array.isArray(data.messages) || data.messages.length === 0) return null;
    const msg = data.messages[0] as Record<string, unknown>;
    const type = msg.type as string;
    if (!MEDIA_TYPES.includes(type as (typeof MEDIA_TYPES)[number])) return null;
    const m = msg[type] as Record<string, unknown> | undefined;
    if (!m || typeof m.id !== "string") return null;
    return [
      {
        media_key: m.id,
        mime_type: typeof m.mime_type === "string" ? m.mime_type : "application/octet-stream",
        filename: typeof m.filename === "string" ? m.filename : null,
        caption: typeof m.caption === "string" ? m.caption : null,
      },
    ];
  }

  return null; // IG media deferred a P3d (WA-first V1)
}
