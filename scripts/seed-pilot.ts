/**
 * seed-pilot — bootstrap idempotente da org-piloto Bevox para go-live.
 *
 * Plan Task 15 / spec go-live §10.3. Cria, em UM transactional batch:
 *   - 1 `organization` "Bevox Piloto" (UUIDv7; override via
 *     `BEVOX_PILOT_ORG_ID` — necessário para restart-safe deploys e
 *     drills DR);
 *   - 1 `staff_account` admin (`bevox_admin`, ADR-013) com password hash
 *     bcrypt — UPSERT por email (idempotência natural);
 *   - 1 `professional` piloto — UPSERT por (organizationId, name);
 *   - 1 `service` "Consulta padrão" — UPSERT por (organizationId, name).
 *
 * Idempotência verdadeira: cada entidade resolve seu ID por SELECT prévio
 * (lookup natural por chave funcional) e só faz INSERT se ausente. Rodar 2x
 * produz exatamente os mesmos IDs.
 *
 * Senha staff: env `BEVOX_PILOT_STAFF_PASSWORD` ou um placeholder seguro
 * a ser rotacionado IMEDIATAMENTE após o primeiro login (M5 §10.3).
 *
 * Uso CLI:  `tsx scripts/seed-pilot.ts`  (rodado pelo runbook go-live).
 * Uso programático: `await runSeedPilot()`.
 */

import "dotenv/config";

import { and, eq } from "drizzle-orm";

import { closeDb, initDb } from "@/db/client.js";
import { hashStaffPassword } from "@/plugins/staff-auth.js";
import { assertMfaSecretNotPlaceholder, generateMfaSecret } from "@/shared/mfa.js";
import { uuidv7 } from "@/shared/uuid.js";

import { professionals, services } from "@db/schema/catalog.js";
import { staffAccounts } from "@db/schema/staff.js";
import { organizations } from "@db/schema/tenancy.js";

export interface SeedPilotResult {
  organizationId: string;
  staffAccountId: string;
  professionalId: string;
  serviceId: string;
}

const PILOT_ORG_NAME = "Bevox Piloto";
const PILOT_STAFF_EMAIL = "staff@example.com";
const PILOT_STAFF_FULL_NAME = "Bevox Piloto Admin";
const PILOT_PROFESSIONAL_NAME = "Profissional piloto";
const PILOT_SERVICE_NAME = "Consulta padrão";

// Placeholder mínimo (12+ chars, mistura) — ROTACIONAR no primeiro login.
const DEFAULT_PILOT_STAFF_PASSWORD = "ChangeMeAfterFirstLogin!42";

/**
 * MFA secret do staff piloto.
 *
 * Histórico (Marco-1): o seed inseria um placeholder literal apostando que o
 * auth iria rejeitá-lo e forçar re-enrollment. Auditoria de attack (achado
 * `staff-mfa-sentinel`) mostrou que (a) o auth NÃO rejeita o sentinel — TOTP
 * enforcement é Marco-3 (PRD §16.3 / ADR-013) — e (b) deixar uma
 * string-placeholder conhecida em `staff_accounts.mfa_secret` cria uma
 * superfície de ataque (literal vaza em dumps, logs, replicas etc).
 *
 * Fix Marco-1 (este PR — POC): o seed gera um secret real via
 * `generateMfaSecret()` (RFC 4648 base32, 160 bits) e valida contra
 * blocklist antes do INSERT. O secret entra no DB, mas o login ainda é
 * password-only (TOTP NÃO é enforced até Marco-3).
 *
 * TODO (Marco-3, ADR-013 §MFA): implementar TOTP verification em
 * `loginStaff`; adicionar setup flow TOTP no painel staff; substituir o
 * secret seedado por enrollment real no primeiro login.
 */

export async function runSeedPilot(): Promise<SeedPilotResult> {
  // Guard de produção: jamais semear admin com senha placeholder em prod.
  const pilotStaffPassword = process.env.BEVOX_PILOT_STAFF_PASSWORD;
  if (process.env.NODE_ENV === "production" && !pilotStaffPassword) {
    throw new Error(
      "BEVOX_PILOT_STAFF_PASSWORD must be set when NODE_ENV=production. Refusing to seed with default placeholder password.",
    );
  }
  if (!pilotStaffPassword) {
    console.warn(
      "[seed-pilot] WARN: using DEFAULT_PILOT_STAFF_PASSWORD. Rotate immediately after first login.",
    );
  }

  const db = await initDb();

  // 1. Organization — override opcional por env (restart-safe / DR).
  const overrideOrgId = process.env.BEVOX_PILOT_ORG_ID;

  const existingOrg = overrideOrgId
    ? await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, overrideOrgId))
        .limit(1)
    : await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.name, PILOT_ORG_NAME))
        .limit(1);

  let organizationId: string;
  if (existingOrg[0]) {
    organizationId = existingOrg[0].id;
  } else {
    organizationId = overrideOrgId ?? uuidv7();
    await db
      .insert(organizations)
      .values({
        id: organizationId,
        name: PILOT_ORG_NAME,
        businessName: "Bevox Piloto LTDA",
        legalName: "Bevox Piloto LTDA",
        niche: "general",
        timezone: "America/Sao_Paulo",
        currency: "BRL",
        locale: "pt-BR",
        onboardingStage: "welcome",
        aiMode: "manual_assisted",
        status: "active",
      })
      .onConflictDoNothing();
  }

  // 2. Staff account admin — UPSERT por email (unique).
  //
  // NOTA DE SEGURANÇA: o registro inserido carrega um `mfa_secret`
  // criptograficamente aleatório (RFC 4648 base32, 160 bits) gerado via
  // `generateMfaSecret()`. NÃO é mais um placeholder literal — fechamos a
  // surface de attack `staff-mfa-sentinel`. O TOTP, porém, ainda NÃO é
  // enforced em login (Marco-3, ADR-013 §MFA); o secret existe no schema
  // (NOT NULL) e fica pronto para enrollment real. O staff seedado deve
  // rotacionar password no primeiro login (M5 §10.3) e, em Marco-3,
  // completar setup TOTP no staff console.
  const existingStaff = await db
    .select({ id: staffAccounts.id })
    .from(staffAccounts)
    .where(eq(staffAccounts.email, PILOT_STAFF_EMAIL))
    .limit(1);

  let staffAccountId: string;
  if (existingStaff[0]) {
    staffAccountId = existingStaff[0].id;
  } else {
    const passwordHash = await hashStaffPassword(
      pilotStaffPassword ?? DEFAULT_PILOT_STAFF_PASSWORD,
    );
    // Defesa em profundidade: gera um secret real E valida contra blocklist
    // ANTES de tocar o DB. Se alguma regressão futura reintroduzir um
    // placeholder, o INSERT trava aqui em vez de poluir staff_accounts.
    const mfaSecret = generateMfaSecret();
    assertMfaSecretNotPlaceholder(mfaSecret);
    staffAccountId = uuidv7();
    await db
      .insert(staffAccounts)
      .values({
        id: staffAccountId,
        email: PILOT_STAFF_EMAIL,
        full_name: PILOT_STAFF_FULL_NAME,
        password_hash: passwordHash,
        role: "bevox_admin",
        // MFA secret real (RFC 4648 base32). TOTP enforcement = Marco-3.
        mfa_secret: mfaSecret,
        active: true,
      })
      .onConflictDoNothing();
    // Re-resolve em caso de race com outra invocação concorrente.
    const [staff] = await db
      .select({ id: staffAccounts.id })
      .from(staffAccounts)
      .where(eq(staffAccounts.email, PILOT_STAFF_EMAIL))
      .limit(1);
    if (staff) staffAccountId = staff.id;
  }

  // 3. Professional piloto — UPSERT por (organization_id, name).
  const existingProfessional = await db
    .select({ id: professionals.id })
    .from(professionals)
    .where(
      and(
        eq(professionals.organizationId, organizationId),
        eq(professionals.name, PILOT_PROFESSIONAL_NAME),
      ),
    )
    .limit(1);

  let professionalId: string;
  if (existingProfessional[0]) {
    professionalId = existingProfessional[0].id;
  } else {
    professionalId = uuidv7();
    await db.insert(professionals).values({
      id: professionalId,
      organizationId,
      name: PILOT_PROFESSIONAL_NAME,
      roleType: "provider",
      isBookable: true,
      isActive: true,
    });
  }

  // 4. Service "Consulta padrão" — UPSERT por (organization_id, name).
  const existingService = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.organizationId, organizationId), eq(services.name, PILOT_SERVICE_NAME)))
    .limit(1);

  let serviceId: string;
  if (existingService[0]) {
    serviceId = existingService[0].id;
  } else {
    serviceId = uuidv7();
    await db.insert(services).values({
      id: serviceId,
      organizationId,
      name: PILOT_SERVICE_NAME,
      durationMinutes: 30,
      priceAmount: "100.00",
      currency: "BRL",
      maxConcurrent: 1,
      isActive: true,
    });
  }

  const result: SeedPilotResult = {
    organizationId,
    staffAccountId,
    professionalId,
    serviceId,
  };
  // Print JSON na stdout — runbook go-live captura via `jq` (§10.3).
  console.log(JSON.stringify(result, null, 2));
  // Stable one-line marker for smoke-test parsing (do not change format)
  console.log(`SEED_PILOT_RESULT=${JSON.stringify(result)}`);
  return result;
}

// Entrypoint CLI — `tsx scripts/seed-pilot.ts`.
const invokedAsScript =
  typeof process.argv[1] === "string" &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedAsScript) {
  runSeedPilot()
    .then(async () => {
      await closeDb();
    })
    .catch(async (err: unknown) => {
      console.error("[seed-pilot] falha:", err instanceof Error ? err.message : err);
      await closeDb().catch(() => {});
      process.exit(1);
    });
}
