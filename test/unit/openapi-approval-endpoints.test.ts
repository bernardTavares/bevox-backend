/**
 * Garante que os endpoints de aprovação de execuções (handlers vivos em
 * `src/modules/executions/routes.ts`) estão documentados no contrato
 * canônico `openapi/bevox-backend-v1.yaml`. Sem isto, clientes tipados
 * gerados e a UI /docs não enxergam o ciclo human-in-the-loop
 * (bevox-backend/ADR-019, supersedes hub ADR-025; PRD §5.6 Módulo 9).
 *
 * Validação por leitura textual + regex — sem novas deps (yaml parser).
 * Follow-on: skill `openapi-contract-validate` + check de "todo handler
 * Fastify tem path correspondente no YAML" via diff CI.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const yamlPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../openapi/bevox-backend-v1.yaml",
);
const yaml = readFileSync(yamlPath, "utf8");

describe("openapi contract — approval endpoints", () => {
  it("declara a tag 'approvals'", () => {
    expect(yaml).toMatch(/^\s*- name: approvals\s*$/m);
  });

  it("inclui GET /api/v1/organizations/{organization_id}/executions", () => {
    expect(yaml).toContain("/api/v1/organizations/{organization_id}/executions:");
  });

  it("inclui POST /api/v1/organizations/{organization_id}/executions/{id}/approve", () => {
    expect(yaml).toContain("/api/v1/organizations/{organization_id}/executions/{id}/approve:");
  });

  it("inclui POST /api/v1/organizations/{organization_id}/executions/{id}/edit", () => {
    expect(yaml).toContain("/api/v1/organizations/{organization_id}/executions/{id}/edit:");
  });

  it("inclui POST /api/v1/organizations/{organization_id}/executions/{id}/reject", () => {
    expect(yaml).toContain("/api/v1/organizations/{organization_id}/executions/{id}/reject:");
  });

  it("declara schemas PendingExecution{,List}, ExecutionEditBody, ExecutionRejectBody e resultados", () => {
    expect(yaml).toMatch(/^\s*PendingExecution:\s*$/m);
    expect(yaml).toMatch(/^\s*PendingExecutionList:\s*$/m);
    expect(yaml).toMatch(/^\s*ExecutionEditBody:\s*$/m);
    expect(yaml).toMatch(/^\s*ExecutionRejectBody:\s*$/m);
    expect(yaml).toMatch(/^\s*ExecutionApprovalResult:\s*$/m);
    expect(yaml).toMatch(/^\s*ExecutionRejectionResult:\s*$/m);
  });
});

describe("openapi contract — generated types alinhados com YAML", () => {
  /**
   * Compila se e somente se `pnpm openapi:types` foi rodado depois das
   * edições no YAML — garante que o espelho `src/types/api.ts` não
   * fica stale.
   */
  it("expõe os paths em src/types/api.ts", async () => {
    const typesPath = resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../src/types/api.ts",
    );
    const types = readFileSync(typesPath, "utf8");
    expect(types).toContain('"/api/v1/organizations/{organization_id}/executions"');
    expect(types).toContain('"/api/v1/organizations/{organization_id}/executions/{id}/approve"');
    expect(types).toContain('"/api/v1/organizations/{organization_id}/executions/{id}/edit"');
    expect(types).toContain('"/api/v1/organizations/{organization_id}/executions/{id}/reject"');
    expect(types).toContain("PendingExecutionList");
    expect(types).toContain("ExecutionApprovalResult");
    expect(types).toContain("ExecutionRejectionResult");
  });
});
