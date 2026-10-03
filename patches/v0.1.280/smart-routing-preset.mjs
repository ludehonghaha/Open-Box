const IDS = Object.freeze({
  primaryChain: 'smart-jp-primary',
  secondaryChain: 'smart-jp-secondary',
  jpGroup: 'smart-route-jp',
  usGroup: 'smart-route-us',
  hkGroup: 'smart-route-hk',
})

const DEFAULT_NAMES = Object.freeze({
  primaryChain: '沪日 · Snell → JP',
  secondaryChain: '沪日 · Gen2 → JP',
  jpGroup: '🇯🇵 沪日',
  usGroup: '🇺🇸 美西',
  hkGroup: '🇭🇰 香港',
})

const required = (value, label) => {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) throw new Error(`${label}不能为空`)
  return s
}
const optional = (value) => (typeof value === 'string' ? value.trim() : '')
const stringList = (value) => [...new Set((Array.isArray(value) ? value : []).map(optional).filter(Boolean))]
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)

const upsertById = (items, value) => {
  const list = Array.isArray(items) ? items.map((x) => ({ ...x })) : []
  const index = list.findIndex((x) => x && x.id === value.id)
  if (index >= 0) list[index] = value
  else list.push(value)
  return list
}

const removeById = (items, id) => (Array.isArray(items) ? items.filter((x) => !x || x.id !== id) : [])

const CORE_POLICIES = Object.freeze({
  AI: { id: 'smart-policy-ai', name: 'AI', rulesets: ['geosite-category-ai-!cn'] },
  Netflix: { id: 'smart-policy-netflix', name: 'Netflix', rulesets: ['geosite-netflix', 'geoip-netflix'] },
  国外: { id: 'smart-policy-foreign', name: '国外', rulesets: ['geosite-gfw'] },
  国内: { id: 'smart-policy-cn', name: '国内', rulesets: ['geosite-cn', 'geoip-cn', 'geoip-private'] },
})

const updatePolicyDefaults = (routing, { jpGroup, usGroup }) => {
  const raw = isObject(routing) ? routing : {}
  let policies = Array.isArray(raw.policies) ? raw.policies.map((p) => ({ ...p })) : []
  const byName = new Map(policies.map((p, i) => [p && p.name, i]))
  // 核心四类没有时补最小定义；其它已有站点集只改默认出口，不碰用户的匹配规则。
  for (const spec of Object.values(CORE_POLICIES)) {
    if (!byName.has(spec.name)) {
      byName.set(spec.name, policies.length)
      policies.push({ ...spec })
    }
  }
  const jpNames = new Set(['AI', 'Github', 'GitHub', 'Google', 'Microsoft', 'Games', '国外'])
  const usNames = new Set(['Youtube', 'YouTube', 'TikTok', 'Netflix'])
  policies = policies.map((p) => {
    if (!p || typeof p !== 'object') return p
    if (jpNames.has(p.name)) return { ...p, default: jpGroup }
    if (usNames.has(p.name)) return { ...p, default: usGroup }
    if (p.name === '国内') return { ...p, default: 'direct' }
    return p
  })
  return { ...raw, policies, fallbackDefault: 'direct' }
}

export const buildSmartRoutingPreset = ({
  currentProfile = {},
  currentGroups = [],
  primaryHop,
  secondaryHop = '',
  hkFallback = '',
  usWestNodes = [],
  jpLandingLink,
  names = {},
} = {}) => {
  const primary = required(primaryHop, '沪日主入口')
  const jpLink = required(jpLandingLink, 'JP 落地节点')
  const secondary = optional(secondaryHop)
  const hk = optional(hkFallback)
  const us = stringList(usWestNodes)
  if (!us.length) throw new Error('美西至少要选择一个节点')

  const n = { ...DEFAULT_NAMES, ...(isObject(names) ? names : {}) }
  Object.keys(DEFAULT_NAMES).forEach((key) => { n[key] = required(n[key], key) })

  let chainProxies = Array.isArray(currentProfile.chainProxies) ? currentProfile.chainProxies.map((x) => ({ ...x })) : []
  chainProxies = upsertById(chainProxies, {
    id: IDS.primaryChain, enabled: true, name: n.primaryChain, link: jpLink, upstream: primary,
  })
  if (secondary) {
    chainProxies = upsertById(chainProxies, {
      id: IDS.secondaryChain, enabled: true, name: n.secondaryChain, link: jpLink, upstream: secondary,
    })
  } else {
    chainProxies = removeById(chainProxies, IDS.secondaryChain)
  }

  const jpLanes = [{ id: 'primary', name: '主用', members: [n.primaryChain] }]
  if (secondary) jpLanes.push({ id: 'secondary', name: '备用', members: [n.secondaryChain] })
  if (hk) jpLanes.push({ id: 'last', name: '第二备用', members: [hk] })

  let groups = Array.isArray(currentGroups) ? currentGroups.map((x) => ({ ...x })) : []
  groups = upsertById(groups, {
    id: IDS.jpGroup, name: n.jpGroup, type: 'failover', mode: 'static',
    lanes: jpLanes,
    interval: '60s', tolerance: 100,
    failover: { timeoutMs: 5000, failureThreshold: 2, restorePrimary: true, recoveryHoldMs: 60000 },
  })
  groups = upsertById(groups, {
    id: IDS.usGroup, name: n.usGroup, type: us.length > 1 ? 'urltest' : 'selector', mode: 'static', members: us,
    ...(us.length > 1 ? { interval: '300s', tolerance: 100 } : {}),
  })
  if (hk) {
    groups = upsertById(groups, { id: IDS.hkGroup, name: n.hkGroup, type: 'selector', mode: 'static', members: [hk] })
  } else {
    groups = removeById(groups, IDS.hkGroup)
  }

  const routing = updatePolicyDefaults(currentProfile.routing, { jpGroup: n.jpGroup, usGroup: n.usGroup })
  return {
    profilePatch: { chainProxies, routing },
    groups,
    summary: {
      ai: n.jpGroup,
      foreignWeb: n.jpGroup,
      streaming: n.usGroup,
      china: 'direct',
      japanPath: [primary, n.primaryChain],
      japanBackup: secondary ? [secondary, n.secondaryChain] : [],
      hkFallback: hk,
      usWestNodes: us,
    },
  }
}

export const SMART_ROUTING_PRESET_IDS = IDS
