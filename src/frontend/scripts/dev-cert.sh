#!/usr/bin/env bash
# 本地开发证书：自建根 CA + 带 IP SAN 的叶子证书（产品规划 3.1.6）。
#
# 为什么要它：手机等非本机设备只能用 https 才拿到安全上下文，`localhost` 的豁免只在
# 本机生效。而自签证书必须把「手机地址栏里那个地址」写进 SAN —— Chrome 只看 SAN，不看 CN。
#
# 全程离线：只调用 openssl，不访问任何外部服务，也不装 npm 依赖。
# 产物 .certs/ 已在 .gitignore 里：私钥绝不入库。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${HERE}/../.certs"
CA_KEY="${OUT}/rootCA.key"
CA_CRT="${OUT}/rootCA.crt"
DEV_KEY="${OUT}/dev.key"
DEV_CRT="${OUT}/dev.crt"

# 除本机地址外，还要签进手机要访问的地址。本机 WSL 的 NAT 地址每次重启都可能变，
# 所以运行时取，而不是写死。
IPS=(127.0.0.1)
HOSTS=(localhost)
if command -v hostname >/dev/null 2>&1; then
  for ip in $(hostname -I 2>/dev/null || true); do IPS+=("$ip"); done
fi
# 额外地址：./dev-cert.sh --ip 192.168.5.84
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ip)   IPS+=("$2"); shift 2 ;;
    --host) HOSTS+=("$2"); shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$OUT"
chmod 700 "$OUT"

# 叶子证书有效期 825 天（与 mkcert 一致），根 CA 1825 天：再长一些浏览器策略会更麻烦。
build_ca() {
  cat >"${OUT}/ca.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = speak-english dev CA
[v3]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 1825 \
    -keyout "$CA_KEY" -out "$CA_CRT" -config "${OUT}/ca.cnf" >/dev/null 2>&1
  echo "  根 CA 已生成"
}

build_leaf() {
  local i=1 h=1 alt=""
  for ip in "${IPS[@]}"; do alt+="IP.${i} = ${ip}"$'\n'; i=$((i+1)); done
  for host in "${HOSTS[@]}"; do alt+="DNS.${h} = ${host}"$'\n'; h=$((h+1)); done

  cat >"${OUT}/leaf.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = speak-english dev
[v3]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt
[alt]
${alt}
EOF
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$DEV_KEY" -out "${OUT}/dev.csr" -config "${OUT}/leaf.cnf" >/dev/null 2>&1
  openssl x509 -req -in "${OUT}/dev.csr" -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial \
    -days 825 -extensions v3 -extfile "${OUT}/leaf.cnf" -out "$DEV_CRT" >/dev/null 2>&1
  rm -f "${OUT}/dev.csr" "${OUT}/dev.srl"
  chmod 600 "$DEV_KEY" "$CA_KEY"
  echo "  叶子证书已签发"
}

# Re-issue when the CA is missing, --force was passed, the leaf no longer verifies,
# it expires within 30 days, or — the one that actually bites — the SAN no longer lists
# the address the phone types (the Windows DHCP address changes between sessions, and a
# stale SAN means ERR_CERT_COMMON_NAME_INVALID with nothing to explain it).
#
# `openssl x509 -checkend N` exits 0 when the cert will NOT expire within N seconds,
# so it must be used un-negated here.
wanted_san() {
  local i=1 h=1 out=()
  for ip in "${IPS[@]}"; do out+=("IP:${ip}"); done
  for host in "${HOSTS[@]}"; do out+=("DNS:${host}"); done
  printf '%s\n' "${out[@]}" | sort -u | paste -sd, -
}

current_san() {
  openssl x509 -in "$DEV_CRT" -noout -ext subjectAltName 2>/dev/null | tail -n +2 \
    | tr ',' '\n' | sed 's/^ *//' | awk '
      /^IP Address:/ {gsub(/^IP Address:/, "IP:"); print; next}
      /^DNS:/        {print; next}
    ' | sort -u | paste -sd, -
}

reuse=0
if [[ "${FORCE:-0}" != "1" && -f "$CA_CRT" && -f "$DEV_CRT" ]] \
   && openssl verify -CAfile "$CA_CRT" "$DEV_CRT" >/dev/null 2>&1 \
   && openssl x509 -in "$DEV_CRT" -checkend $((30 * 86400)) >/dev/null 2>&1 \
   && [[ "$(current_san)" == "$(wanted_san)" ]]; then
  reuse=1
fi

if [[ "$reuse" == "1" ]]; then
  echo "  复用现有证书（SAN 与有效期均匹配）"
else
  [[ -f "$CA_CRT" ]] || build_ca
  build_leaf
fi

echo "SAN: $(openssl x509 -in "$DEV_CRT" -noout -ext subjectAltName | tail -1 | tr -d ' ')"
echo "verify: $(openssl verify -CAfile "$CA_CRT" "$DEV_CRT" | sed "s|${OUT}/||")"
echo
echo "手机侧：把 ${CA_CRT} 传到设备并「安装 CA 证书」；iOS 还要在"
echo "  设置→通用→关于本机→证书信任设置 里开启完全信任，否则仍然报警告。"
echo "不装 CA 也能用麦克风：在警告页选「继续前往」——安全上下文只看 scheme 是不是 https。"
