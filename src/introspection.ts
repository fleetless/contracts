import { z } from 'zod'
import { rosName, rosTypeName } from './common.js'

/**
 * Introspection (spec §4.1, §4.5): what the connected bridge can tell the
 * cloud about the robot's ROS graph, so the console can offer a quick pick
 * instead of a blank text field.
 *
 * Introspection is an *enrichment*, never a precondition — a robot that has
 * never been connected is still fully configurable.
 */

/** One entry of the ROS graph: a name and the types announced on it. */
export const rosGraphEntry = z.object({
  name: rosName,
  types: z.array(rosTypeName).min(1),
})
export type RosGraphEntry = z.infer<typeof rosGraphEntry>

/**
 * A snapshot of the graph. `captured_at_ms` is the bridge's clock at capture
 * time, so the console can say how old the picture is.
 */
export const rosGraph = z.object({
  topics: z.array(rosGraphEntry),
  services: z.array(rosGraphEntry),
  actions: z.array(rosGraphEntry),
  captured_at_ms: z.number().int().nonnegative(),
})
export type RosGraph = z.infer<typeof rosGraph>

/**
 * One field of a message type. `fields` is null for primitives and set for
 * nested messages; `array` marks sequences of whatever `type` says.
 */
export interface TypeField {
  name: string
  type: string
  array: boolean
  fields: TypeField[] | null
}

export const typeField: z.ZodType<TypeField> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(128),
    type: z.string().min(1).max(255),
    array: z.boolean(),
    fields: z.array(typeField).nullable(),
  }),
)

/**
 * A resolved type of one robot. Custom types are per robot (spec §4.5): two
 * robots may define `custom_msgs/msg/Speed` differently and both are right.
 *
 * W2 resolves messages only — service and action trees arrive in W4 with the
 * parameters that need them.
 */
export const typeDefinition = z.object({
  name: rosTypeName,
  kind: z.literal('msg'),
  fields: z.array(typeField),
})
export type TypeDefinition = z.infer<typeof typeDefinition>
