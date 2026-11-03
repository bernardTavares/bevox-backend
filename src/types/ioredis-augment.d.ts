/**
 * Type augmentation para custom commands registrados via
 * `redis.defineCommand(...)`. Sem isto, TypeScript não conhece o método
 * dinâmico e o caller precisaria de `as any`.
 *
 * Spec §6.1 + Plan T6.
 */

import "ioredis";

declare module "ioredis" {
  interface RedisCommander<Context> {
    rateLimitSlide(
      key: string,
      windowMs: string,
      max: string,
      cutoff: string,
      now: string,
      member: string,
    ): Promise<[number, number, number]>;
  }
}
