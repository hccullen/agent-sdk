// Node >= 18 (our minimum engine) guarantees globalThis.crypto.randomUUID.
// Cast required because tsconfig lib:["ES2020"] doesn't include DOM crypto types.
export const randomUUID = (): string =>
  (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
