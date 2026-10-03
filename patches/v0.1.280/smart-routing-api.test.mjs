import assert from 'node:assert/strict'
import test from 'node:test'
import { createNode } from '../engine/node-model.mjs'
import { builtinDefaults } from '../engine/user-groups.mjs'
import { planSmartRouting } from './smart-routing.mjs'

const node = (tag, server, type = 'shadowsocks', fields = { method: 'aes-256-gcm', password: 'pw' }) => createNode({ tag, type, server, server_port: type === 'snell' ? 4904 : 8388, fields, source: 'clash' })
const nodes = [
  node('NoBrand-Snell', '203.0.113.10', 'snell', { version: 5, psk: 'secret' }),
  node('Gen2', '203.0.113.20'), node('HK-CMIN2', '203.0.113.30'), node('US-West', '203.0.113.40'),
]
const store = {
  getProfile: () => ({ ipv6: false, directForNodes: false, dns: { mode: 'hijack', split: true, direct: '223.5.5.5', proxy: '1.1.1.1' }, routing: { policies: [] }, chainProxies: [] }),
  getGroups: () => builtinDefaults(),
  getNodes: () => nodes,
}

test('preview plan resolves selected nodes and never returns landing credentials', () => {
  const plan = planSmartRouting({ store, input: {
    primaryHop: 'NoBrand-Snell', secondaryHop: 'Gen2', hkFallback: 'HK-CMIN2', usWestNodes: ['US-West'],
    jpLandingLink: 'anytls://super-secret@198.51.100.10:443?sni=jp.example.com#JP',
  } })
  assert.equal(plan.preview.japan.default, '沪日 · Snell → JP')
  assert.equal(plan.preview.policies.AI, '🇯🇵 沪日')
  assert.equal(plan.preview.policies.Netflix, '🇺🇸 美西')
  assert.deepEqual(plan.preview.landing, { type: 'anytls', server: '198.51.100.10', port: 443 })
  assert.equal(JSON.stringify({ summary: plan.summary, preview: plan.preview }).includes('super-secret'), false)
})

test('preview rejects missing selections before anything can be saved', () => {
  assert.throws(() => planSmartRouting({ store, input: { primaryHop: '不存在', usWestNodes: ['US-West'], jpLandingLink: 'anytls://pw@198.51.100.10:443#JP' } }), /主入口不存在/)
  assert.throws(() => planSmartRouting({ store, input: { primaryHop: 'Gen2', usWestNodes: ['US-West'], jpLandingLink: 'anytls://pw@198.51.100.10:443#JP' } }), /主入口必须是 Snell/)
  assert.throws(() => planSmartRouting({ store, input: { primaryHop: 'NoBrand-Snell', usWestNodes: ['不存在'], jpLandingLink: 'anytls://pw@198.51.100.10:443#JP' } }), /美西节点不存在/)
  assert.throws(() => planSmartRouting({ store, input: { primaryHop: 'NoBrand-Snell', usWestNodes: ['US-West'], jpLandingLink: 'garbage' } }), /JP 落地节点无效/)
})
