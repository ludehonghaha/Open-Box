#!/bin/sh
set -eu

ROOT="${OPENBOX_ROOT:-/opt/open-box}"
EXPECTED_VERSION="${OPENBOX_EXPECTED_VERSION:-v0.1.280-smartalpha1}"

ok() { printf '[doctor] OK   %s\n' "$*"; }
warn() { printf '[doctor] WARN %s\n' "$*" >&2; }
fail() { printf '[doctor] FAIL %s\n' "$*" >&2; exit 1; }

arch="$(uname -m 2>/dev/null || true)"
case "$arch" in
  aarch64|arm64) ok "architecture: $arch" ;;
  *) fail "unsupported architecture for this alpha build: ${arch:-unknown}" ;;
esac

[ -d "$ROOT" ] || fail "install root missing: $ROOT"
[ -r "$ROOT/meta.json" ] || fail "missing meta.json"
[ -x "$ROOT/node/bin/node" ] || fail "bundled node is missing or not executable"
[ -f "$ROOT/panel/server/index.mjs" ] || fail "panel server entry missing"
[ -f "$ROOT/panel/server/api/smart-routing.mjs" ] || fail "smart routing API module missing"
[ -f "$ROOT/panel/server/engine/smart-routing-preset.mjs" ] || fail "smart routing preset module missing"
[ -f "$ROOT/panel/dist/smart-routing.html" ] || fail "smart routing UI missing"
[ -f "$ROOT/OPENBOX_CUSTOM_BUILD" ] || fail "custom build marker missing"

version="$("$ROOT/node/bin/node" --input-type=module - "$ROOT/meta.json" <<'NODE'
import fs from 'node:fs'
const p = process.argv[2]
const x = JSON.parse(fs.readFileSync(p, 'utf8'))
process.stdout.write(String(x.version || ''))
NODE
)"
[ "$version" = "$EXPECTED_VERSION" ] || fail "version mismatch: got '${version:-empty}', expected '$EXPECTED_VERSION'"
ok "version: $version"

"$ROOT/node/bin/node" --check "$ROOT/panel/server/index.mjs" >/dev/null
"$ROOT/node/bin/node" --check "$ROOT/panel/server/api/smart-routing.mjs" >/dev/null
"$ROOT/node/bin/node" --check "$ROOT/panel/server/engine/smart-routing-preset.mjs" >/dev/null
ok "server modules parse"

grep -Fq 'openbox-smart-routing-entry' "$ROOT/panel/dist/index.html" || fail "main panel smart-routing entry missing"
grep -Fq 'id="snell-add"' "$ROOT/panel/dist/smart-routing.html" || fail "Snell import control missing"
ok "smart routing UI markers present"

if [ -x "$ROOT/openwrt/bin/open-box" ]; then
  ok "OpenWrt control binary present"
else
  warn "OpenWrt control binary not found at expected path"
fi

if [ -x /etc/init.d/openbox-panel ]; then
  if /etc/init.d/openbox-panel status >/dev/null 2>&1; then
    ok "openbox-panel service is running"
  else
    warn "openbox-panel service is installed but not reported running"
  fi
elif command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files openbox-panel.service >/dev/null 2>&1; then
  if systemctl is-active --quiet openbox-panel.service; then
    ok "openbox-panel service is running"
  else
    warn "openbox-panel service is installed but not active"
  fi
else
  warn "panel service manager entry not detected"
fi

port=2026
if [ -r "$ROOT/data/panel-port" ]; then
  p="$(cat "$ROOT/data/panel-port" 2>/dev/null || true)"
  case "$p" in
    ''|*[!0-9]*) warn "invalid panel-port file; using fallback $port" ;;
    *) port="$p" ;;
  esac
fi

if command -v curl >/dev/null 2>&1; then
  code="$(curl -sS -o /tmp/openbox-doctor-body.$$ -w '%{http_code}' --max-time 5 "http://127.0.0.1:$port/" 2>/dev/null || true)"
  rm -f /tmp/openbox-doctor-body.$$ 2>/dev/null || true
  case "$code" in
    200|301|302|303|307|308|401|403) ok "panel HTTP reachable on 127.0.0.1:$port (HTTP $code)" ;;
    *) warn "panel HTTP check did not return a normal response on 127.0.0.1:$port (HTTP ${code:-none})" ;;
  esac
else
  warn "curl unavailable; skipped local HTTP check"
fi

printf '\n[doctor] PASS: smartalpha1 files and runtime prerequisites look consistent.\n'
printf '[doctor] Next: open the panel, import Snell, use Preview first, and only Apply after the generated chain is correct.\n'
