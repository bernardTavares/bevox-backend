/**
 * Google Calendar API v3 client (C2). fetch nativo (sem dep googleapis).
 * Build-to-canon: matriz de erro canon §8 (401/403/404/410/412/429/5xx),
 * paginação nextPageToken.
 */
import { GOOGLE_CAL_API } from "./constants.js";

const TIMEOUT_MS = 10_000;

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    public retryAfter?: number,
  ) {
    super(`Google API ${status}: ${body.slice(0, 300)}`);
    this.name = "GoogleApiError";
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new GoogleApiError(res.status, "invalid/empty JSON body from Google API");
  }
}

async function googleFetch(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 204 || res.ok) return res;
  const body = await res.text();
  const ra = res.headers.get("retry-after");
  const raNum = ra ? Number(ra) : undefined;
  throw new GoogleApiError(res.status, body, Number.isFinite(raNum) ? raNum : undefined);
}

export interface GoogleEventInput {
  summary: string;
  startIso: string;
  endIso: string;
  timeZone: string;
  bevoxAppointmentId: string;
  bevoxOrganizationId: string;
}
function eventBody(e: GoogleEventInput) {
  return {
    summary: e.summary,
    start: { dateTime: e.startIso, timeZone: e.timeZone },
    end: { dateTime: e.endIso, timeZone: e.timeZone },
    extendedProperties: {
      private: {
        bevox_appointment_id: e.bevoxAppointmentId,
        bevox_organization_id: e.bevoxOrganizationId,
      },
    },
  };
}

export async function createGoogleEvent(
  token: string,
  calId: string,
  e: GoogleEventInput,
): Promise<{ id: string; etag: string }> {
  const res = await googleFetch(
    token,
    `${GOOGLE_CAL_API}/calendars/${encodeURIComponent(calId)}/events`,
    {
      method: "POST",
      body: JSON.stringify(eventBody(e)),
    },
  );
  const j = await parseJson<{ id: string; etag: string }>(res);
  return { id: j.id, etag: j.etag };
}

export async function updateGoogleEvent(
  token: string,
  calId: string,
  eventId: string,
  etag: string | null,
  e: GoogleEventInput,
): Promise<{ etag: string }> {
  const res = await googleFetch(
    token,
    `${GOOGLE_CAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: etag ? { "If-Match": etag } : {},
      body: JSON.stringify(eventBody(e)),
    },
  );
  const j = await parseJson<{ etag: string }>(res);
  return { etag: j.etag };
}

export async function deleteGoogleEvent(
  token: string,
  calId: string,
  eventId: string,
): Promise<void> {
  try {
    await googleFetch(
      token,
      `${GOOGLE_CAL_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
  } catch (err) {
    if (err instanceof GoogleApiError && err.status === 404) return;
    throw err;
  }
}

export interface GoogleEvent {
  id: string;
  status: string;
  etag: string;
  summary?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * Materializa TODAS as páginas num único array em memória (não é streamed);
 * um resync completo de calendário muito grande tem uso de memória ilimitado — callers (T7) devem estar cientes.
 */
export async function listEvents(
  token: string,
  calId: string,
  opts: { syncToken?: string | null; timeMinIso?: string },
): Promise<{ events: GoogleEvent[]; nextSyncToken: string | null }> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  do {
    const u = new URL(`${GOOGLE_CAL_API}/calendars/${encodeURIComponent(calId)}/events`);
    if (opts.syncToken) u.searchParams.set("syncToken", opts.syncToken);
    else if (opts.timeMinIso) u.searchParams.set("timeMin", opts.timeMinIso);
    u.searchParams.set("showDeleted", "true");
    u.searchParams.set("maxResults", "250");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await googleFetch(token, u.toString());
    const j = await parseJson<{
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    }>(res);
    events.push(...(j.items ?? []));
    pageToken = j.nextPageToken;
    if (j.nextSyncToken) nextSyncToken = j.nextSyncToken;
  } while (pageToken);
  return { events, nextSyncToken };
}

export async function startWatch(
  token: string,
  calId: string,
  channelId: string,
  address: string,
  watchToken: string,
  expirationMs: number,
): Promise<{ resourceId: string; expiration: number }> {
  const res = await googleFetch(
    token,
    `${GOOGLE_CAL_API}/calendars/${encodeURIComponent(calId)}/events/watch`,
    {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address,
        token: watchToken,
        expiration: expirationMs,
      }),
    },
  );
  const j = await parseJson<{ resourceId: string; expiration: string }>(res);
  return { resourceId: j.resourceId, expiration: Number(j.expiration) };
}

export async function stopWatch(
  token: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  try {
    await googleFetch(token, `${GOOGLE_CAL_API}/channels/stop`, {
      method: "POST",
      body: JSON.stringify({ id: channelId, resourceId }),
    });
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 400)) return;
    throw err;
  }
}
