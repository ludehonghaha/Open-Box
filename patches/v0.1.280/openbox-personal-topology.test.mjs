import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConfig } from './config.mjs'
import { createNode } from './node-model.mjs'
import { builtinDefaults } from './user-groups.mjs'

const ss = (tag, server, port = 8388) => createNode({
  tag, type: 'shadowsocks', server, server_port: port,
  fields: { method: 'aes-256-gcm', password: 'pw' }, source: 'clash',
})

const nodes = [
  createNode({ tag: 'NoBrand-Snell', type: 'snell', server: '203.0.113.10', server_port: 4904, fields: { version: 5, psk: 'snell-secret' }, source: 'clash' }),
  ss('Gen2', '203.0.113.20'),
  ss('HK-CMIN2', '203.0.113.30'),
  ss('US-West', '203.0.113.40'),
]

const userGroups = [
  ...builtinDefaults(),
  {
    id: 'jp-failover', name: '🇯🇵 沪日', type: 'failover', mode: 'static',
    lanes: [
      { id: 'primary', name: '主用', members: ['JP-via-Snell'] },
      { id: 'backup', name: '备用', members: ['JP-via-Gen2'] },
      { id: 'last', name: '第二备用', members: ['HK-CMIN2'] },
    ],
    failover: { timeoutMs: 5000, failureThreshold: 2, restorePrimary: true, recoveryHoldMs: 60000 },
  },
  { id: 'us-west', name: '🇺🇸 美西', type: 'selector', mode: 'static', members: ['US-West'] },
]

const profile = {
  ipv6: false,
  directForNodes: false,
  rejectQuic: false,
  dns: { mode: 'hijack', split: true, direct: '223.5.5.5', proxy: '1.1.1.1' },
  chainProxies: [
    { id: 'jp-snell', enabled: true, name: 'JP-via-Snell', link: 'anytls://jp-secret@198.51.100.10:443?sni=jp.example.com&insecure=1#JP', upstream: 'NoBrand-Snell' },
    { id: 'jp-gen2', enabled: true, name: 'JP-via-Gen2', link: 'anytls://jp-secret@198.51.100.10:443?sni=jp.example.com&insecure=1#JP', upstream: 'Gen2' },
  ],
  routing: {
    policies: [
      { id: 'ai', name: 'AI', default: '🇯🇵 沪日', rulesets: ['geosite-category-ai-!cn'] },
      { id: 'netflix', name: 'Netflix', default: '🇺🇸 美西', rulesets: ['geosite-netflix', 'geoip-netflix'] },
      { id: 'foreign', name: '国外', default: '🇯🇵 沪日', rulesets: ['geosite-gfw'] },
      { id: 'cn', name: '国内', default: 'direct', rulesets: ['geosite-cn', 'geoip-cn', 'geoip-private'] },
    ],
    fallbackName: '其他',
    fallbackDefault: 'direct',
  },
}

test('personal topology compiles to Snell-first JP chain + failover + site routing', () => {
  const c = buildConfig({ nodes, userGroups, profile, ruleLists: {
    'geosite-category-ai-!cn': { domain: true, ip: false },
    'geosite-netflix': { domain: true, ip: false },
    'geoip-netflix': { domain: false, ip: true },
    'geosite-gfw': { domain: true, ip: false },
    'geosite-cn': { domain: true, ip: false },
    'geoip-cn': { domain: false, ip: true },
    'geoip-private': { domain: false, ip: true },
  } })

  const byTag = Object.fromEntries(c.outbounds.map((o) => [o.tag, o]))
  assert.equal(byTag['NoBrand-Snell'].type, 'snell')
  assert.equal(byTag['NoBrand-Snell'].version, 4, 'source Snell v5 must emit sing-box v4 client')
  assert.equal(byTag['JP-via-Snell'].type, 'anytls')
  assert.equal(byTag['JP-via-Snell'].detour, 'NoBrand-Snell')
  assert.equal(byTag['JP-via-Gen2'].type, 'anytls')
  assert.equal(byTag['JP-via-Gen2'].detour, 'Gen2')

  assert.deepEqual(byTag['🇯🇵 沪日'].outbounds, ['JP-via-Snell', 'JP-via-Gen2', 'HK-CMIN2', '拒绝'])
  assert.equal(byTag['🇯🇵 沪日'].default, 'JP-via-Snell')
  assert.deepEqual(byTag['🇺🇸 美西'].outbounds, ['US-West'])

  assert.equal(byTag.AI.default, '🇯🇵 沪日')
  assert.equal(byTag.Netflix.default, '🇺🇸 美西')
  assert.equal(byTag['国外'].default, '🇯🇵 沪日')
  assert.equal(byTag['国内'].default, '直连')
  assert.equal(byTag['其他'].default, '直连')

  const rules = c.route.rules
  assert.ok(rules.some((r) => r.rule_set?.includes('geosite-category-ai-!cn') && r.outbound === 'AI'))
  assert.ok(rules.some((r) => r.rule_set?.includes('geosite-netflix') && r.outbound === 'Netflix'))
  assert.ok(rules.some((r) => r.rule_set?.includes('geosite-gfw') && r.outbound === '国外'))
  assert.ok(rules.some((r) => r.rule_set?.includes('geosite-cn') && r.outbound === '国内'))
})
