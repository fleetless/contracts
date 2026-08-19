import { z } from 'zod'

/**
 * The asset store (spec §4.6, W7).
 *
 * An **asset is an immutable file belonging to a robot**. It has a uuid and is
 * fetched by it. There are no org-level assets and no public retrieval: every
 * read is authenticated and role-checked (`assets`, §3.3).
 *
 * **One authorization model — the `Authorization` header.** Not a signed URL,
 * not a cookie, not a token in a query string. The reason is not ergonomics
 * but the number of mechanisms: a second credential would carry its own
 * lifetime, its own renewal, its own rotation, and in every log the question
 * of which token that was. Directus solves the same problem with a cookie and
 * an `access_token` query parameter, and the cookie half does not transfer —
 * Fleetless has no interface of its own (§1), so the consumers of a robot's
 * assets sit on other origins.
 *
 * **The consequence, said out loud: this is not a CDN.** A shared cache must
 * not store a response to a request carrying `Authorization`. Assets are
 * immutable, so `Cache-Control: private, immutable` is correct and the
 * browser's own cache works fully; nothing edge-caches. Calling it a CDN would
 * promise something that does not happen. Signed URLs stay **additive** later —
 * a second endpoint, not a migration — precisely because assets are immutable
 * and uuid-addressed.
 *
 * ---
 *
 * **`texture` is its own member of `assetKind` and not `other` (W7a, D2).**
 *
 * Filing textures under `other` would be the catch-all this project has
 * already split five times, and it costs a real capability: a client that
 * renders a robot must know, from the asset list alone and before fetching
 * anything, which bytes it has to pre-fetch. Every load in the browser goes
 * through the SDK with the bearer token — there is no lazy second fetch a
 * renderer can make on its own account — so "what must be in memory before
 * anything renders" is a question the list has to be able to answer.
 *
 * A `texture` is an image referenced by the URDF's own `<material><texture>`
 * **or** by a mesh file internally (a `.dae`'s `<init_from>`). Both are
 * surfaces; neither is geometry; both must be resolvable by name.
 */
export const assetKind = z.enum(['urdf', 'mesh', 'texture', 'other'])
export type AssetKind = z.infer<typeof assetKind>

/**
 * The `name` a URDF asset carries.
 *
 * A mesh names itself — its `package://` URI is the only string anyone can
 * match against a workspace. A URDF has no such natural name, so producers
 * agree on one: `robot_description`, after the topic it comes from.
 *
 * **Its job changed once the store stopped overwriting it.** It was pinned
 * because the bridge and the cloud had settled on a value in conversation, and
 * conversations drift — then the gate found the cloud renaming every URDF to
 * `robot.urdf` regardless of what arrived, so the pinned value was decorative
 * and the contract looked authoritative while being ignored. The store now
 * keeps `asset.name` verbatim, which is what `asset.name`'s own comment
 * already promised.
 *
 * So this is now a **convention among producers**, not an agreement the store
 * enforces: it exists so two different bridges do not name the same thing two
 * ways and leave a developer looking at an inconsistent fleet. Nothing
 * validates it, and that is deliberate — the store's job is to record what it
 * was told.
 *
 * Consumers must not match on it. `kind === 'urdf'` is the reliable test; the
 * cloud identifies a robot's URDF row by kind alone, so a producer that sends
 * a different string updates the same singleton rather than orphaning a second.
 */
export const URDF_ASSET_NAME = 'robot_description'

export const asset = z.object({
  id: z.uuid(),
  robot_id: z.uuid(),
  kind: assetKind,
  /**
   * What the robot called it — for a mesh, the `package://` URI the URDF
   * references, verbatim. That is the only string a developer can match
   * against their own workspace, and matching is the whole job when a sync
   * comes back incomplete.
   *
   * **The naming rule for a file nothing in the URDF names (W7a, D2).** A
   * `.dae` carries its own image references — `<init_from>textures/skin.png`
   * — resolved by the renderer against *the `.dae`'s own directory*, and no
   * `package://` URI for them appears anywhere in the URDF. The rule is:
   *
   *     name = the .dae's package:// URI, directory part,
   *            joined with the internal reference, normalized.
   *
   * So `package://rx1_description/meshes/arm.dae` referencing
   * `textures/skin.png` uploads as
   * `package://rx1_description/meshes/textures/skin.png`.
   *
   * **This is the design's single point of failure and it is stated before
   * anything is built against it.** three.js resolves that internal reference
   * relative to wherever it loaded the `.dae` from and asks the loading
   * manager for the result; the client can only answer if the asset's name
   * still carries the same **relative tail** (`textures/skin.png`) that the
   * `.dae` asked for. Normalizing into a `package://` URI preserves that tail
   * exactly, keeps every name in one namespace a developer already reads, and
   * keeps `urdfCompleteness.missing` meaningful for files the URDF never
   * mentioned.
   *
   * A reference that escapes its package (`../../etc/passwd`) is **not**
   * renamed into something harmless — it is refused at the producer, by the
   * same containment check W7's K2 fix applied to `package://` resolution.
   * Two identical rules, one of which is enforced and one of which is
   * documented, is how W7's traversal happened in the first place.
   */
  name: z.string().min(1).max(500),
  media_type: z.string().min(1).max(120),
  size_bytes: z.number().int().nonnegative(),
  /**
   * The content hash, and the reason two robots sharing a mesh cost one copy.
   *
   * Exposed rather than kept internal because it is the only way a client can
   * tell "this is the same mesh I already have" across robots — and a 3D view
   * that re-downloads an identical arm for every robot in a fleet is the
   * predictable failure of a store that hides it.
   */
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.iso.datetime(),
})
export type Asset = z.infer<typeof asset>

/**
 * Whether a URDF can actually be rendered, which is not the same as whether it
 * was uploaded.
 *
 * `missing` carries **the reference, verbatim, that no asset answers** — for
 * a `package://` mesh the URI the bridge could not resolve in the workspace,
 * and since W7's security fix also the absolute paths and bare relative paths
 * a URDF may carry, which the extractor sees and the sync deliberately never
 * offers. The sentence used to say "the `package://` URIs" and the field
 * carried three kinds of string (Momus-W7); it is widened here rather than
 * narrowed, because a developer whose URDF names `/opt/meshes/arm.stl` is
 * entitled to be told that nothing will ever fetch it.
 *
 * The spec's example is "2 Meshes fehlen" and that number alone is a dead
 * end: it tells a developer to go looking through a workspace by hand. The
 * references are what they can act on, so the references travel.
 *
 * **Every entry must be actionable, and that is a constraint on the
 * producers, not on this field (W7a).** An entry a developer cannot make
 * disappear by fixing what it names is a defect in whoever put it there: for
 * a whole wave `<texture>` references were listed here and no sync would ever
 * offer them, so the honest instruction behind the list was "fix this, it
 * will not help".
 */
export const urdfCompleteness = z.object({
  /** Whether a URDF has been synced at all. Availability is a different question. */
  present: z.boolean(),
  /** How many distinct meshes the URDF references. */
  mesh_count: z.number().int().nonnegative(),
  /**
   * **Was fehlt, und wovon (W9b, DEF-081).**
   *
   * Vorher ein blankes `string[]`. Die Console meldete daraufhin *„N meshes
   * missing from the workspace"* — auch für eine fehlende **Textur**, während
   * `mesh_count` daneben eine andere Zahl nannte: zwei Angaben über denselben
   * Gegenstand, die einander widersprechen.
   *
   * Die Cloud wusste es die ganze Zeit: `extractReferencesByElement` markiert
   * jede Referenz mit ihrem Element und `buildAssetListResponse` warf die
   * Markierung wieder weg. **Die Antwort im Client zu raten wäre genau die
   * „neue Kopie", die die Registerzeile ausdrücklich ablehnt** — eine zweite
   * Herleitung derselben Tatsache, die von der ersten abweichen kann.
   */
  missing: z.array(z.object({
    uri: z.string().min(1).max(500),
    element: z.enum(['mesh', 'texture']),
  })),
})
export type UrdfCompleteness = z.infer<typeof urdfCompleteness>

/**
 * A sync is long-running and is therefore answered with something to watch,
 * never with a status that was true at the moment of asking.
 *
 * **`source` has one value, and that is deliberate.** §4.6 also names a manual
 * zip upload, and the first version of this shape had `'upload'` in the enum —
 * with **no body defined for the bytes**. An enum value with no producer and
 * no payload invites every consumer to guess a shape, and each guesses
 * differently; that is the exact defect Nimbus-W6c refused to introduce in
 * W6c, when the lead asked twice for an error code whose payload had moved.
 * The zip path is in `DEFERRALS.md` with a condition instead of sitting in the
 * wire as a promise.
 *
 * A single-member enum rather than dropping the field: the second source is a
 * question of when, not whether, and a caller that already names its source
 * does not change shape when the second one arrives.
 *
 * Caught by Eve-W7 asking what body `'upload'` takes, rather than building
 * against a guess.
 */
export const assetSyncRequest = z.object({
  source: z.enum(['bridge']),
}).strict()
/**
 * **And the route must read it (W7a).** Through W7 it did not: `{source:
 * 'bridge'}`, `{source:'upload'}`, `{nonsense:1}` and `{}` all behaved
 * identically, so the argument above — that a caller naming its source does
 * not change shape when the second one arrives — was true of the document and
 * false of the system. A shape with no consumer is not a contract; it is a
 * comment with a type.
 *
 * The decision is to keep the shape and **validate it, `.strict()`**, rather
 * than delete it. Deleting removes the record of why the enum has one member,
 * and the zip path is a question of when. Validation is what makes the single
 * member mean something: a caller who sends `'upload'` today learns that it
 * does not exist yet, instead of silently getting a bridge sync.
 */
export type AssetSyncRequest = z.infer<typeof assetSyncRequest>

export const assetSyncResponse = z.object({
  sync_id: z.uuid(),
})
export type AssetSyncResponse = z.infer<typeof assetSyncResponse>

/**
 * Progress of one sync.
 *
 * `failed` names the URIs that could not be resolved, and it is required
 * rather than optional: a sync that drops three meshes and reports success is
 * worse than one that fails outright, because the failure surfaces later, in a
 * renderer, as a robot with missing limbs and no explanation.
 *
 * **`failed` carries per-reference facts and `reason` carries the sync's own,
 * and that split is what M7 bought.** Three different kinds of string used to
 * reach `failed`: unresolvable `package://` URIs (the documented meaning), the
 * literal `robot_description` when a URDF *upload* failed, and English
 * sentences written by the cloud — "the robot disconnected mid-sync". The
 * console printed the array under *"these meshes could not be resolved"*, so a
 * developer whose robot dropped was told to go find a mesh named *the robot
 * disconnected mid-sync* (Momus-W7, M7).
 *
 * **Two of those three were defects and the third was not, which this
 * paragraph used to get wrong** (Argus-W7a, W7a review, reading the file top to
 * bottom). The cloud's English sentences do not belong here — that is what
 * `reason` is for. But `robot_description` is a **legitimate** entry: the URDF
 * is an asset that can fail to upload like any other, and W7a made that
 * explicit rather than removing it — see `assetFailure.reference`, which says
 * in as many words that not every entry is a mesh URI and a consumer must not
 * assume one. Read together with the old sentence *"`failed` is URIs and
 * nothing else"*, this file told a consumer the same value was both a defect
 * and a documented case.
 *
 * So the rule is: **anything that is not about one specific reference goes in
 * `reason`** — one human-readable sentence
 * about why the sync ended as it did, `null` when the outcome speaks for
 * itself. It also carries the distinction `bridgeAssetProgress.state` makes
 * and this shape could not — a sync **refused** because another was in flight
 * is not a sync that tried and failed.
 *
 * **`assetSyncState` was deliberately not widened to carry that.** Consumers
 * switch on it, a new member silently changes what every existing switch
 * covers, and "refused" is a *reason* for a terminal outcome rather than a
 * different one. Adding a field is additive; adding an enum member is not.
 */
/**
 * **Der Deckel, den beide Seiten kennen müssen (W9b).**
 *
 * Bis hierher hatte die Bridge eine eigene Zahl und die Cloud eine eigene, und
 * die Registerzeile dazu nannte die der Bridge beim Namen: *„a guess … chosen
 * as a starting number with no measurement behind it"* (DEF-127). Eine Grenze,
 * die der Sender rät und der Empfänger durchsetzt, ist keine Grenze — sie ist
 * zwei Zahlen, die zufällig übereinstimmen, bis eine von beiden sich ändert.
 *
 * Hier steht sie einmal. Die Bridge liest sie, **bevor** sie eine Datei in den
 * Speicher liest; die Cloud setzt sie durch. Ohne das kann die Bridge gar nicht
 * ablehnen, ohne 194 MB zu puffern — was am 2026-08-18 auf rx1 genau so passiert
 * ist (DEF-148).
 *
 * **Sie gilt je Datei, nicht je Sync**, und das steht hier, weil DEF-127 es
 * ausdrücklich verlangt hat: acht Meshes zu je 30 MiB passen durch, eine Datei
 * zu 65 MiB nicht. Wer sie für eine Obergrenze der Übertragung hält, rechnet
 * mit einer Schranke, die es nicht gibt — die Summe eines Syncs bindet das
 * Speicherkontingent der Organisation, und das ist eine andere Zahl an einer
 * anderen Stelle.
 *
 * **Die Zahl ist bewusst unverändert, und die Begründung hat zwei Fassungen
 * gebraucht — die Korrektur ist hier mehr wert als das Ergebnis.**
 *
 * Zuerst stand hier: *„rx1s echte Meshes sind gemessen — `base.dae`
 * 193.886.766 Bytes, also das 2,9-fache"*, im Präsens, als stünde das über
 * der heute laufenden Beschreibung. Gemessen am 2026-08-19 gegen die
 * **laufende** `robot_description`: acht `package://`-Referenzen, zusammen
 * 89.379.096 Bytes, die größte `RX1.dae` mit 38.229.621 — **keine über dem
 * Deckel.**
 *
 * Daraus habe ich dann geschlossen, `base.dae` werde *von keiner* rx1-URDF
 * referenziert. **Auch das war falsch, und zwar weil ich nur den aktuellen
 * Workspace geprüft hatte.** `src.old-20260730/rx1` und `.../rx1_linac`
 * referenzieren beide `base.dae` **und** `base.stl` und kennen `RX1.dae`
 * nicht — das ist die Beschreibung, die rx1 am 2026-08-18 lief, als DEF-148
 * gemessen wurde. Die Beobachtung von damals war korrekt und ihre Erklärung
 * auch.
 *
 * Was heute gilt: **welche Beschreibung rx1 fährt, entscheidet, ob der Deckel
 * reicht** — die aktuelle passt mit Abstand hinein, die vorherige um das
 * 2,9-fache nicht. Das ist keine Vertragsfrage, sondern eine über Speicher,
 * Übertragungszeit und Kontingente, und sie liegt bei André. Sie blockiert
 * nichts: W9bs Gate-Schritt 6 ist gegen die heute laufende Beschreibung
 * erreichbar, ohne dass jemand eine Zahl anfasst.
 */
export const ASSET_UPLOAD_MAX_BYTES = 64 * 1024 * 1024

export const assetTooLargeDetails = z.object({
  limit_bytes: z.number().int().positive(),
  size_bytes: z.number().int().positive(),
})
export type AssetTooLargeDetails = z.infer<typeof assetTooLargeDetails>

/**
 * Why one reference did not make it into the store.
 *
 * Three kinds because three things were already happening and only one word
 * was available for them:
 *
 * - **`unresolvable`** — the reference names nothing the producer can find, or
 *   nothing it is allowed to read (a `package://` URI absent from the
 *   workspace, an absolute path, a `.dae`-internal reference escaping its own
 *   package). **Permanent.** No retry changes it, and it is the only kind a
 *   reconciliation may treat as gone.
 * - **`upload_failed`** — the bytes exist and the transfer did not succeed.
 *   **Transient.** The asset is still wanted; a later sync will carry it.
 * - **`refused`** — never attempted, because a producer-side ceiling was hit
 *   (R9: a `.dae` with more internal references than one file or one sync will
 *   report). **Transient in the same sense**: nothing is known to be missing,
 *   only unexamined.
 *
 * A consumer that cannot act on the distinction may still print `reference`
 * alone and lose nothing it had before.
 */
export const assetFailureKind = z.enum(['unresolvable', 'upload_failed', 'refused', 'too_large'])
export type AssetFailureKind = z.infer<typeof assetFailureKind>

export const assetFailure = z.object({
  /**
   * What could not be provided, verbatim — the same string `asset.name` would
   * have stored and `urdfCompleteness.missing` reports, so a developer can
   * match it against their own workspace by eye. For a URDF upload failure it
   * is `URDF_ASSET_NAME`, which is **not** a mesh URI: a consumer rendering
   * this list must not assume every entry is one.
   */
  reference: z.string().min(1).max(500),
  kind: assetFailureKind,
  /**
   * **Die zwei Zahlen, und warum `too_large` eine eigene Art ist (W9b).**
   *
   * `refused` bedeutet *„nie versucht, weil eine Decke des Erzeugers erreicht
   * wurde"* — das passt auf eine Datei, die wegen ihrer Größe gar nicht erst
   * gelesen wurde, **und ebenso auf die Sammel-Sentinel**, mit der ein Sync
   * aufhört, einzelne Fehler zu benennen. Beides unter eine Art zu legen wäre
   * derselbe Fehler, den W9a eine Welle zuvor ausgeräumt hat: zwei Fakten auf
   * einem Schlüssel, von denen jeder den anderen überschreibt.
   *
   * Und ein Grund ohne Zahlen ist kein Grund, mit dem jemand etwas anfangen
   * kann. *„Zu groß"* beantwortet nicht, ob das Mesh zu verkleinern ist oder
   * die Grenze zu heben — `limit_bytes` und `size_bytes` tun es.
   *
   * Abwesend für jede andere Art — ein erzwungenes `details: null` auf jedem
   * `unresolvable` kauft nichts. Die Paarung ist unten **erzwungen**, nicht
   * beschrieben: ein Feld, dessen Regel nur im Kommentar steht, ist eine
   * Bitte.
   */
  details: assetTooLargeDetails.nullish(),
}).superRefine((f, ctx) => {
  // **Erzwungen, nicht beschrieben.** Eine Regel, die nur im Kommentar steht,
  // ist eine Bitte — und dieses Projekt hat mehrfach erlebt, dass ein Feld,
  // dessen Bedeutung nur daneben stand, mit etwas anderem gefüllt wurde.
  if (f.kind === 'too_large' && f.details == null) {
    ctx.addIssue({ code: 'custom', path: ['details'], message: '`too_large` without limit_bytes/size_bytes says nothing a developer can act on' })
  }
  if (f.kind !== 'too_large' && f.details != null) {
    ctx.addIssue({ code: 'custom', path: ['details'], message: 'size details belong to `too_large` only' })
  }
})
export type AssetFailure = z.infer<typeof assetFailure>

export const assetSyncState = z.enum(['running', 'succeeded', 'failed'])
export type AssetSyncState = z.infer<typeof assetSyncState>

export const assetSyncStatus = z.object({
  sync_id: z.uuid(),
  robot_id: z.uuid(),
  state: assetSyncState,
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /**
   * **Every entry says *why*, because reconciliation could not work without
   * it and a developer could not read it without it** (W7a review, André's
   * decision to fix rather than defer).
   *
   * It was a flat `string[]`, and **six producers wrote three different facts
   * into it indistinguishably**: a reference that resolves to nothing in the
   * workspace, a file that exists and whose transfer failed, and — since R9's
   * ceiling — one that was never attempted at all. The cost was paid twice
   * over. Reconciliation cannot tell *"no longer referenced"* from
   * *"referenced and not delivered"*, so N14 had to decline reconciling **any**
   * partial sync, leaving legitimately-removed assets stored and charged until
   * the next clean one. And the console prints the whole array under *"these
   * meshes could not be resolved"*, so a URDF upload failure — which arrives
   * as the literal `robot_description` — is shown to a developer as a mesh
   * they should go and find.
   *
   * `unresolvable` is the only kind reconciliation may drop: it is the only
   * one that means *this will not come back*. `upload_failed` and `refused`
   * both mean *we meant to provide this and did not*, which is the distinction
   * the union needs and the field could not carry.
   *
   * **Bounded, and the bound is a rule this file already wrote down one field
   * over** (Kassandra-W7a, W7a review). `asset.name` is `max(500)`; the same
   * names travelling here had no per-entry cap and no array cap at all.
   *
   * Why it matters became reachable in W7a. Before R6 an unresolvable
   * reference was silently dropped, so this array could only grow with files
   * that existed and failed to upload — bounded by the workspace. Once a
   * `.dae`'s internal references are reported, **one mesh reference expands
   * into a list bounded only by that file's own text.** Measured: a
   * 2,120,745-byte `.dae` with 17,331 unresolvable `<init_from>` refs produces
   * a terminal frame of 2,097,184 bytes — **32 bytes over
   * `MAX_WS_PAYLOAD_BYTES`** — and `ws` enforces `maxPayload` before the frame
   * is delivered, so the outcome is not a dropped frame but **the robot's
   * socket closed, mid-sync, by a file in its own workspace.**
   *
   * A producer that hits its own ceiling reports **one** entry saying so
   * rather than growing the list — the discipline gate step 5 already demands
   * of the upload rate limit: *fail naming the limit, rather than silently
   * reporting resolvable meshes as missing.*
   *
   * 1000 x 500 bytes is ~0.5 MiB of names, comfortably inside a 2 MiB frame.
   */
  failed: z.array(assetFailure).max(1000),
  /** Why the sync ended as it did, when that is not a per-URI fact. */
  reason: z.string().min(1).nullable(),
  started_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
})
export type AssetSyncStatus = z.infer<typeof assetSyncStatus>


export const assetListResponse = z.object({
  assets: z.array(asset),
  /**
   * Der gerade laufende Sync, oder `null` (W9b, DEF-147).
   *
   * **Der Fall, für den das hier steht, ist der Neuladen-Fall.** Die Console
   * hielt die `sync_id` nur im Speicher; ein Reload verlor die Fortschritts-
   * anzeige, und der Zustand war serverseitig da, über
   * `GET .../assets/sync/<id>` abfragbar — nur erreichte ihn niemand mehr, der
   * die id nicht aufgehoben hatte. Eine Seite, die frisch lädt, drückt keinen
   * Knopf; sie fragt diese Liste. Also muss die Liste es sagen.
   */
  active_sync: assetSyncStatus.nullable(),
  urdf: urdfCompleteness,
  /**
   * What the connected bridge says it *could* transfer, which is deliberately
   * separate from what has been transferred (§4.6: the bridge "meldet nur
   * Verfügbarkeit"). `null` when no bridge is connected — distinct from
   * `false`, because "no robot is online to ask" and "the robot has no URDF"
   * send a developer to two different places.
   *
   * **All three states are reachable as of W7a (R7).** They were not: the bridge
   * used to report availability from a subscription callback, which fires only
   * when a publisher *sends* something, so it could notice presence and never
   * absence — a robot that lost its URDF left the cloud holding the last thing
   * it heard, forever, and `true` was sticky. The fix is an **active**
   * `count_publishers` query on the bridge's own timer.
   *
   * **What a consumer still needs to know is the clock, not the gap.** An
   * ungraceful loss — the publisher process killed rather than shut down — is
   * noticed on **DDS's liveliness timeout**, not on the bridge's check
   * interval. Measured against a real bridge: ~1.6 s when the publisher calls
   * `destroy_node()`, **~19 s when it is `SIGKILL`ed**. So `true` can outlive
   * the truth by some seconds after a crash, and no amount of polling on our
   * side shortens it.
   *
   * The sticky-`true` gap was found by Rosie-W7 checking her own work against
   * the camera-health row of identical shape; the DDS clock was measured by
   * Rosie-W7a closing it, and this comment was still describing the gap a wave
   * after it was fixed (Momus-W7a, W7a review).
   */
  urdf_available: z.boolean().nullable(),
})
export type AssetListResponse = z.infer<typeof assetListResponse>

/**
 * What an `asset_too_large` refusal tells the caller — the same discipline as
 * `publisher_busy` and `job_queue_full`: a refusal that names a state and no
 * number leaves the caller unable to decide anything.
 */

/**
 * Was eine `busy`-Absage beim Asset-Sync mitgeben muss (W9b, DEF-147).
 *
 * Vorher antwortete die Cloud *„Robot <id> already has a sync in progress"* —
 * eine Absage, die einen **Zustand** benennt, aber nicht das **Ding** in diesem
 * Zustand. Der laufende Sync ist serverseitig beobachtbar und über
 * `GET .../assets/sync/<id>` abfragbar, nur erreichte ihn niemand mehr, der die
 * id nicht aufgehoben hatte. Genau die Form, die W6b eine ganze Welle lang
 * ausgeräumt hat: ein Abbruch ohne Job-Id, eine Freigabe ohne Session-Id.
 *
 * **Das allein genügt nicht**, und deshalb steht daneben `activeSync` auf der
 * Asset-Liste: Diese Details helfen nur dem, der den Knopf noch einmal drückt.
 * Wer die Seite neu lädt — der Fall, den André am 2026-08-18 hatte —, drückt
 * gar nichts und braucht den laufenden Sync im ersten `GET`.
 */
export const assetSyncBusyDetails = z.object({
  sync_id: z.uuid(),
  /** Wann er begann — damit „läuft noch" von „hängt seit einer Stunde" unterscheidbar ist. */
  started_at_ms: z.number().int().nonnegative(),
})
export type AssetSyncBusyDetails = z.infer<typeof assetSyncBusyDetails>
