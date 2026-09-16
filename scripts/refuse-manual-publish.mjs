// SPDX-License-Identifier: Apache-2.0
/**
 * `npm publish` from a working tree is refused. CONTRIBUTING says "`npm
 * publish` from a working tree is refused by a `prepublishOnly` script" —
 * this is that script. Mirrors the sibling `sdk` package's equivalent
 * script.
 *
 * What it prevents: a version reaching npm having passed no typecheck, no
 * suite, no artifact staleness gate and no tarball assertion, from a tree that
 * may be dirty. npm refuses to republish a version, so that is not a mistake
 * anybody can take back.
 *
 * **It does not stand in the workflow's way, and the reason is a detail of
 * npm's lifecycle rather than a check on `CI`.** `prepublishOnly` runs when npm
 * publishes a DIRECTORY. The publish job publishes the tarball that `verify`
 * already packed (`npm publish fleetless-contracts-*.tgz`), and npm runs no
 * prepare/prepack lifecycle for a tarball argument — verified by running both
 * forms with `--dry-run`.
 *
 * So this refuses unconditionally rather than reading an environment variable.
 * A guard whose bypass is `CI=1` is a guard with a documented bypass.
 *
 * What makes it fail: `npm publish` in this directory. What makes it stay out
 * of the way: `npm publish <tarball>`, which is what the `publish` job does.
 */
console.error(`
  Refusing to publish @fleetless/contracts from a working tree.

  Releases are made by the GitHub \`release\` workflow's \`publish\` job, from
  the tarball its \`verify\` job packed after the typecheck, the suite, the
  artifact staleness gate and \`pnpm run test:pack\`. See "Releasing" in
  CONTRIBUTING.md.

    1. bump the version in package.json and add a dated CHANGELOG.md heading
    2. commit, push, let \`verify\` go green
    3. tag vX.Y.Z and push the tag

  If you are the workflow and you are seeing this, you are publishing a
  directory rather than the packed tarball, and the tarball is what the checks
  were run against.
`)
process.exit(1)
