/**
 * Module augmentation for Fastify request decoration + cross-cutting
 * plugin decorators (Task 3: clerk-auth, staff-auth, execution-token,
 * organization-scope, idempotency, rate-limit).
 *
 * Tenant identity = organizationId (canon _shared/ADR-021, accepted,
 * supersedes hub-ADR-003). The harness is organization_id-native
 * (ADR-019); the resolveOrganizationId bridge was collapsed (SP-3 Phase
 * 2). The legacy tenant token is retired — it appears nowhere. Staff
 * roles are EXACTLY `bevox_admin | bevox_support | bevox_observer`
 * (ADR-013 canon).
 */

import "fastify";
import type { preHandlerHookHandler } from "fastify";

import type { LocalUserRow } from "@/modules/auth/repository.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Clerk-authenticated product user (clerk-auth plugin). */
    auth?: {
      clerk_user_id: string;
      organization_id: string;
      role: string;
    };
    /**
     * Local users-table row resolved from `auth.clerk_user_id`
     * (clerk-auth plugin). `null` when no row has been provisioned yet
     * (webhook lag), or when the resolution query failed (fail-open).
     * `undefined` when the route did not run `requireClerkAuth`.
     *
     * POC: additive metadata only — no route enforces RBAC against this
     * field yet. Follow-up will sanitize `role` to the `user_role` enum
     * and add `requireRole(roles)` middleware.
     */
    user?: LocalUserRow | null;
    /** Bevox staff principal (staff-auth plugin). */
    staff?: {
      staff_id: string;
      role: "bevox_admin" | "bevox_support" | "bevox_observer";
      impersonation_id?: string;
    };
    /** Canonical tenant scope (organization-scope plugin). */
    organizationId?: string;
    /** Harness execution-token context (execution-token plugin). */
    executionContext?: {
      execution_id: string;
    };
  }

  interface FastifyInstance {
    /** Clerk client-final auth preHandler (401 if missing/invalid). */
    requireClerkAuth: () => preHandlerHookHandler;
    /** Staff HS256 auth preHandler enforcing global roles. */
    requireStaff: (opts?: {
      roles?: Array<"bevox_admin" | "bevox_support" | "bevox_observer">;
    }) => preHandlerHookHandler;
    /** X-Execution-Token validation preHandler (harness callbacks). */
    requireExecutionToken: () => preHandlerHookHandler;
    /** Organization tenancy guard preHandler (403 on scope mismatch). */
    requireOrganizationScope: () => preHandlerHookHandler;
    /** Idempotency preHandler for POST/PATCH mutation routes (ADR-015). */
    requireIdempotency: () => preHandlerHookHandler;
    /** Rate limit preHandler (opt-in per route). */
    requireRateLimit: (opts?: {
      limit?: { max: number; windowSeconds: number };
      resolveScope?: (req: FastifyRequest) => { scope: string; id: string };
    }) => preHandlerHookHandler;
  }
}
