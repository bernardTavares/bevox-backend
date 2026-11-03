import { errors } from "@/shared/errors.js";

import { applyProfilePatch, getOrCreateProfile, type AutonomyProfileRow } from "./repository.js";
import type { PatchBody } from "./schemas.js";

export async function getAutonomy(orgId: string): Promise<AutonomyProfileRow> {
  return getOrCreateProfile(orgId);
}

export async function patchAutonomy(
  orgId: string,
  body: PatchBody,
  actorClerkUserId: string | null,
): Promise<AutonomyProfileRow> {
  const current = await getOrCreateProfile(orgId);
  const modeChanging =
    body.current_mode !== undefined && body.current_mode !== current.current_mode;
  if (modeChanging && (!body.reason || body.reason.trim() === "")) {
    throw errors.invalidInput("reason is required when changing current_mode");
  }
  return applyProfilePatch({
    orgId,
    patch: {
      current_mode: body.current_mode,
      allowed_actions_json: body.allowed_actions_json,
      required_approvals_json: body.required_approvals_json,
      confidence_thresholds_json: body.confidence_thresholds_json,
    },
    reasonText: body.reason ?? null,
    actorClerkUserId,
  });
}
