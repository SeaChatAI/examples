/**
 * Hybrid install is retired: only two examples remain and normal `bun install` is enough.
 * Kept as a no-op so old docs/scripts that call `bun run link-deps` do not fail.
 */
console.log(
  'link-deps: no-op. Use `bun install && bun run dev` (hybrid sibling install removed).',
);
