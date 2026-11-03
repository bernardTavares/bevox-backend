/**
 * Match engine PURO (zero IO). Dado um conjunto de candidatos `waiting`,
 * o slot liberado e a policy, devolve os elegíveis ordenados de forma
 * determinística. A janela de preferência é comparada em UTC: date =
 * slice(0,10) e time = HH:MM, ambos do ISO UTC do slot. Escolha V1
 * deliberada (comparação fixed-width zero-padded, lexicograficamente =
 * cronológica). Follow-on registrado: match tz-aware (preferências do
 * cliente no fuso do calendário, não UTC).
 */
import type { WaitlistPolicy } from "./policy.js";

export interface WaitlistCandidate {
  id: string;
  service_id: string | null;
  professional_id: string | null;
  preferred_date_from: string | null; // YYYY-MM-DD
  preferred_date_to: string | null;
  preferred_time_from: string | null; // HH:MM or HH:MM:SS
  preferred_time_to: string | null;
  priority_score: string; // numeric vem como string do pg
  priority: number;
  position: number | null;
  created_at: Date;
}

export interface SlotInfo {
  slot_start_at: Date;
  service_id: string | null;
  professional_id: string | null;
}

function slotDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function slotTime(d: Date): string {
  return d.toISOString().slice(11, 16); // HH:MM
}
function hhmm(t: string): string {
  return t.slice(0, 5);
}

function windowMatches(c: WaitlistCandidate, slot: SlotInfo): boolean {
  const d = slotDate(slot.slot_start_at);
  if (c.preferred_date_from && d < c.preferred_date_from) return false;
  if (c.preferred_date_to && d > c.preferred_date_to) return false;
  const t = slotTime(slot.slot_start_at);
  if (c.preferred_time_from && t < hhmm(c.preferred_time_from)) return false;
  if (c.preferred_time_to && t > hhmm(c.preferred_time_to)) return false;
  return true;
}

function serviceEligible(c: WaitlistCandidate, slot: SlotInfo, pol: WaitlistPolicy): boolean {
  if (pol.service_eligibility === "any") return true;
  return (c.service_id ?? null) === (slot.service_id ?? null);
}

function professionalEligible(c: WaitlistCandidate, slot: SlotInfo, pol: WaitlistPolicy): boolean {
  if (pol.professional_preference !== "required") return true;
  return (c.professional_id ?? null) === (slot.professional_id ?? null);
}

function compare(
  a: WaitlistCandidate,
  b: WaitlistCandidate,
  slot: SlotInfo,
  pol: WaitlistPolicy,
): number {
  if (pol.professional_preference === "preferred") {
    const am = a.professional_id === slot.professional_id ? 0 : 1;
    const bm = b.professional_id === slot.professional_id ? 0 : 1;
    if (am !== bm) return am - bm;
  }
  for (const token of pol.priority_order) {
    if (token === "priority_score") {
      const d = Number(b.priority_score) - Number(a.priority_score);
      if (d !== 0) return d;
    } else if (token === "priority") {
      if (b.priority !== a.priority) return b.priority - a.priority;
    } else if (token === "position") {
      const ap = a.position ?? Number.POSITIVE_INFINITY;
      const bp = b.position ?? Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
    } else {
      const d = a.created_at.getTime() - b.created_at.getTime();
      if (d !== 0) return d;
    }
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function selectBestCandidates(
  candidates: WaitlistCandidate[],
  slot: SlotInfo,
  pol: WaitlistPolicy,
): WaitlistCandidate[] {
  return candidates
    .filter(
      (c) =>
        windowMatches(c, slot) &&
        serviceEligible(c, slot, pol) &&
        professionalEligible(c, slot, pol),
    )
    .sort((a, b) => compare(a, b, slot, pol));
}
