# AGENTS.md

## Project direction

This fork is intended to add a simple “site/business → smart chain” workflow to Open-Box while preserving upstream compatibility.

Primary user-facing goals:

- AI and normal foreign web traffic can automatically use a Shanghai/Japan dedicated chain.
- Streaming can use a separate US West route.
- Hong Kong CMIN2 remains independently selectable.
- China traffic stays DIRECT.
- The user should not need to understand sing-box detour tags or low-level routing rules.

## Critical repository fact

The public repository currently contains distribution scripts, README/docs and screenshots. It does **not** contain the full Open-Box panel/backend source tree.

Do not claim that UI/backend features are implemented merely by editing this repository. Before implementing Snell forms, smart-chain persistence, route generation or UI cards, locate/import the actual source used to build the Release app package.

## Compatibility rules

1. Keep upstream `liandu2024/Open-Box` as the default release source until this fork publishes complete custom Release assets.
2. Preserve the environment overrides already introduced on the feature branch:
   - `OPENBOX_RELEASE_REPO`
   - `OPENBOX_SCRIPT_REPO`
3. Avoid invasive changes to upstream install/update/uninstall behavior unless required.
4. Keep custom state in additive schema/tables where possible so upstream merges do not destroy it.
5. Never run OpenClash and Open-Box transparent interception simultaneously in production testing.
6. N1/iStoreOS recovery behavior is a release blocker: failed startup must cleanly release DNS/nftables interception.

## Implementation priorities

Read `docs/SMART_CHAIN_ROUTING.md` first.

Order:

1. Snell node support in real panel/backend source.
2. Smart-chain model and sing-box config generation.
3. Business/site profile routing (AI/web/streaming/HK/CN/other).
4. Chain health + fallback.
5. Route explanation UI.
6. N1 startup/upgrade safety.
7. DNS empty-result/CNAME guard.
8. Visual polish.

## Definition of done for first usable build

A test domain in the AI ruleset must automatically produce:

```text
AI rule → 🇯🇵 沪日 → Snell entry → JP landing → Internet
```

while a streaming domain follows its configured non-JP route and a China domain stays DIRECT.

Do not embed real passwords, UUIDs, PSKs, private node addresses or user credentials in repository examples/tests.
