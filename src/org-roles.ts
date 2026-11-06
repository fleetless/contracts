// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { ACCESS_KINDS, MAX_ORG_ROLES, ROLE_NAME_MAX, roleKey } from './rights.js'
import type { AccessKind } from './rights.js'

/**
 * Organization roles on the wire: the roles themselves, what names them, and
 * the organization's defaults.
 *
 * A role belongs to the organization, not to an app. Its **key** is what
 * `fleetless.yaml` and every assignment write; its **name** is what a person
 * reads, and changing it changes nothing about rights. A role inherits from
 * any number of other roles, and the only change the cloud refuses is one that
 * would make a role inherit from itself (`role_cycle`).
 *
 * **A key that names no role is a warning and never an error**, wherever it is
 * written: it grants nothing, and `GET /api/org/roles` lists it under
 * `dangling` with every place that names it. That is what makes deleting or
 * renaming a role safe to do first and tidy up after.
 */

/** A role's display name: free text, trimmed, 1 to 60 characters. */
const roleName = z.string().trim().min(1).max(ROLE_NAME_MAX)

/**
 * A place that writes a role key, as the role list, the rename preview and
 * the dangling-reference list all name it.
 *
 * One flat shape for every kind, with `null` for what a kind does not have,
 * so a client renders a row without switching on `kind` to find a field.
 */
export const referencePlace = z.object({
  kind: z.enum(['config', 'collection_schema', 'app_user', 'invitation', 'app_default', 'role_inherits', 'org_default']).meta({
    description:
      'What writes the key: `config` is a `role` or `access` value in a robot\'s `fleetless.yaml`, `collection_schema` an `access` entry of a collection ' +
      'in an app\'s collections schema, `app_user` an app user who holds it, `invitation` an invitation that carries it, `app_default` an app\'s ' +
      'default role, `role_inherits` another role that inherits from it, and `org_default` one of the organization\'s defaults.',
  }),
  label: z.string().meta({
    description: 'What a person reads to find the place: the robot name (`config`), the app name (`collection_schema`, `app_default`), the e-mail address of the app user or of the invitee (`app_user`, `invitation`), the name of the inheriting role (`role_inherits`), or the access kind of an organization default (`org_default`).',
  }),
  path: z.string().nullable().meta({
    description:
      'Where the key is written. For `config`, the place in the YAML, such as `services.arm_home.role` or `access.rules[1].role`; for ' +
      '`collection_schema`, the place in the collections schema, such as `collections.notes.access.update.own[1]`; for ' +
      '`role_inherits`, the key of the role that inherits from it, because display names are not unique; `null` for every other kind.',
  }),
  robot_id: z.uuid().nullable().meta({
    description: 'The robot whose document holds the key (`config`); `null` for every other kind.',
  }),
  app_id: z.uuid().nullable().meta({
    description: 'The app the key belongs to: the app whose collections schema holds it (`collection_schema`), or the app of the user, invitation or default role (`app_user`, `invitation`, `app_default`); `null` for every other kind.',
  }),
  user_id: z.uuid().nullable().meta({
    description: 'The app user who holds the key (`app_user`); `null` for every other kind.',
  }),
  document: z.enum(['published', 'draft']).nullable().meta({
    description: 'Which version of the document holds the key (`config`: the robot\'s configuration, `collection_schema`: the app\'s collections schema): the published one or the draft; `null` for every other kind.',
  }),
  new_version: z.number().int().positive().nullable().meta({
    description:
      'For a published document (`config` or `collection_schema`), the version number a rename with `update_references` would give it, a copy that differs only in the key; ' +
      '`null` for a draft and for every place that is no document.',
  }),
})
export type ReferencePlace = z.infer<typeof referencePlace>

/** One role as `GET /api/org/roles` lists it, with how much depends on it. */
export const orgRole = z.object({
  key: roleKey.meta({
    description: 'The role\'s key, as `fleetless.yaml` and every assignment write it. Unique in the organization.',
  }),
  name: roleName.meta({
    description: 'The display name, 1 to 60 characters and trimmed. Changing it changes nothing about rights.',
  }),
  inherits: z.array(z.string()).meta({
    description:
      'The keys of the roles this one inherits from. A role holds whatever its parents hold, and theirs in turn. A key that names no role ' +
      'is kept as written; inheritance through it grants nothing, and the key appears under `dangling`.',
  }),
  users: z.number().int().nonnegative().meta({
    description: 'App users, in every app of the organization, who hold this role.',
  }),
  invitations: z.number().int().nonnegative().meta({
    description: 'Invitations that carry this role.',
  }),
  app_defaults: z.number().int().nonnegative().meta({
    description: 'Apps that use this role as their default role.',
  }),
  references: z.number().int().nonnegative().meta({
    description: 'Places in documents that name this role, such as a `role` in a robot\'s `fleetless.yaml` or an `access` entry in an app\'s collections schema. A rename with `update_references` rewrites them.',
  }),
})
export type OrgRole = z.infer<typeof orgRole>

/** A key that is written somewhere and is no role, with every place that writes it. */
export const danglingReference = z.object({
  key: z.string().meta({
    description: 'A key that names no role of the organization, because the role was deleted or renamed or never existed.',
  }),
  places: z.array(referencePlace).meta({
    description: 'Every place that writes the key. It grants nothing wherever it is written; creating a role with this key makes the places count again.',
  }),
})
export type DanglingReference = z.infer<typeof danglingReference>

/** What `GET /api/org/roles` answers. */
export const orgRoleListResponse = z.object({
  roles: z.array(orgRole).meta({
    description: 'The organization\'s roles with their counts, in the order they were created: the roles every organization starts with (`observe`, `operate` and `admin`) come first.',
  }),
  dangling: z.array(danglingReference).meta({
    description: 'Keys written somewhere that are no role, each with its places. Empty when nothing is out of step.',
  }),
})
export type OrgRoleListResponse = z.infer<typeof orgRoleListResponse>

/** `POST /api/org/roles`: a new role. Strict, so a field this route does not take is refused rather than dropped. */
export const createOrgRoleRequest = z.object({
  key: roleKey.meta({
    description: 'The new role\'s key, unique in the organization. Documents and assignments name the role by it.',
  }),
  name: roleName.meta({
    description: 'The display name, 1 to 60 characters; surrounding spaces are removed.',
  }),
  inherits: z.array(roleKey).max(MAX_ORG_ROLES).optional().meta({
    description:
      'Keys of the roles to inherit from. A key that names no role is accepted and warns. Left out, the role inherits from nobody; ' +
      'a key that would lead back to this role is refused with `role_cycle`.',
  }),
}).strict()
export type CreateOrgRoleRequest = z.infer<typeof createOrgRoleRequest>

/**
 * `PATCH /api/org/roles/:key`: change a role. Absent leaves a field alone.
 *
 * At least one field is required: an empty patch is a caller mistake, not a
 * request to do nothing. `update_references` and `confirm` only mean something
 * together with `key`.
 *
 * The one-field rule is a `.refine()`, which JSON Schema cannot express, so
 * `patch-org-role-request.schema.json` describes five independent optional
 * fields; the cloud is the only place an empty patch is refused.
 */
export const patchOrgRoleRequest = z.object({
  name: roleName.optional().meta({
    description: 'A new display name, 1 to 60 characters; surrounding spaces are removed.',
  }),
  inherits: z.array(roleKey).max(MAX_ORG_ROLES).optional().meta({
    description: 'The role\'s parents from now on. It replaces the whole list; `[]` removes every parent. A list that would lead back to this role is refused with `role_cycle`.',
  }),
  key: roleKey.optional().meta({
    description:
      'A new key. On its own, the rename is accepted at once and everything that still names the old key turns into a warning. ' +
      'To rewrite those places as well, add `update_references`.',
  }),
  update_references: z.boolean().optional().meta({
    description:
      'With `key`: rewrite every place that names the old key to the new one, in one transaction. Without `confirm`, when there are places ' +
      'to rewrite the call changes nothing and answers `409 confirmation_required` with the preview; a rename with none applies at once and ' +
      'needs no token.',
  }),
  confirm: z.string().min(1).optional().meta({
    description: 'The `confirm` token of the preview the caller was shown. It confirms that preview only; if the places to rewrite have changed since, the call answers a new preview.',
  }),
}).strict().refine((patch) => Object.values(patch).some((value) => value !== undefined), {
  message: 'A patch names at least one field to change.',
})
export type PatchOrgRoleRequest = z.infer<typeof patchOrgRoleRequest>

/**
 * What a rename with `update_references` would rewrite: the `details` of the
 * `409 confirmation_required` that answers it. Repeating the same request with
 * `confirm` set to this token applies the rename.
 */
export const roleRenamePreview = z.object({
  from: z.string().meta({ description: 'The key being renamed.' }),
  to: z.string().meta({ description: 'The key it would become.' }),
  references: z.array(referencePlace).meta({
    description: 'Every place that would be rewritten, each with the document it is in and, for a published document, the version the rewrite would create.',
  }),
  reference_count: z.number().int().nonnegative().meta({
    description: 'How many places the rename would rewrite.',
  }),
  confirm: z.string().meta({
    description: 'The token that confirms this preview. It only fits the effects listed here: when anything they cover changes, the token is stale and the call answers a new preview.',
  }),
})
export type RoleRenamePreview = z.infer<typeof roleRenamePreview>

/** What each kind of access covers; one place so the request, the response and the docs say the same. */
const KIND_SCOPE: Record<AccessKind, string> = {
  read: 'Reading datapoints and cameras.',
  invoke: 'Calling services and starting actions.',
  publish: 'Driving a robot through its publishers.',
  assets: 'A robot\'s asset files, such as its URDF and meshes.',
  job_history: 'The history of a robot\'s jobs.',
}

/** One property per access kind, so a kind added to `ACCESS_KINDS` is a compile error here and not a silent gap. */
function perKind<T extends z.ZodType>(make: (scope: string) => T): Record<AccessKind, T> {
  return Object.fromEntries(ACCESS_KINDS.map((kind) => [kind, make(KIND_SCOPE[kind])])) as Record<AccessKind, T>
}

/** What `GET` and `PUT /api/org/roles/defaults` answer: who holds each kind of access when a robot's configuration says nothing. */
export const roleDefaultsResponse = z.object({
  defaults: z.object(perKind((scope) => z.array(z.string()).meta({
    description: `${scope} The roles that hold this kind of access by default; an empty list means nobody does, however senior the role.`,
  }))).meta({
    description: 'Every kind of access, each with the keys of the roles that hold it when a robot\'s published configuration names nobody.',
  }),
})
export type RoleDefaultsResponse = z.infer<typeof roleDefaultsResponse>

/** One kind's default as a caller may write it: a role, several roles, or `null`/`[]` for nobody. */
const defaultHolders = (scope: string) => z.union([roleKey, z.array(roleKey).max(MAX_ORG_ROLES), z.null()], {
  error: (issue) => (issue.code === 'invalid_union'
    ? 'A default is one role key, `operate`, a list of keys, `[operate, admin]`, or `null` for nobody.'
    : undefined),
}).optional().meta({
  description: `${scope} One role key, a list of keys, or \`null\` or \`[]\` for nobody. Left out, the kind keeps what it has. A key that names no role is accepted and warns.`,
})

/** `PUT /api/org/roles/defaults`: change some defaults and leave the others as they are. */
export const putRoleDefaultsRequest = z.object({
  defaults: z.object(perKind(defaultHolders)).strict().meta({
    description: 'The kinds to change. A kind that is not named keeps its current default, so this is a patch of the defaults and not a replacement.',
  }),
}).strict()
export type PutRoleDefaultsRequest = z.infer<typeof putRoleDefaultsRequest>
