/**
 * Payments P4 — núcleo PURO de packages (sem IO), unit-testado primeiro
 * (padrão charge-intent.ts P2 / refund-intent.ts P3). Validação de input do
 * catálogo ServicePackage; mapper determinístico ServicePackage → grant
 * CustomerPackage; predicate fail-closed canDecrement; date arithmetic
 * UTC-determinístico. Stripe types ausentes (P4 não fala Stripe direto;
 * grant é via webhook P3-shaped).
 */
import { z } from "zod";

/**
 * Schema do body de POST /service-packages (staff/REST). `.strict()`
 * fail-closed (precedente ChargeProposalSchema P2 + RefundRequestSchema P3).
 * canon §11.5: name required, service_id opcional, sessions_included
 * integer positivo, price_amount numeric(10,2) positivo, validity_days
 * opcional integer positivo.
 */
export const ServicePackageCreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    service_id: z.string().uuid().optional(),
    sessions_included: z.number().int().positive(),
    price_amount: z.number().finite().positive(),
    validity_days: z.number().int().positive().optional(),
  })
  .strict();

export type ServicePackageInput = z.infer<typeof ServicePackageCreateSchema>;

export function validateServicePackageInput(
  raw: unknown,
): { success: true; data: ServicePackageInput } | { success: false } {
  const p = ServicePackageCreateSchema.safeParse(raw);
  return p.success ? { success: true, data: p.data } : { success: false };
}

/** Row do catálogo (subset que o mapper precisa). */
export interface ServicePackageRowForGrant {
  id: string;
  organization_id: string;
  service_id: string | null;
  // M5-P2a Item 6 (T3): sessions_included agora integer (migration 0015) →
  // pg text-protocol retorna number. validity_days permanece numeric (decimal-string).
  sessions_included: number;
  validity_days: string | null;
}

/** Row da charge paga (subset que o mapper precisa). */
export interface ChargeRowForGrant {
  id: string;
  organization_id: string;
  customer_id: string | null;
  paid_at: Date | string | null;
}

/** Shape do insert de customer_packages. */
export interface NewCustomerPackageInsert {
  organization_id: string;
  customer_id: string;
  service_package_id: string;
  charge_id: string;
  status: "active";
  // M5-P2a Item 6 (T3): sessions_* agora integer (migration 0015) → number-typed.
  sessions_total: number;
  sessions_used: number;
  sessions_remaining: number;
  valid_until: string | null;
}

/**
 * Date UTC → ISO YYYY-MM-DD. Determinístico (independente de TZ local).
 * Usado para serializar valid_until e nowIsoDate em canDecrement.
 */
export function toIsoDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

/**
 * Adiciona N dias a uma data ISO YYYY-MM-DD via UTC midnight. Sem DST/TZ
 * gotchas (UTC fixo). N=0 retorna a mesma data; positivo move adiante.
 */
export function addDaysISO(fromIso: string, days: number): string {
  const dt = new Date(fromIso + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Mapeia ServicePackage + Charge paga → input de INSERT de CustomerPackage.
 * Puro, sem IO. Lança Error se customer_id ausente (charge_type='package'
 * sem customer é incoerente) ou se validity_days set mas paid_at ausente
 * (precisa do ponto de referência para calcular expiry).
 */
export function buildCustomerPackageFromGrant(input: {
  servicePackage: ServicePackageRowForGrant;
  charge: ChargeRowForGrant;
}): NewCustomerPackageInsert {
  const { servicePackage, charge } = input;
  if (charge.customer_id === null || charge.customer_id === undefined) {
    throw new Error("charge missing customer_id (charge_type=package requires customer)");
  }
  let validUntil: string | null = null;
  if (servicePackage.validity_days !== null) {
    if (charge.paid_at === null || charge.paid_at === undefined) {
      throw new Error("charge missing paid_at (cannot compute valid_until with validity_days)");
    }
    const days = Number(servicePackage.validity_days);
    if (!Number.isInteger(days) || days <= 0) {
      throw new RangeError("validity_days must be a positive integer");
    }
    validUntil = addDaysISO(toIsoDate(charge.paid_at), days);
  }
  return {
    organization_id: charge.organization_id,
    customer_id: charge.customer_id,
    service_package_id: servicePackage.id,
    charge_id: charge.id,
    status: "active",
    sessions_total: servicePackage.sessions_included,
    sessions_used: 0,
    sessions_remaining: servicePackage.sessions_included,
    valid_until: validUntil,
  };
}

/** Row de customer_packages (subset que canDecrement precisa). */
export interface CustomerPackageRowForGuard {
  status: string;
  // M5-P2a Item 6 (T3): sessions_remaining agora integer (migration 0015).
  sessions_remaining: number;
  valid_until: string | null;
}

/**
 * Predicate fail-closed centralizado: ok sse pacote é active, não expirou,
 * e tem sessions_remaining > 0. Reusado no service + booking validate + REST.
 * boundary valid_until === nowIsoDate é INCLUSIVE (igual NÃO expira).
 * Alinhado ao cron expireDuePackages: ambos usam strict-< (today fica ok em
 * ambas as layers — sem off-by-one entre app-side e DB-side).
 */
export function canDecrement(
  pkg: CustomerPackageRowForGuard,
  nowIsoDate: string,
): { ok: true } | { ok: false; reason: "inactive" | "expired" | "exhausted" } {
  if (pkg.status !== "active") return { ok: false, reason: "inactive" };
  // Nota: row já em status terminal (expired/exhausted/cancelled) retorna
  // reason='inactive' aqui — o reason='expired' só fira em row 'active' com
  // valid_until passado (caso mid-day cron-stale; transicionado em seguida).
  if (pkg.valid_until !== null && pkg.valid_until < nowIsoDate) {
    return { ok: false, reason: "expired" };
  }
  // M5-P2a Item 6 (T3): sessions_remaining é number direto (post-migration);
  // defensive Number.isFinite contra runtime payloads que poderiam ser
  // string-shaped por accident (e.g. row de path antigo no test/staging).
  const remaining = Number(pkg.sessions_remaining);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { ok: false, reason: "exhausted" };
  }
  return { ok: true };
}
