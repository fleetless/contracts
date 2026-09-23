// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Pinned, not defaulted. Vitest's default `include` covers every
    // `*.test.{js,ts,mjs,...}` in the tree, which now also matches
    // `.github/release/release.test.mjs` — the release library's own suite,
    // written for node:test and run by `node --test` in CI, never by vitest.
    // Vitest collecting it fails the run with "No test suite found" before a
    // single real test here gets to speak. Only `test/` is this package's
    // suite.
    include: ['test/**/*.test.ts'],
  },
})
