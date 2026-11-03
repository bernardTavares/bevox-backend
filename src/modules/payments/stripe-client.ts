/**
 * Singleton lazy do SDK Stripe (Payments P1, canon ADR-014). Lê
 * STRIPE_SECRET_KEY de env(). apiVersion pinada explicitamente à versão
 * fixada pelo SDK v22 (estabilidade — sem isso o SDK flutua). Lançar cedo
 * se a credencial core faltar (requiredInProd já garante em prod; em dev
 * uma chamada Stripe sem chave deve falhar honestamente, não silenciar).
 */
import Stripe from "stripe";

import { env } from "@/config/env.js";
import { errors } from "@/shared/errors.js";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = env().STRIPE_SECRET_KEY;
  if (!key) {
    throw errors.internal("STRIPE_SECRET_KEY ausente — Stripe não configurado");
  }
  client = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  return client;
}

/** Reset apenas para testes. */
export function __resetStripeClientForTests(): void {
  client = null;
}
