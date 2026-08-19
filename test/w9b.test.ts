import { describe, expect, it } from 'vitest'

import { ASSET_UPLOAD_HEADERS } from '../src/rest.js'
import { ASSET_UPLOAD_MAX_BYTES, assetListResponse, assetSyncBusyDetails, assetSyncStatus } from '../src/assets.js'

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

describe('W9b — der Deckel, den beide Seiten kennen', () => {
  it('steht als eine Zahl im Vertrag, nicht als zwei in zwei Repos', () => {
    // DEF-127: die Bridge hatte eine geratene Zahl, die Cloud eine eigene.
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
    // DEF-116: Fastifys bodyLimit greift im Content-Type-Parser, also vor dem
    // Handler — der strukturierte Fehler hatte keinen erreichbaren Erzeuger.
    expect(ASSET_UPLOAD_HEADERS.size).toBe('x-fleetless-asset-size')
    expect(new Set(Object.values(ASSET_UPLOAD_HEADERS)).size).toBe(Object.values(ASSET_UPLOAD_HEADERS).length)
  })
})

describe('W9b — ein laufender Sync ist adressierbar', () => {
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
