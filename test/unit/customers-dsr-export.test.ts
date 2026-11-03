/**
 * Unit test — `customers.service.exportData` (DSR export, PRD §12.9).
 *
 * Cobre o POC do gap `no-dsr-export-endpoint`:
 *   - Customer existe → retorna payload canônico com customer + facts reais
 *     + messages/audit_events vazios (placeholders Marco-3) + metadados
 *     (schema_version, generated_at, organization_id);
 *   - Customer não existe / cross-org → NOT_FOUND (AppError).
 *
 * Mock-pattern espelha test/unit/autonomy.test.ts (module-level vi.mock em
 * @/db/client.js). Não exige testcontainers — roda em `pnpm test` puro.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client.js", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@/db/client.js";

import { exportData } from "@/modules/customers/service.js";
import { AppError } from "@/shared/errors.js";

const mockGetDb = vi.mocked(getDb);

/**
 * Cada chamada ao service.exportData faz duas queries:
 *   1ª — getCustomer (SELECT FROM customers ...)
 *   2ª — listFacts   (SELECT FROM customer_facts ...)
 * Sequenciamos `execute` para responder a ambas em ordem.
 */
function dbReturningInOrder(...rowsBatches: unknown[][]) {
  const execute = vi.fn();
  for (const rows of rowsBatches) {
    execute.mockResolvedValueOnce({ rows });
  }
  mockGetDb.mockReturnValue({ execute } as unknown as ReturnType<typeof getDb>);
}

const ORG_ID = "01890000-0000-7000-8000-000000000001";
const CUSTOMER_ID = "01890000-0000-7000-8000-0000000000aa";

const customerRow = {
  id: CUSTOMER_ID,
  organization_id: ORG_ID,
  full_name: "Maria DSR",
  preferred_name: null,
  primary_phone: "+5511999999999",
  primary_email: "maria@example.test",
  notes_internal: null,
  ai_opt_out: false,
  status: "active",
};

const factRow = {
  id: "01890000-0000-7000-8000-0000000000bb",
  organization_id: ORG_ID,
  customer_id: CUSTOMER_ID,
  fact_key: "allergy",
  fact_value: "penicilina",
  category: "medical",
  confidence: "1.00",
  source_type: "manual",
  is_private: false,
};

describe("customers.service.exportData (DSR export, PRD §12.9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns canonical payload with customer + facts + empty placeholders", async () => {
    dbReturningInOrder([customerRow], [factRow]);

    const out = await exportData(ORG_ID, CUSTOMER_ID);

    // Metadados de geração
    expect(out.schema_version).toBe("1.0.0-poc");
    expect(out.organization_id).toBe(ORG_ID);
    expect(typeof out.generated_at).toBe("string");
    expect(() => new Date(out.generated_at).toISOString()).not.toThrow();

    // Dados dereferenciados
    expect(out.customer).toEqual(customerRow);
    expect(out.facts).toEqual([factRow]);

    // Placeholders Marco-3
    expect(out.messages).toEqual([]);
    expect(out.audit_events).toEqual([]);
  });

  it("returns empty facts array when customer has no facts", async () => {
    dbReturningInOrder([customerRow], []);

    const out = await exportData(ORG_ID, CUSTOMER_ID);

    expect(out.customer).toEqual(customerRow);
    expect(out.facts).toEqual([]);
    expect(out.messages).toEqual([]);
    expect(out.audit_events).toEqual([]);
  });

  it("throws NOT_FOUND when customer does not exist in org", async () => {
    // getCustomer retorna []  → service deve lançar antes de chamar listFacts
    dbReturningInOrder([]);

    await expect(exportData(ORG_ID, CUSTOMER_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("error thrown for missing customer is an AppError (canonical error contract)", async () => {
    dbReturningInOrder([]);

    await expect(exportData(ORG_ID, CUSTOMER_ID)).rejects.toBeInstanceOf(AppError);
  });
});
