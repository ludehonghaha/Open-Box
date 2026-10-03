import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConfig } from './config.mjs'
import { createNode } from './node-model.mjs'
import { builtinDefaults } from './user-groups.mjs'
import { buildSmartRoutingPreset } from './smart-routing-preset.mjs'

const ss = (tag, server) => createNode({ tag, type: 'shadowsocks', server, server_port: 8388, fields: { method: 'aes-256-gcm', password: 'pw' }, source: 'clash' })
const nodes = [
  createNode({ tag: 'NoBrand-Snell', type: 'snell', server: '203.0.113.10', server_port: 4904, fields: { version: 5, psk: 'secret' }, source: 'clash' }),
  ss('Gen2', '203.0.113.20'), ss('HK-CMIN2', '203.0.113.30'), ss('US-West', '203.0.113.40'),
]

const originalProfile = {
  dns: { mode: 'hijack', split: true, direct: '223.5.5.5', proxy: '1.1.1.1' },
  directForNodes: false,
  routing: { policies: [
    { id: 'ai-old', name: 'AI', rulesets: ['geosite-category-ai-!cn'], default: 'proxy' },
    { id: 'yt', name: 'Youtube', rulesets: ['geosite-youtube'], default: 'proxy' },
    { id: 'custom', name: '我自己的规则', domainSuffix: ['example.net'], default: 'direct' },
  ] },
  chainProxies: [{ id: 'keep-chain', enabled: true, name: '保留链路', link: 'socks5://203.0.113.90:1080#keep', upstream: 'Gen2' }],
}
const originalGroups = [...builtinDefaults(), { id: 'keep-group', name: '我自己的组', type: 'selector', mode: 'static', members: ['Gen2'] }]

test('smart preset composes existing primitives without deleting unrelated config', () => {
  const p = buildSmartRoutingPreset({
    currentProfile: originalProfile,
    currentGroups: originalGroups,
    primaryHop: 'NoBrand-Snell', secondaryHop: 'Gen2', hkFallback: 'HK-CMIN2', usWestNodes: ['US-West'],
    jpLandingLink: 'anytls://jp-secret@198.51.100.10:443?sni=jp.example.com&insecure=1#JP',
  })
  assert.ok(p.profilePatch.chainProxies.some((x) => x.id === 'keep-chain'))
  assert.ok(p.groups.some((x) => x.id === 'keep-group'))
  assert.equal(p.profilePatch.routing.policies.find((x) => x.name === 'AI').default, '🇯🇵 沪日')
  assert.equal(p.profilePatch.routing.policies.find((x) => x.name === 'Youtube').default, '🇺🇸 美西')
  assert.equal(p.profilePatch.routing.policies.find((x) => x.name === '我自己的规则').default, 'direct')

  const c = buildConfig({ nodes, userGroups: p.groups, profile: { ...originalProfile, ...p.profilePatch, ipv6: false, rejectQuic: false }, ruleLists: {} })
  const byTag = Object.fromEntries(c.outbounds.map((o) => [o.tag, o]))
  assert.equal(byTag['NoBrand-Snell'].version, 4)
  assert.equal(byTag['沪日 · Snell → JP'].detour, 'NoBrand-Snell')
  assert.equal(byTag['沪日 · Gen2 → JP'].detour, 'Gen2')
  assert.deepEqual(byTag['🇯🇵 沪日'].outbounds, ['沪日 · Snell → JP', '沪日 · Gen2 → JP', 'HK-CMIN2', '拒绝'])
  assert.equal(byTag.AI.default, '🇯🇵 沪日')
  assert.equal(byTag.Youtube.default, '🇺🇸 美西')
  assert.equal(byTag.Netflix.default, '🇺🇸 美西')
  assert.equal(byTag['国外'].default, '🇯🇵 沪日')
  assert.equal(byTag['国内'].default, '直连')
})

test('preset update is idempotent and optional secondary/HK are removed by stable ids only', () => {
  const first = buildSmartRoutingPreset({ currentProfile: originalProfile, currentGroups: originalGroups, primaryHop: 'NoBrand-Snell', secondaryHop: 'Gen2', hkFallback: 'HK-CMIN2', usWestNodes: ['US-West'], jpLandingLink: 'anytls://pw@198.51.100.10:443#JP' })
  const second = buildSmartRoutingPreset({ currentProfile: { ...originalProfile, ...first.profilePatch }, currentGroups: first.groups, primaryHop: 'NoBrand-Snell', usWestNodes: ['US-West'], jpLandingLink: 'anytls://pw2@198.51.100.11:443#JP2' })
  assert.equal(second.profilePatch.chainProxies.filter((x) => x.id === 'smart-jp-primary').length, 1)
  assert.equal(second.profilePatch.chainProxies.some((x) => x.id === 'smart-jp-secondary'), false)
  assert.equal(second.groups.some((x) => x.id === 'smart-route-hk'), false)
  assert.ok(second.groups.some((x) => x.id === 'keep-group'))
})
