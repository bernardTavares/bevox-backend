import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "@/lib/token-crypto.js";

const KEY = Buffer.alloc(32, 7).toString("base64"); // 32 bytes determinístico

describe("token-crypto AES-256-GCM", () => {
  it("round-trip decrypt(encrypt(x)) === x", () => {
    const ct = encryptToken("refresh-abc.123", KEY);
    expect(Buffer.isBuffer(ct)).toBe(true);
    expect(ct[0]).toBe(1); // version byte
    expect(decryptToken(ct, KEY)).toBe("refresh-abc.123");
  });
  it("ciphertexts diferem (IV aleatório por operação)", () => {
    expect(encryptToken("x", KEY).equals(encryptToken("x", KEY))).toBe(false);
  });
  it("auth-tag adulterada → erro explícito (não crash silencioso)", () => {
    const ct = encryptToken("secret", KEY);
    ct.writeUInt8(ct.readUInt8(ct.length - 1) ^ 0xff, ct.length - 1);
    expect(() => decryptToken(ct, KEY)).toThrow();
  });
  it("versão desconhecida → erro explícito", () => {
    const ct = encryptToken("secret", KEY);
    ct[0] = 9;
    expect(() => decryptToken(ct, KEY)).toThrow(/version/i);
  });
  it("chave de tamanho errado → erro", () => {
    expect(() => encryptToken("x", Buffer.alloc(16).toString("base64"))).toThrow();
  });
  it("round-trip não-ASCII / UTF-8 multibyte", () => {
    expect(decryptToken(encryptToken("café-🔐-Ω", KEY), KEY)).toBe("café-🔐-Ω");
  });
  it("round-trip string vazia", () => {
    expect(decryptToken(encryptToken("", KEY), KEY)).toBe("");
  });
  it("blob curto demais → erro explícito", () => {
    expect(() => decryptToken(Buffer.from([1, 2, 3]), KEY)).toThrow();
  });
  it("chave de tamanho certo mas bytes errados → falha de auth GCM", () => {
    const ct = encryptToken("secret", KEY);
    expect(() => decryptToken(ct, Buffer.alloc(32, 9).toString("base64"))).toThrow();
  });
});
