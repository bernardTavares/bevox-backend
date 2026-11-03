/** C2 Google — nomes de fila/job, crons, scopes, endpoints OAuth/API. */
export const GOOGLE_PUSH_QUEUE = "bevox.google.push";
export const GOOGLE_INCREMENTAL_SYNC_QUEUE = "bevox.google.incremental-sync";
export const GOOGLE_WATCH_RENEWAL_QUEUE = "bevox.google.watch-renewal";

export const GOOGLE_PUSH_JOB_NAME = "google-push-drain";
export const GOOGLE_PUSH_REPEAT_CRON = "* * * * *";
export const GOOGLE_WATCH_RENEWAL_JOB_NAME = "google-watch-renewal";
export const GOOGLE_WATCH_RENEWAL_CRON = "0 3 * * *";
export const GOOGLE_INCREMENTAL_SAFETY_JOB_NAME = "google-incremental-safety";
export const GOOGLE_INCREMENTAL_SAFETY_CRON = "0 */2 * * *";

export const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo";
export const GOOGLE_CAL_API = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_WATCH_TTL_MS = 7 * 24 * 3600 * 1000;
export const GOOGLE_OAUTH_NONCE_TTL_SECONDS = 600;
