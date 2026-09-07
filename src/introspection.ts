// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { rosName, rosTypeName } from './common.js'

/**
 * Introspection: what the connected bridge can tell the
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
 * A resolved type of one robot. Custom types are per robot: two robots may
 * define `custom_msgs/msg/Speed` differently and both are right.
 *
 * Messages, services and actions all appear here, because a
 * `parameterSpec.name` has to resolve against *something*, and an action has
 * no flat field list — it has a goal, a result and a feedback tree.
 *
 * **Which tree a parameter resolves against** (the rule every consumer needs
 * and none should re-derive):
 *
 * | config kind | type | parameters resolve against |
 * |---|---|---|
 * | `actionConfig`    | `pkg/action/T` | `goal`     |
 * | `serviceConfig`   | `pkg/srv/T`    | `request`  |
 * | `publisherConfig` | `pkg/msg/T`    | `fields`   |
 *
 * `result`/`feedback`/`response` are never parameter targets — nobody passes
 * a result in. They are carried so the console can show what an action will
 * report back, and so a client knows the shape of `job.result` in advance.
 *
 * The `msg` member is the flat field list a message resolves to; the other
 * two carry one tree per part.
 */
export const typeDefinition = z.discriminatedUnion('kind', [
  z.object({
    name: rosTypeName,
    kind: z.literal('msg'),
    fields: z.array(typeField),
  }),
  z.object({
    name: rosTypeName,
    kind: z.literal('srv'),
    request: z.array(typeField),
    response: z.array(typeField),
  }),
  z.object({
    name: rosTypeName,
    kind: z.literal('action'),
    goal: z.array(typeField),
    result: z.array(typeField),
    feedback: z.array(typeField),
  }),
])
export type TypeDefinition = z.infer<typeof typeDefinition>

/**
 * The tree a message template resolves against, per the table above.
 *
 * What resolves against it is a **placeholder's position in the template** —
 * the field the `${name}` sits on — and not the parameter's name.
 * `parameterSpec` has no `name`; `parameters` is a record keyed by name, and
 * the format decouples that name from the field path on purpose, so a
 * parameter survives its field moving in the tree.
 *
 * One helper so cloud, console and SDK cannot each pick a different field.
 */
export function parameterFieldsOf(def: TypeDefinition): TypeField[] {
  switch (def.kind) {
    case 'msg':
      return def.fields
    case 'srv':
      return def.request
    case 'action':
      return def.goal
  }
}
