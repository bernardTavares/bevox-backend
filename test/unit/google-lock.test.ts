import { afterEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
const del = vi.fn();
const evalFn = vi.fn();

vi.mock("@/lib/redis.js", () => ({
  getRedis: () => ({ set, del, eval: evalFn }),
}));

import { withConnectionLock, withRedisLock } from "@/modules/calendar/google/lock.js";

const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

describe("withRedisLock single-flight semantics", () => {
  afterEach(() => {
    set.mockReset();
    del.mockReset();
    evalFn.mockReset();
  });

  it("lock adquirido (SET NX → 'OK') roda fn e libera no finally (fenced eval com o token)", async () => {
    set.mockResolvedValue("OK");
    evalFn.mockResolvedValue(1);
    const r = await withRedisLock("k", 30, async () => 42);
    expect(r).toBe(42);
    // SET key <token> EX 30 NX — valor é o token único, não "1".
    expect(set).toHaveBeenCalledTimes(1);
    const [setKey, token, ex, ttl, nx] = set.mock.calls[0]!;
    expect(setKey).toBe("k");
    expect(ex).toBe("EX");
    expect(ttl).toBe(30);
    expect(nx).toBe("NX");
    expect(typeof token).toBe("string");
    expect(token).not.toBe("1");
    // Release: compare-and-del atômico via Lua, com KEYS[1]=k e ARGV[1]=token.
    expect(evalFn).toHaveBeenCalledWith(RELEASE_LUA, 1, "k", token);
    expect(del).not.toHaveBeenCalled();
  });

  it("lock NÃO adquirido (SET NX → null) → retorna null, NÃO chama eval nem fn", async () => {
    set.mockResolvedValue(null);
    const fn = vi.fn();
    const r = await withRedisLock("k", 30, fn);
    expect(r).toBeNull();
    expect(fn).not.toHaveBeenCalled();
    expect(evalFn).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("fn lança → lock ainda é liberado (finally) via eval fenced", async () => {
    set.mockResolvedValue("OK");
    evalFn.mockResolvedValue(1);
    await expect(
      withRedisLock("k", 30, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(evalFn).toHaveBeenCalledWith(RELEASE_LUA, 1, "k", expect.any(String));
  });

  it("withConnectionLock usa a chave google:sync:lock:<id> TTL 120 (valor = token único)", async () => {
    set.mockResolvedValue("OK");
    evalFn.mockResolvedValue(1);
    await withConnectionLock("conn-1", async () => undefined);
    const [setKey, token, ex, ttl, nx] = set.mock.calls[0]!;
    expect(setKey).toBe("google:sync:lock:conn-1");
    expect(ex).toBe("EX");
    expect(ttl).toBe(120);
    expect(nx).toBe("NX");
    expect(token).not.toBe("1");
  });

  it("detentor STALE (TTL expirou, sucessor com token B) NÃO apaga a chave do sucessor", async () => {
    // Cenário: este worker adquire (token A). Durante fn() o TTL expira e
    // um sucessor reassume a chave com token B. No finally o release roda o
    // Lua compare-and-del com ARGV[1]=token A; como get(key)==B != A, o Lua
    // retorna 0 e o `del` NÃO é executado server-side (chave B intacta).
    set.mockResolvedValue("OK");
    // Mock fiel: simula o Lua — só "apaga" (retorna 1) se ARGV[1] == valor
    // atual da chave; senão retorna 0. A chave já contém o token do sucessor.
    const SUCCESSOR_TOKEN = "successor-token-B";
    evalFn.mockImplementation(async (_script: string, _n: number, _key: string, arg: string) =>
      arg === SUCCESSOR_TOKEN ? 1 : 0,
    );

    const r = await withRedisLock("k", 30, async () => "done");

    expect(r).toBe("done");
    // O release foi tentado (eval chamado) ...
    expect(evalFn).toHaveBeenCalledTimes(1);
    const [script, numkeys, key, ownToken] = evalFn.mock.calls[0]!;
    expect(script).toBe(RELEASE_LUA);
    expect(numkeys).toBe(1);
    expect(key).toBe("k");
    // ... com o token DESTE worker (A), que difere do token do sucessor.
    expect(ownToken).not.toBe(SUCCESSOR_TOKEN);
    // ... e como get != ownToken, o Lua retornou 0 → nada foi deletado.
    await expect(evalFn.mock.results[0]!.value).resolves.toBe(0);
    expect(del).not.toHaveBeenCalled();
  });
});
