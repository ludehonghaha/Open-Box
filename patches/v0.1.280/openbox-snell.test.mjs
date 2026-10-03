import assert from 'node:assert/strict'
import test from 'node:test'
import { NODE_TYPES } from './node-model.mjs'
import { emitOutbound } from './emit-outbound.mjs'
import { parseShareLink, parseSurgeSnellLine } from './sharelink.mjs'
import { parseSubscription } from './subscription.mjs'
import { parseClashProxies } from './clash.mjs'
import { parseSingboxOutbounds } from './singbox-in.mjs'
import { parseChainNode, chainNodes } from './chain-proxy.mjs'

test('Snell is a first-class node type', () => {
  assert.equal(NODE_TYPES.includes('snell'), true)
})

test('snell:// v5 keeps source semantics but emits sing-box v4 wire compatibility', () => {
  const n = parseShareLink('snell://secret-psk@203.0.113.10:4904?version=5#NoBrand-Snell-v5')
  assert.equal(n.type, 'snell')
  assert.equal(n.fields.version, 5)
  assert.equal(n.fields.psk, 'secret-psk')
  const o = emitOutbound(n)
  assert.deepEqual(o, {
    type: 'snell', tag: 'NoBrand-Snell-v5', server: '203.0.113.10', server_port: 4904,
    version: 4, psk: 'secret-psk',
  })
})

test('Surge Snell v5 line imports directly', () => {
  const line = 'bug7nobrand = snell, 203.0.113.11, 4904, psk = AbC/12+xy, version = 5'
  const n = parseSurgeSnellLine(line)
  assert.equal(n.tag, 'bug7nobrand')
  assert.equal(n.type, 'snell')
  assert.equal(n.server, '203.0.113.11')
  assert.equal(n.server_port, 4904)
  assert.equal(n.fields.psk, 'AbC/12+xy')
  assert.equal(n.fields.version, 5)
  assert.equal(emitOutbound(n).version, 4)

  const parsed = parseSubscription(line)
  assert.equal(parsed.format, 'surge-snell')
  assert.equal(parsed.nodes.length, 1)
  assert.equal(parsed.nodes[0].type, 'snell')
})

test('Clash-like Snell and native sing-box Snell JSON import', () => {
  const clash = parseClashProxies(`proxies:
  - name: NB-Snell
    type: snell
    server: 203.0.113.12
    port: 4904
    psk: abc123
    version: 5
`)
  assert.equal(clash.nodes.length, 1)
  assert.equal(clash.nodes[0].type, 'snell')
  assert.equal(emitOutbound(clash.nodes[0]).version, 4)

  const native = parseSingboxOutbounds(JSON.stringify({ outbounds: [
    { type: 'snell', tag: 'SB-Snell', server: '203.0.113.13', server_port: 4904, version: 4, psk: 'abc123' },
  ] }))
  assert.equal(native.nodes.length, 1)
  assert.equal(native.nodes[0].type, 'snell')
  assert.equal(emitOutbound(native.nodes[0]).version, 4)
})

test('Snell can be a real detour chain node', () => {
  const line = '沪日-Snell = snell, 203.0.113.14, 4904, psk = chain-secret, version = 5'
  const parsed = parseChainNode(line)
  assert.equal(parsed.node.type, 'snell')
  const [chain] = chainNodes({ chainProxies: [{ id: 'c1', enabled: true, name: '沪日链路', link: line, upstream: 'JP落地' }] })
  const out = emitOutbound(chain)
  assert.equal(out.type, 'snell')
  assert.equal(out.version, 4)
  assert.equal(out.detour, 'JP落地')
})

test('Snell v6 remains v6 and keeps shaping mode', () => {
  const n = parseShareLink('snell://123456789012@203.0.113.15:4904?version=6&mode=unshaped#Snell-v6')
  const o = emitOutbound(n)
  assert.equal(o.version, 6)
  assert.equal(o.psk, '123456789012')
  assert.equal(o.mode, 'unshaped')
})
