// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod'
import { mailStatus } from './identity.js'

/**
 * **Feedback: a message from a developer to the people who build Fleetless.**
 *
 * The console's feedback modal sends it; the cloud stores it first and mails
 * it afterwards, so a message is never lost to a mail failure. Who sent it and
 * from which org is the caller's session, never the body: the body carries
 * only what the developer chose to say and the page they said it on.
 */

/** The four kinds the console's modal offers. */
export const FEEDBACK_KINDS = ['idea', 'problem', 'question', 'other'] as const
export const feedbackKind = z.enum(FEEDBACK_KINDS)

/** Longest message the cloud stores; the console's counter starts at 4 500. */
export const FEEDBACK_MESSAGE_MAX = 5000

export const feedbackRequest = z.object({
  kind: feedbackKind.meta({
    description: 'What the message is: an `idea`, a `problem`, a `question` or `other`. It only sorts the inbox; it changes nothing about how the message is handled.',
  }),
  message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX).meta({
    description: 'What the developer wrote, trimmed. At most 5000 characters; a message that is only whitespace is refused.',
  }),
  page: z.string().startsWith('/').max(512).meta({
    description: 'The console path the message was sent from, e.g. `/robots/:id/jobs` with its real id. A path, never a full URL, so no host and no query string reach the inbox by accident.',
  }),
}).strict()

export const feedbackResponse = z.object({
  id: z.uuid().meta({
    description: 'The stored message. It exists whatever `mail` says.',
  }),
  mail: mailStatus.meta({
    description: 'What happened to the notification mail: `sent`, `failed`, or `not_configured` when this cloud has no feedback address. The message is stored in every case, so a client shows success for all three.',
  }),
}).strict()

export type FeedbackKind = z.infer<typeof feedbackKind>
export type FeedbackRequest = z.infer<typeof feedbackRequest>
export type FeedbackResponse = z.infer<typeof feedbackResponse>
