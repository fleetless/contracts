/**
 * `barrel.test.ts` uses `import.meta.glob` — a Vite feature, not a TypeScript
 * one — to hold every source file against the barrel. Vite's own `client.d.ts`
 * would declare it, but `vite` is not a dependency of this package: vitest
 * pulls it in transitively, and adding a direct dependency for one type would
 * be a heavier answer than the question.
 *
 * Declared here, narrowly, so the one call site typechecks and nothing else
 * silently becomes `any`.
 */
interface ImportMeta {
  glob: (pattern: string, options?: { eager?: boolean }) => Record<string, unknown>
}
