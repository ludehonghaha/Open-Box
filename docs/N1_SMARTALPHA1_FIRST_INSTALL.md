# Open-Box Smart Routing alpha1 — N1 首次安装验收

目标版本：`v0.1.280-smartalpha1`

目标设备：Phicomm N1 / ARM64 / iStoreOS

本次验收原则：

- 先安装面板与后端，不启用 Open-Box 内核。
- 保持现有 OpenClash 原样运行。
- 先跑 doctor，再打开 Smart Routing。
- Snell / JP / Gen2 / HK / US West 节点配置完成后先 Preview。
- Preview 方向、节点和生成配置全部正确后，才允许 Apply。
- 第一次 Apply 前应准备 SSH 回退窗口。

## 1. 安装前只读检查

```sh
uname -m
df -h /opt /
free -h 2>/dev/null || head -n 5 /proc/meminfo

/etc/init.d/openclash status 2>/dev/null || true
/etc/init.d/openbox status 2>/dev/null || true
/etc/init.d/openbox-panel status 2>/dev/null || true
```

预期：

- 架构为 `aarch64` / `arm64`。
- `/opt/open-box` 不存在完整旧安装。
- OpenClash 当前状态保持记录，安装后要再次比对。

## 2. 下载固定 alpha1 安装脚本

不要使用 `releases/latest`，本次测试只使用固定 tag：

```sh
cd /tmp
rm -f openbox-smartalpha1-install.sh

curl -fL --retry 3 \
  'https://github.com/ludehonghaha/Open-Box/releases/download/v0.1.280-smartalpha1/install.sh' \
  -o openbox-smartalpha1-install.sh

sh -n openbox-smartalpha1-install.sh

grep -F 'ludehonghaha/Open-Box' openbox-smartalpha1-install.sh
grep -F 'v0.1.280-smartalpha1' openbox-smartalpha1-install.sh
```

两个 `grep` 都必须有输出后再继续。

## 3. 安装

```sh
sh /tmp/openbox-smartalpha1-install.sh
```

安装脚本会对完整发布包做 SHA256 校验。

首次安装只启动 `openbox-panel`，不会自动启动 `openbox` 内核。

## 4. 安装后立即检查

```sh
cat /opt/open-box/meta.json
cat /opt/open-box/OPENBOX_CUSTOM_BUILD

/etc/init.d/openbox-panel status 2>/dev/null || true
/etc/init.d/openbox status 2>/dev/null || true
/etc/init.d/openclash status 2>/dev/null || true
```

关键要求：

- 版本必须为 `v0.1.280-smartalpha1`。
- `openbox-panel` 应可运行。
- 此时不要主动启动 `openbox` 内核。
- OpenClash 状态应与安装前一致。

## 5. 跑 alpha1 doctor

完整包里已经带有 doctor：

```sh
/opt/open-box/smartalpha1-doctor.sh
```

目标结果：

```text
[doctor] PASS: smartalpha1 files and runtime prerequisites look consistent.
```

如果出现 FAIL，不继续配置流量，先修安装问题。

WARN 可以单独判断，不等同于通过流量验收。

## 6. 只打开面板，不切流量

浏览器访问：

```text
http://<N1-LAN-IP>:<安装时选择的面板端口>
```

默认新安装面板端口为 3036；实际值以安装脚本输出和：

```sh
cat /opt/open-box/data/panel-port
```

为准。

进入 Smart Routing 后，此阶段只做节点导入和 Preview。

## 7. 节点准备

目标拓扑：

```text
AI / 国外网页
      ↓
    🇯🇵 沪日
      ↓
NoBrand Snell
      ↓
   JP 落地
      ↓
   Internet
```

备用：

```text
Snell → JP
   ↓ fail
Gen2 → JP
   ↓ fail
HK CMIN2
```

流媒体：

```text
Netflix / Disney+ / YouTube / TikTok
                ↓
             US West
```

国内：

```text
CN / 国内站点 → DIRECT
```

Snell 可直接粘贴 Surge 格式：

```text
节点名 = snell, host, port, psk = ..., version = 5
```

也可以导入 `snell://`。

## 8. 必须先 Preview

选择：

- 主入口：NoBrand Snell
- JP 落地
- 可选备用：Gen2
- 可选第二备用：HK CMIN2
- 流媒体：US West

点击 Preview。

必须确认摘要表达的是：

```text
NoBrand Snell → JP
```

而不是：

```text
JP → Snell
```

底层正确关系应为：

```text
JP-via-Snell.detour = NoBrand-Snell
```

Preview 不应落库，也不应接管现有 OpenClash 流量。

## 9. 第一次 Apply 前

保留一个 SSH 会话，并准备：

```sh
/etc/init.d/openbox stop 2>/dev/null || true
/etc/init.d/openclash restart 2>/dev/null || true
```

这只是紧急回退命令；正常情况下不需要执行。

第一次 Apply 后要立刻验证：

- 国内网站仍为 DIRECT。
- AI / 国外网页命中沪日。
- 实际出口为 JP。
- Snell 第一跳可用。
- 流媒体命中 US West。
- 主链故障时 failover 顺序正确。
- DNS 无循环、无大面积解析失败。
- OpenClash/Open-Box 不出现同时接管透明代理的冲突。

## 10. alpha1 完成标准

只有以下项目全部通过，才进入 alpha2 / 日常使用阶段：

- doctor PASS
- 面板可正常登录
- Snell 导入成功
- Preview 正确
- Snell → JP 单链实流量通过
- AI 自动分流通过
- 国内 DIRECT 通过
- US West 流媒体通过
- Gen2 / HK failover 通过
- 重启 N1 后配置仍正确
- 无 DNS / nftables / TPROXY 冲突
