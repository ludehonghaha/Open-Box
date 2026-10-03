import express from 'express'
import { buildConfig } from '../engine/config.mjs'
import { chainNodes, parseChainNode } from '../engine/chain-proxy.mjs'
import { buildSmartRoutingPreset, SMART_ROUTING_PRESET_IDS } from '../engine/smart-routing-preset.mjs'
import { appliedSummary } from './subscriptions.mjs'

const clean = (v) => (typeof v === 'string' ? v.trim() : '')
const list = (v) => [...new Set((Array.isArray(v) ? v : []).map(clean).filter(Boolean))]

export const planSmartRouting = ({ store, input = {} }) => {
  const profile = store.getProfile() || {}
  const groups = store.getGroups() || []
  const baseNodes = store.getNodes() || []
  const existingChainNodes = chainNodes(profile)
  const allNodes = [...baseNodes, ...existingChainNodes]
  const nodeTags = new Set(allNodes.map((n) => n && n.tag).filter(Boolean))
  const nodeByTag = new Map(allNodes.map((n) => [n && n.tag, n]).filter(([tag]) => Boolean(tag)))
  const upstreamTags = new Set([...nodeTags, ...groups.map((g) => g && g.name).filter(Boolean)])

  const primaryHop = clean(input.primaryHop)
  const secondaryHop = clean(input.secondaryHop)
  const hkFallback = clean(input.hkFallback)
  const usWestNodes = list(input.usWestNodes)
  const requestedLandingLink = clean(input.jpLandingLink)
  const existingPrimaryChain = (Array.isArray(profile.chainProxies) ? profile.chainProxies : []).find((x) => x && x.id === SMART_ROUTING_PRESET_IDS.primaryChain)
  const jpLandingLink = requestedLandingLink || clean(existingPrimaryChain?.link)

  if (!nodeTags.has(primaryHop)) throw new Error(`沪日主入口不存在:「${primaryHop || '未选择'}」`)
  if (nodeByTag.get(primaryHop)?.type !== 'snell') throw new Error(`沪日主入口必须是 Snell 节点:「${primaryHop}」`)
  if (secondaryHop && !upstreamTags.has(secondaryHop)) throw new Error(`沪日备用入口不存在:「${secondaryHop}」`)
  if (hkFallback && !nodeTags.has(hkFallback)) throw new Error(`香港第二备用必须是真实节点:「${hkFallback}」`)
  for (const tag of usWestNodes) if (!nodeTags.has(tag)) throw new Error(`美西节点不存在:「${tag}」`)
  const landing = parseChainNode(jpLandingLink)
  if (landing.error || !landing.node) throw new Error(`JP 落地节点无效:${landing.error || '无法解析'}`)

  const preset = buildSmartRoutingPreset({
    currentProfile: profile,
    currentGroups: groups,
    primaryHop,
    secondaryHop,
    hkFallback,
    usWestNodes,
    jpLandingLink,
    names: input.names,
  })
  const nextProfile = { ...profile, ...preset.profilePatch }
  // 用正式配置生成器干跑一遍:重复 tag、链路成环、失效组等问题都在保存前暴露。
  const config = buildConfig({ nodes: baseNodes, userGroups: preset.groups, profile: nextProfile })
  const byTag = new Map(config.outbounds.map((o) => [o.tag, o]))
  const jp = byTag.get(preset.summary.ai)
  const us = byTag.get(preset.summary.streaming)
  if (!jp || !us) throw new Error('智能线路预设没有生成预期的沪日/美西策略组')
  const primaryChain = byTag.get(preset.summary.japanPath[1])
  if (!primaryChain || primaryChain.detour !== primaryHop || jp.default !== preset.summary.japanPath[1]) {
    throw new Error('沪日主链生成失败:预期 Snell 第一跳 → JP 落地')
  }
  if (secondaryHop) {
    const secondaryChain = byTag.get(preset.summary.japanBackup[1])
    if (!secondaryChain || secondaryChain.detour !== secondaryHop) throw new Error('沪日备用链生成失败')
  }

  return {
    ...preset,
    preview: {
      japan: { group: preset.summary.ai, members: jp.outbounds || [], default: jp.default || '' },
      usWest: { group: preset.summary.streaming, members: us.outbounds || [], default: us.default || '' },
      policies: {
        AI: byTag.get('AI')?.default || '',
        国外: byTag.get('国外')?.default || '',
        Netflix: byTag.get('Netflix')?.default || '',
        国内: byTag.get('国内')?.default || '',
      },
      landing: { type: landing.node.type, server: landing.node.server, port: landing.node.server_port },
    },
  }
}

export const smartRoutingOptions = (store) => {
  const profile = store.getProfile() || {}
  const groups = store.getGroups() || []
  const nodes = [...(store.getNodes() || []), ...chainNodes(profile)]
  const byId = new Map((Array.isArray(profile.chainProxies) ? profile.chainProxies : []).map((x) => [x && x.id, x]))
  const primary = byId.get(SMART_ROUTING_PRESET_IDS.primaryChain)
  const secondary = byId.get(SMART_ROUTING_PRESET_IDS.secondaryChain)
  const groupById = new Map(groups.map((g) => [g && g.id, g]))
  const jpGroup = groupById.get(SMART_ROUTING_PRESET_IDS.jpGroup)
  const usGroup = groupById.get(SMART_ROUTING_PRESET_IDS.usGroup)
  const hkGroup = groupById.get(SMART_ROUTING_PRESET_IDS.hkGroup)
  const lane = (id) => (Array.isArray(jpGroup?.lanes) ? jpGroup.lanes.find((x) => x && x.id === id) : null)
  const presetIds = new Set(Object.values(SMART_ROUTING_PRESET_IDS))
  const upstreamGroups = groups.filter((g) => g && !g.kind && !presetIds.has(g.id)).map((g) => g.name).filter(Boolean)
  return {
    nodes: nodes.map((n) => ({ name: n.tag, type: n.type, chain: n.chain === true })),
    snellNodes: nodes.filter((n) => n.type === 'snell' && n.chain !== true).map((n) => n.tag),
    upstreams: [...new Set([...nodes.filter((n) => n.chain !== true).map((n) => n.tag), ...upstreamGroups])],
    current: {
      primaryHop: clean(primary?.upstream),
      secondaryHop: clean(secondary?.upstream),
      hkFallback: clean((lane('last')?.members || [])[0] || (hkGroup?.members || [])[0]),
      usWestNodes: list(usGroup?.members),
      jpLandingConfigured: Boolean(clean(primary?.link)),
    },
  }
}

const publicResult = (plan) => ({ summary: plan.summary, preview: plan.preview })

export const registerSmartRoutingRoutes = (app, { store, applyNow = null } = {}) => {
  const router = express.Router({ caseSensitive: true })
  router.use(express.json({ limit: '1mb' }))

  router.get('/options', (_req, res) => {
    res.json({ ok: true, ...smartRoutingOptions(store) })
  })

  router.post('/preview', (req, res) => {
    try { res.json({ ok: true, ...publicResult(planSmartRouting({ store, input: req.body || {} })) }) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }) }
  })

  router.post('/apply', async (req, res) => {
    let plan
    try { plan = planSmartRouting({ store, input: req.body || {} }) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); return }

    try {
      store.setProfile(plan.profilePatch)
      store.setGroups(plan.groups)
    } catch (error) {
      res.status(500).json({ error: `智能线路保存失败:${error instanceof Error ? error.message : String(error)}` })
      return
    }

    let applied
    if (typeof applyNow === 'function') {
      try { applied = appliedSummary(await applyNow()) }
      catch (error) { applied = { ok: false, changed: 0, reason: error instanceof Error ? error.message : String(error) } }
    }
    res.json({ ok: true, ...publicResult(plan), profile: store.getProfile(), groups: store.getGroups(), ...(applied ? { applied } : {}) })
  })

  app.use('/api/openbox/smart-routing', router)
}
