/**
 * `.rejects` and `.resolves` matchers return a promise at runtime, but
 * bun-types declare every matcher as void. Declaring what they do keeps
 * `await-thenable` honest and lets `no-floating-promises` catch a dropped
 * await, which would end a test before its assertion runs.
 */
import "bun:test";

type Settling<M> = {
  [K in keyof M]: M[K] extends (...args: infer A) => unknown
    ? (...args: A) => Promise<void>
    : M[K] extends object
      ? Settling<M[K]>
      : M[K];
};

declare module "bun:test" {
  interface Matchers<T> {
    rejects: Settling<Matchers<unknown>>;
    resolves: Settling<Matchers<Awaited<T>>>;
  }
}
