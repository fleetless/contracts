// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { datapointConfig, ROBOT_DATAPOINT_FIELDS } from '../src/index.js'

/**
 * `ROBOT_DATAPOINT_FIELDS` is a claim about the bridge that two other test
 * suites check. This one checks only that it is well formed: every entry is a
 * field the schema has, so a rename in the schema cannot leave a stale path
 * that nobody on either side would notice.
 */

/** Every field of a datapoint as a path, with `numeric` and `retention` one level down. */
function datapointFieldPaths(): string[] {
  const groups = {
    numeric: datapointConfig.shape.numeric.unwrap().shape,
    retention: datapointConfig.shape.retention.unwrap().shape,
  }
  return Object.keys(datapointConfig.shape).flatMap((field) =>
    field in groups ? Object.keys(groups[field as keyof typeof groups]).map((leaf) => `${field}.${leaf}`) : [field],
  )
}

describe('ROBOT_DATAPOINT_FIELDS', () => {
  it('names only fields a datapoint has', () => {
    const paths = datapointFieldPaths()
    expect(ROBOT_DATAPOINT_FIELDS.filter((field) => !paths.includes(field))).toEqual([])
  })

  it('names a group by its fields, never the group itself', () => {
    // `retention` whole would hide which half of it the bridge reads, and
    // that half is the whole question.
    expect(ROBOT_DATAPOINT_FIELDS).not.toContain('numeric')
    expect(ROBOT_DATAPOINT_FIELDS).not.toContain('retention')
  })

  it('is sorted and has no duplicates, so a diff of it reads as a diff', () => {
    expect([...new Set(ROBOT_DATAPOINT_FIELDS)].sort()).toEqual([...ROBOT_DATAPOINT_FIELDS])
  })

  it('carries retention.enabled, the switch of the robot buffer, and leaves out what the bridge never reads', () => {
    expect(ROBOT_DATAPOINT_FIELDS).toContain('retention.enabled')
    expect(ROBOT_DATAPOINT_FIELDS).toContain('retention.max_buffer_values')
    expect(ROBOT_DATAPOINT_FIELDS).not.toContain('retention.interval_seconds')
    expect(ROBOT_DATAPOINT_FIELDS).not.toContain('numeric.unit')
  })

  it('ships to constants.json for the bridge', () => {
    const constants = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'artifacts', 'constants.json'), 'utf8'))
    expect(constants.ROBOT_DATAPOINT_FIELDS).toEqual([...ROBOT_DATAPOINT_FIELDS])
  })
})
