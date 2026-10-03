# Smart Chain Routing / 智能链路设计

> 目标：在尽量不改变 Open-Box 现有透明代理、DNS、入口旁路和升级机制的前提下，把“网站/业务类型 → 链路”做成一等能力。

## 1. 用户看到的模型

用户不需要理解 sing-box 的 `detour`、route rule 或节点内部字段，只需要看到：

- 🤖 AI → 🇯🇵 沪日
- 🌐 普通国外网页 → 🇯🇵 沪日
- 🎬 流媒体 → 🇺🇸 美西
- 🇭🇰 香港服务 → 🇭🇰 CMIN2
- 🇨🇳 中国大陆 → DIRECT
- 🐟 其他 → 可配置兜底

“🇯🇵 沪日”本身是一条智能链路，例如：

```text
NoBrand Snell (入口)
        ↓
JP AnyTLS / VLESS (落地)
        ↓
Internet
```

## 2. 第一阶段协议范围

优先支持 sing-box 已支持、且适合专线入口的 Snell。

需要在 Open-Box 后端/面板源码中补齐：

1. Snell 节点创建、编辑、导入、导出。
2. Snell 节点进入普通节点组、自动组选项和链路候选。
3. 节点详情显示协议、健康状态、延迟和实际出口。
4. 不实现 Mieru；除非后续明确更换/扩展内核。

第一阶段只要求 TCP Snell；不要假设 Snell QUIC Proxy 可用。

## 3. 智能链路数据模型

建议新增独立的 `smart_chains` 概念，不把链路伪装成普通 selector。

概念模型：

```json
{
  "id": "jp-shanghai",
  "name": "🇯🇵 沪日",
  "enabled": true,
  "primary": {
    "entry": "snell-nobrand",
    "exit": "jp-landing"
  },
  "fallbacks": [
    {
      "entry": "gen2-entry",
      "exit": "jp-landing"
    },
    {
      "entry": null,
      "exit": "hk-cmin2"
    }
  ],
  "health": {
    "url": "https://www.gstatic.com/generate_204",
    "interval": 60,
    "failures_before_switch": 2,
    "successes_before_restore": 2
  }
}
```

生成 sing-box 配置时：

- 落地 outbound 的拨号路径指向入口 outbound（优先使用 sing-box 原生 detour/dialer 机制）。
- 每一条可运行链路都要有稳定、唯一 tag。
- UI 中显示“入口 → 落地 → 出口国家/地区”，而不是展示内部 tag。
- fallback 是链路级故障转移，不是单节点 url-test 的别名。

## 4. 业务分流模型

建议新增 `traffic_profiles` / “业务分流”层：

```json
{
  "ai": {
    "name": "🤖 AI",
    "target": "chain:jp-shanghai",
    "rulesets": ["category-ai-!cn", "openai"]
  },
  "web": {
    "name": "🌐 国外网页",
    "target": "chain:jp-shanghai"
  },
  "streaming": {
    "name": "🎬 流媒体",
    "target": "group:us-west",
    "rulesets": ["netflix", "disney", "hbo"]
  },
  "cn": {
    "name": "🇨🇳 中国大陆",
    "target": "direct",
    "rulesets": ["geosite-cn", "geoip-cn"]
  }
}
```

匹配顺序必须显式可见，并继续遵守 Open-Box 当前规则语义：域名条件管理有域名的连接，IP 条件管理直接 IP/无法识别域名的连接。不要在 UI 中暗示“域名没命中后一定再拿解析 IP 二次匹配”。

## 5. AI 自动链式分流

目标行为：

```text
chatgpt.com / api.openai.com / claude.ai / gemini.google.com
              ↓
           🤖 AI
              ↓
         🇯🇵 沪日
              ↓
       Snell → JP 落地
```

要求：

- 支持内置规则集 + 用户追加域名。
- “为什么走这里？”调试页必须显示命中的业务、规则、链路、每一跳和最终出口。
- DNS 选择必须跟业务最终出口保持一致。
- 链路切换后，新连接在短时间内按新链路走；已建立连接不强制中断，除非当前实现无法避免。

## 6. UI 信息架构

首页只展示高频信息：

- Open-Box / 内核状态
- 当前公网出口
- DNS 健康
- 4～6 个业务卡片：AI、网页、流媒体、香港、国内、其他
- 每张卡片显示目标链路及健康状态

新增“链路”页面：

- 链路卡片：入口、落地、出口、延迟、健康状态
- 可编辑主链路和备用链路
- 可点击查看“哪些业务正在使用这条链路”

保留现有高级设置，不删除原能力。

## 7. N1 / iStoreOS 安全要求

针对 aarch64 旁路由，尤其斐讯 N1：

1. 启动前记录当前 nftables / DNS 接管状态。
2. 启动后执行轻量健康检查：本地 DNS、国内直连、代理站点。
3. 失败时不能留下半套 DNS/nftables 接管。
4. 升级后内核启动失败时，面板必须明确显示失败原因和日志路径。
5. 缺少 `kmod-nft-queue` 时允许降级运行，但 UI 要显示“首包预判不可用”，不能显示完全正常。

## 8. DNS 容错

针对已经公开报告的空解析/CNAME 场景：

- 若返回 CNAME 但最终 A/AAAA 为空，允许重新解析 target。
- 对“empty result”提供一次受控重试和诊断信息。
- 不要无限重试。
- “规则真实路由”与终端实际 DNS 路径必须一致，否则明确标注诊断模式差异。

## 9. 上游兼容与发布

本 fork 的脚本默认仍下载 `liandu2024/Open-Box` Release。

已经加入环境变量：

- `OPENBOX_RELEASE_REPO=owner/repo`：指定 Release 资产仓库。
- `OPENBOX_SCRIPT_REPO=owner/repo`：指定报错提示中的 install/update 脚本仓库；默认跟随 Release 仓库。

在定制 Release 尚未生成之前，不要把默认值改成 fork，否则新安装会因为没有资产而失败。

## 10. 验收标准

第一阶段完成必须至少通过：

1. Snell 节点能创建、保存、重启后保留。
2. Snell 单节点 TCP 连通。
3. Snell → JP 两跳链路连通，出口 IP 是 JP 落地。
4. AI 域名自动命中“AI → 沪日”，无需手动切节点。
5. Netflix/Disney 等命中流媒体线路，不消耗沪日链路。
6. 中国大陆规则保持 DIRECT。
7. 主链路断开后能切备用；恢复后按设置恢复主链路。
8. “为什么走这里？”能完整展示：域名 → 规则 → 业务 → 链路 → hops → 出口。
9. N1 上重启/升级失败不会把局域网永久留在断网状态。
10. 上游 main 合并后，本 fork 的智能链路数据不会被覆盖或丢失。

## 11. 实现顺序

1. 找到/导入 Open-Box 面板与后端真实源码（当前公开仓库只有发行脚本、README 和图片）。
2. 补 Snell outbound 的模型、校验、表单和配置生成。
3. 实现 smart_chain 数据模型与配置生成。
4. 实现 traffic_profile → smart_chain 绑定。
5. 实现健康检查与链路 failover。
6. 实现“为什么走这里？”展示。
7. 加 N1 安全回滚和 DNS 容错。
8. 最后再做 UI 视觉优化。

