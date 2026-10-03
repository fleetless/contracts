// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ASSET_FILE_MAX_BYTES, ROBOT_ASSET_STORE_BYTES } from '../src/assets.js'
import { ERROR_CODES, fileTooLargeDetails } from '../src/errors.js'
import * as barrel from '../src/index.js'

describe('one file has its own limit, separate from the store', () => {
  it('is one gigabyte, and a separate constant from the store', () => {
    // Equal to the store today, and still its own export: the store can move without it.
    expect(ASSET_FILE_MAX_BYTES).toBe(1_000_000_000)
    expect(ROBOT_ASSET_STORE_BYTES).toBe(1_000_000_000)
    expect(barrel.ASSET_FILE_MAX_BYTES).toBe(ASSET_FILE_MAX_BYTES)
  })

  it('file_too_large is a code', () => {
    expect(ERROR_CODES).toContain('file_too_large')
    expect(barrel.ERROR_CODES).toContain('file_too_large')
  })

  it('the details name the limit and the size, or null for the size', () => {
    expect(fileTooLargeDetails.safeParse({ max_bytes: 1_000_000_000, size_bytes: 1_400_000_000 }).success).toBe(true)
    expect(fileTooLargeDetails.safeParse({ max_bytes: 1_000_000_000, size_bytes: null }).success).toBe(true)
  })

  it('refuses a details object missing either key or carrying a non-integer', () => {
    expect(fileTooLargeDetails.safeParse({ max_bytes: 1_000_000_000 }).success).toBe(false)
    expect(fileTooLargeDetails.safeParse({ size_bytes: 5 }).success).toBe(false)
    expect(fileTooLargeDetails.safeParse({ max_bytes: 1_000_000_000, size_bytes: 1.5 }).success).toBe(false)
    expect(fileTooLargeDetails.safeParse({ max_bytes: 0, size_bytes: null }).success).toBe(false)
  })

  it('constants.json carries the limit, because the bridge reads only that', () => {
    const c = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'artifacts', 'constants.json'), 'utf8'))
    expect(c.ASSET_FILE_MAX_BYTES).toBe(ASSET_FILE_MAX_BYTES)
  })

  it('publishes the details schema as an artifact', () => {
    const s = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'artifacts', 'schema', 'file-too-large-details.schema.json'), 'utf8'))
    expect(Object.keys(s.properties).sort()).toEqual(['max_bytes', 'size_bytes'])
    expect(s.required.sort()).toEqual(['max_bytes', 'size_bytes'])
  })
})
