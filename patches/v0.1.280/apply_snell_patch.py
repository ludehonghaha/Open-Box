#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
engine = root / 'panel' / 'server' / 'engine'

def edit(name, fn):
    p = engine / name
    s = p.read_text()
    out = fn(s)
    if out == s:
        raise SystemExit(f'patch produced no change: {name}')
    p.write_text(out)

def edit_path(rel, fn):
    p = root / rel
    s = p.read_text()
    out = fn(s)
    if out == s:
        raise SystemExit(f'patch produced no change: {rel}')
    p.write_text(out)

def replace_once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{label}: expected 1 match, got {n}')
    return s.replace(old, new, 1)

def patch_node_model(s):
    return replace_once(
        s,
        "  'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard', 'anytls', 'socks', 'http',\n",
        "  'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard', 'anytls', 'snell', 'socks', 'http',\n",
        'node types',
    )

def patch_emit(s):
    anchor = "  vmess: (n) => withTls(withTransport({ type: 'vmess', ...base(n), uuid: n.fields.uuid, alter_id: n.fields.alter_id ?? 0, security: n.fields.security || 'auto' }, n.fields), n.fields),\n"
    block = """  // Snell v5 server is wire-compatible with v4 for the normal TCP/UDP-over-TCP path.
  // sing-box intentionally exposes client versions 4 and 6 only, so preserve v5 in the
  // imported node but emit v4 on the wire. QUIC Proxy mode is intentionally unavailable.
  snell: (n) => {
    if (!n.fields.psk) throw new Error('snell requires psk')
    const requestedVersion = Number.parseInt(n.fields.version ?? 4, 10)
    const version = requestedVersion === 6 ? 6 : 4
    const o = { type: 'snell', ...base(n), version, psk: String(n.fields.psk) }
    if (n.fields.userkey) o.userkey = String(n.fields.userkey)
    if (n.fields.reuse === true) o.reuse = true
    if (n.fields.network === 'tcp' || n.fields.network === 'udp') o.network = n.fields.network
    if (version === 6) {
      if (n.fields.mode) o.mode = String(n.fields.mode)
    } else {
      if (n.fields.obfs_mode) o.obfs_mode = String(n.fields.obfs_mode)
      if (n.fields.obfs_host) o.obfs_host = String(n.fields.obfs_host)
    }
    return o
  },
"""
    return replace_once(s, anchor, block + anchor, 'snell emitter anchor')

def patch_clash(s):
    anchor = "  vmess: (p) => {\n"
    block = """  snell: (p) => {
    if (!p.psk) throw new Error('snell requires psk')
    const version = Number.parseInt(p.version ?? 5, 10) || 5
    if (![4, 5, 6].includes(version)) throw new Error('snell version must be 4, 5, or 6')
    return {
      type: 'snell',
      fields: {
        version,
        psk: p.psk,
        ...(p.userkey ? { userkey: p.userkey } : {}),
        ...(p.reuse === true ? { reuse: true } : {}),
        ...(p.network === 'tcp' || p.network === 'udp' ? { network: p.network } : {}),
        ...((p.obfs || p['obfs-mode']) ? { obfs_mode: String(p.obfs || p['obfs-mode']) } : {}),
        ...(p['obfs-host'] ? { obfs_host: String(p['obfs-host']) } : {}),
        ...(p.mode ? { mode: String(p.mode) } : {}),
      },
    }
  },
"""
    s = replace_once(s, anchor, block + anchor, 'clash snell mapper anchor')
    old = "const STRING_FIELDS = ['username', 'password', 'uuid', 'cipher', 'obfs-password', 'auth-str', 'auth_str', 'private-key', 'public-key', 'preshared-key', 'servername', 'sni', 'flow']"
    new = "const STRING_FIELDS = ['username', 'password', 'uuid', 'cipher', 'obfs-password', 'auth-str', 'auth_str', 'private-key', 'public-key', 'preshared-key', 'servername', 'sni', 'flow', 'psk', 'userkey', 'obfs-host']"
    return replace_once(s, old, new, 'clash string fields')

def patch_sharelink(s):
    s = replace_once(
        s,
        "export const SHARELINK_SCHEMES = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'anytls', 'socks', 'socks5']",
        "export const SHARELINK_SCHEMES = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'anytls', 'snell', 'socks', 'socks5']",
        'share schemes',
    )
    anchor = "// socks5://user:pass@host:port#name  /  socks5://host:port#name(不要认证)\n"
    block = r'''// Open-Box private share form for Snell. Surge itself normally uses a profile line rather than a URI.
// snell://<psk>@host:port?version=5&obfs=http&obfs-host=example.com#name
const parseSnell = (uri) => {
  const u = parseUri(uri)
  const version = Number.parseInt(u.query.get('version') || '5', 10) || 5
  if (![4, 5, 6].includes(version)) return null
  const fields = { version, psk: safeDecode(u.userinfo) }
  const userkey = u.query.get('userkey')
  if (userkey) fields.userkey = userkey
  if (u.query.get('reuse') === '1' || u.query.get('reuse') === 'true') fields.reuse = true
  const network = u.query.get('network')
  if (network === 'tcp' || network === 'udp') fields.network = network
  if (version === 6) {
    const mode = u.query.get('mode')
    if (mode) fields.mode = mode
  } else {
    const obfs = u.query.get('obfs') || u.query.get('obfs-mode') || u.query.get('obfs_mode')
    if (obfs) fields.obfs_mode = obfs
    const host = u.query.get('obfs-host') || u.query.get('obfs_host')
    if (host) fields.obfs_host = host
  }
  return createNode({ tag: u.fragment, type: 'snell', server: u.host, server_port: u.port, fields, source: 'sharelink' })
}

// Surge profile form, e.g.:
// name = snell, 1.2.3.4, 6160, psk = xxx, version = 5, reuse = true
export const parseSurgeSnellLine = (line) => {
  const text = String(line || '').trim()
  const eq = text.indexOf('=')
  if (eq <= 0) return null
  const tag = text.slice(0, eq).trim()
  const parts = text.slice(eq + 1).split(',').map((x) => x.trim())
  if (parts.length < 4 || parts[0].toLowerCase() !== 'snell') return null
  const server = parts[1]
  const port = parts[2]
  const opts = {}
  for (const part of parts.slice(3)) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const k = part.slice(0, i).trim().toLowerCase().replace(/_/g, '-')
    opts[k] = part.slice(i + 1).trim()
  }
  if (!opts.psk) return null
  const version = Number.parseInt(opts.version || '5', 10) || 5
  if (![4, 5, 6].includes(version)) return null
  const fields = { version, psk: opts.psk }
  if (opts.userkey) fields.userkey = opts.userkey
  if (/^(1|true|yes)$/i.test(opts.reuse || '')) fields.reuse = true
  if (opts.network === 'tcp' || opts.network === 'udp') fields.network = opts.network
  if (version === 6) {
    if (opts.mode) fields.mode = opts.mode
  } else {
    if (opts.obfs) fields.obfs_mode = opts.obfs
    if (opts['obfs-mode']) fields.obfs_mode = opts['obfs-mode']
    if (opts['obfs-host']) fields.obfs_host = opts['obfs-host']
  }
  return createNode({ tag, type: 'snell', server, server_port: port, fields, source: 'sharelink' })
}

'''
    s = replace_once(s, anchor, block + anchor, 'snell parser anchor')
    dispatch = "    if (uri.startsWith('anytls://')) return parseAnytls(uri)\n"
    s = replace_once(s, dispatch, dispatch + "    if (uri.startsWith('snell://')) return parseSnell(uri)\n", 'snell dispatch')
    return s

def patch_subscription(s):
    s = replace_once(s, "import { parseShareLink } from './sharelink.mjs'", "import { parseShareLink, parseSurgeSnellLine } from './sharelink.mjs'", 'subscription import')
    old = "const SHARELINK_PREFIX = /^(ss|ssr|vmess|vless|trojan|hysteria2|hy2|tuic|anytls|socks5h|socks5|socks4a|socks4|socks):\\/\\//"
    new = "const SHARELINK_PREFIX = /^(ss|ssr|vmess|vless|trojan|hysteria2|hy2|tuic|anytls|snell|socks5h|socks5|socks4a|socks4|socks):\\/\\//"
    s = replace_once(s, old, new, 'subscription prefix')
    anchor = "  if (SHARELINK_PREFIX.test(firstLine)) return 'sharelink'\n"
    s = replace_once(s, anchor, anchor + "  if (/^[^=\\r\\n]+\\s*=\\s*snell\\s*,/i.test(firstLine)) return 'surge-snell'\n", 'subscription detect surge snell')
    parse_anchor = "const parseSharelinkLines = (text) => {\n"
    surge_func = r'''const parseSurgeSnellLines = (text) => {
  const nodes = []
  const skipped = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const node = parseSurgeSnellLine(line)
    if (node) nodes.push(node)
    else skipped.push({ name: line.slice(0, 40), type: 'snell', reason: 'invalid' })
  }
  return { nodes, skipped }
}

'''
    s = replace_once(s, parse_anchor, surge_func + parse_anchor, 'surge parser function anchor')
    out_anchor = "  if (format === 'sharelink') return { ...parseSharelinkLines(content), format }\n"
    return replace_once(s, out_anchor, out_anchor + "  if (format === 'surge-snell') return { ...parseSurgeSnellLines(content), format }\n", 'subscription parse surge')

def patch_chain(s):
    s = replace_once(s, "import { parseHttpProxyLink } from './sharelink.mjs'", "import { parseHttpProxyLink, parseSurgeSnellLine } from './sharelink.mjs'", 'chain import')
    anchor = "  // http:// https:// 是 HTTP 代理账号(住宅代理商的 HTTP / HTTPS 格式),单独解析:订阅解析里 http(s):// 是网址不是节点\n"
    block = """  // Surge 的 Snell 节点是 profile 行而不是 URI;链式代理里允许直接粘贴。
  if (/^[^=\\r\\n]+\\s*=\\s*snell\\s*,/i.test(text)) {
    try {
      const node = parseSurgeSnellLine(text)
      return node ? { node } : { error: 'Snell 配置格式不对,应包含名称、主机、端口、psk 和 version' }
    } catch (err) {
      return { error: `Snell 配置解析失败:${err instanceof Error ? err.message : String(err)}` }
    }
  }
"""
    s = replace_once(s, anchor, block + anchor, 'chain snell parse')
    old = "支持分享链接(ss / vmess / vless / trojan / hysteria2 / tuic / anytls / socks5)、HTTP 代理(http:// https:// 或住宅代理的 主机:端口:用户名:密码),或一段 Clash / sing-box 节点配置"
    new = "支持分享链接(ss / vmess / vless / trojan / hysteria2 / tuic / anytls / snell / socks5)、Surge Snell 配置行、HTTP 代理(http:// https:// 或住宅代理的 主机:端口:用户名:密码),或一段 Clash / sing-box 节点配置"
    return replace_once(s, old, new, 'chain help text')

def patch_node_model_test(s):
    old = "  assert.deepEqual([...NODE_TYPES].sort(), ['anytls','http','hysteria2','shadowsocks','socks','trojan','tuic','vless','vmess','wireguard'])"
    new = "  assert.deepEqual([...NODE_TYPES].sort(), ['anytls','http','hysteria2','shadowsocks','snell','socks','trojan','tuic','vless','vmess','wireguard'])"
    return replace_once(s, old, new, 'node model test expectation')

def patch_index(s):
    s = replace_once(
        s,
        "import { registerProfileRoutes } from './api/profile.mjs'\n",
        "import { registerProfileRoutes } from './api/profile.mjs'\nimport { registerSmartRoutingRoutes } from './api/smart-routing.mjs'\n",
        'smart routing api import',
    )
    return replace_once(
        s,
        "registerProfileRoutes(app, { store, applyNow: () => hotApplier.runNow() })\n",
        "registerProfileRoutes(app, { store, applyNow: () => hotApplier.runNow() })\nregisterSmartRoutingRoutes(app, { store, applyNow: () => hotApplier.runNow() })\n",
        'smart routing api registration',
    )

def patch_clash_test(s):
    old = """  - name: "Legacy"
    type: snell
    server: x.com
    port: 1234
"""
    new = """  - name: "Legacy"
    type: snell
    server: x.com
    port: 1234
    psk: legacy-secret
    version: 5
"""
    s = replace_once(s, old, new, 'clash test snell fixture')
    old_assert = "  assert.deepEqual(skipped, [{ name: 'Legacy', type: 'snell', reason: 'unsupported-type' }])"
    new_assert = """  assert.equal(byName['Legacy'].type, 'snell')
  assert.equal(byName['Legacy'].fields.psk, 'legacy-secret')
  assert.equal(byName['Legacy'].fields.version, 5)
  assert.deepEqual(skipped, [])"""
    return replace_once(s, old_assert, new_assert, 'clash test snell expectation')

for name, fn in [
    ('node-model.mjs', patch_node_model),
    ('emit-outbound.mjs', patch_emit),
    ('clash.mjs', patch_clash),
    ('sharelink.mjs', patch_sharelink),
    ('subscription.mjs', patch_subscription),
    ('chain-proxy.mjs', patch_chain),
    ('node-model.test.mjs', patch_node_model_test),
    ('clash.test.mjs', patch_clash_test),
]:
    edit(name, fn)

edit_path('panel/server/index.mjs', patch_index)

print('Snell + smart routing patch applied')
