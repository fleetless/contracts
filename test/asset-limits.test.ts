// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'

import { ASSET_UPLOAD_HEADERS } from '../src/rest.js'
import { ASSET_UPLOAD_MAX_BYTES, assetListResponse, assetSyncBusyDetails, assetSyncStatus, assetFailure, assetFailureKind, urdfCompleteness } from '../src/assets.js'

const runningSync = {
  sync_id: '33333333-3333-4333-8333-333333333333',
  robot_id: '11111111-1111-4111-8111-111111111111',
  state: 'running' as const,
  done: 3,
  total: 10,
  failed: [],
  reason: null,
  started_at: '2026-08-19T10:00:00.000Z',
  updated_at: '2026-08-19T10:00:03.000Z',
}

describe('der Deckel, den beide Seiten kennen', () => {
  it('steht als eine Zahl im Vertrag, nicht als zwei in zwei Repos', () => {
    // Die Bridge hatte einmal eine geratene Zahl, die Cloud eine eigene.
    // Eine Grenze, die der Sender raet und der Empfaenger durchsetzt, ist keine
    // Grenze — sie sind zwei Zahlen, die uebereinstimmen, bis eine sich aendert.
    expect(ASSET_UPLOAD_MAX_BYTES).toBe(64 * 1024 * 1024)
    expect(Number.isInteger(ASSET_UPLOAD_MAX_BYTES)).toBe(true)
  })

  it('rx1s groesstes echtes Mesh liegt darueber — die Zahl ist jetzt an Daten messbar', () => {
    // Gemessen am 2026-08-18 auf rx1: base.dae. Der Test haelt die Tatsache
    // fest, nicht die Entscheidung — ob der Deckel steigt, ist Andres Sache.
    const baseDae = 193_886_766
    expect(baseDae).toBeGreaterThan(ASSET_UPLOAD_MAX_BYTES)
    // Und base.stl liegt darunter: der Sync haette weiterlaufen koennen.
    expect(39_525_034).toBeLessThan(ASSET_UPLOAD_MAX_BYTES)
  })

  it('kuendigt die Groesse in einem eigenen Kopf an, damit die Absage vor dem Koerper entstehen kann', () => {
    // Fastifys bodyLimit greift im Content-Type-Parser, also vor dem
    // Handler — der strukturierte Fehler hatte keinen erreichbaren Erzeuger.
    expect(ASSET_UPLOAD_HEADERS.size).toBe('x-fleetless-asset-size')
    expect(new Set(Object.values(ASSET_UPLOAD_HEADERS)).size).toBe(Object.values(ASSET_UPLOAD_HEADERS).length)
  })
})

describe('ein laufender Sync ist adressierbar', () => {
  it('die busy-Absage nennt den Sync, nicht nur den Zustand', () => {
    // W6bs Lehre, eine Ebene weiter: ein Abbruch nennt seinen Job, eine
    // Freigabe ihre Session, und eine busy-Absage ihren Sync.
    const d = { sync_id: runningSync.sync_id, started_at_ms: 1787130000000 }
    expect(assetSyncBusyDetails.safeParse(d).success).toBe(true)
    const { sync_id: _dropped, ...ohneId } = d
    expect(assetSyncBusyDetails.safeParse(ohneId).success).toBe(false)
  })

  it('die Asset-Liste traegt den laufenden Sync — der Fall, den ein Reload erzeugt', () => {
    // Wer neu laedt, drueckt keinen Knopf; er fragt diese Liste. Deshalb
    // genuegen die busy-Details allein nicht.
    const body = { assets: [], urdf: { present: false, mesh_count: 0, missing: [] }, urdf_available: null }
    expect(assetListResponse.safeParse({ ...body, active_sync: assetSyncStatus.parse(runningSync) }).success).toBe(true)
    expect(assetListResponse.safeParse({ ...body, active_sync: null }).success).toBe(true)
    // Pflichtfeld, kein Vorgabewert: ein Server, der schweigt, waere von
    // "kein Sync laeuft" nicht zu unterscheiden.
    expect(assetListResponse.safeParse(body).success).toBe(false)
  })
})

describe('der Deckel erreicht auch die Seite, die kein npm lesen kann', () => {
  it('steht im Artefakt, nicht nur im TypeScript-Export', async () => {
    // **Der eigentliche Fehler des ersten Delta-Commits.** Die Konstante war
    // fuer TS-Konsumenten da und fuer die Bridge nicht: die liest
    // ausschliesslich artifacts/constants.json (vendoriert als
    // fleetless_bridge/contracts_constants.json) und kann das npm-Paket nicht
    // importieren. Der Header war angekommen, die Zahl nicht — eine Grenze,
    // die eine Seite nicht lesen kann, ist wieder zwei Zahlen.
    //
    // Gefunden, BEVOR jemand darauf baute — in genau dem Commit, der das
    // Raten abschaffen sollte.
    const { readFileSync } = await import('node:fs')
    const artifact = JSON.parse(readFileSync(new URL('../artifacts/constants.json', import.meta.url), 'utf8'))
    expect(artifact.ASSET_UPLOAD_MAX_BYTES).toBe(ASSET_UPLOAD_MAX_BYTES)
  })
})

describe('a refusal that says how big, and how big it was allowed to be', () => {
  const at = (kind: string, details?: unknown) => assetFailure.safeParse({ reference: 'package://p/base.dae', kind, details })

  it('is its own kind, because `refused` already carries the sammel-sentinel', () => {
    // Beides unter `refused` zu legen wäre derselbe Fehler wie zwei Fakten
    // auf einem Schlüssel, den dieses Repo schon einmal ausgeräumt hat.
    expect(assetFailureKind.options).toContain('too_large')
    expect(assetFailureKind.options).toContain('refused')
  })

  it('cannot be published without the two numbers a developer would act on', () => {
    expect(at('too_large').success).toBe(false)
    expect(at('too_large', null).success).toBe(false)
    expect(at('too_large', { limit_bytes: ASSET_UPLOAD_MAX_BYTES, size_bytes: 193_886_766 }).success).toBe(true)
  })

  it('refuses size details on a kind they do not describe', () => {
    expect(at('unresolvable', { limit_bytes: 1, size_bytes: 2 }).success).toBe(false)
    expect(at('unresolvable').success).toBe(true)
  })
})

describe('missing names what is missing AND of what', () => {
  const uc = (missing: unknown) => urdfCompleteness.safeParse({ present: true, mesh_count: 3, missing })

  it('refuses the blanke string list the console had to guess from', () => {
    expect(uc(['package://p/wheel.stl']).success).toBe(false)
  })

  it('carries the element the cloud already knew and threw away', () => {
    const ok = uc([
      { uri: 'package://p/wheel.stl', element: 'mesh' },
      { uri: 'package://p/wheel.png', element: 'texture' },
    ])
    expect(ok.success).toBe(true)
    // Die Zahl daneben zählt Meshes. Genau diese Teilmenge darf sie widerlegen.
    expect(ok.success && ok.data.missing.filter((m) => m.element === 'mesh')).toHaveLength(1)
  })

  it('refuses an element nobody defined', () => {
    expect(uc([{ uri: 'x', element: 'collision' }]).success).toBe(false)
  })
})
