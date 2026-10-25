import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Opt-in HTTPS for phone/tablet testing (产品规划 3.1.6). Default stays http so the
// existing `http://localhost:5173` flow is untouched — localhost is already a secure
// context, so a cert buys it nothing.
//
// Why it is needed at all: getUserMedia only runs in a secure context, and the only
// http address that counts as one is localhost. A phone reaching this box over the LAN
// therefore has to be served over https.
const devHttps = process.env.DEV_HTTPS === '1';
const certDir = fileURLToPath(new URL('./.certs/', import.meta.url));

if (devHttps) {
  // Fail loudly rather than silently serving http: a quiet fallback is how you end up
  // debugging a certificate that was never loaded.
  for (const f of ['dev.key', 'dev.crt']) {
    try {
      readFileSync(`${certDir}${f}`);
    } catch {
      throw new Error(
        `DEV_HTTPS=1 但缺少 .certs/${f} —— 先运行: bash scripts/dev-cert.sh --ip <手机访问的地址>`,
      );
    }
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // LAN addresses only matter under DEV_HTTPS=1; over http this same bind is what
    // makes the phone reach a page it then refuses to give the microphone to.
    host: true,
    // 花生壳 intranet tunneling (产品规划 3.1.6). Vite matches the Host header against an
    // allow-list as a DNS-rebinding guard; IPs and localhost pass implicitly, which is
    // why the LAN address never tripped it but a tunnel domain does.
    // Leading dot = this domain and any subdomain of it: the free plan's hostname
    // rotates, so pinning `2az28am52083.vicp.fun` alone would break again next time.
    // ⚠️ This puts the dev server — and the /api proxy below, incl. open registration —
    // on a public URL. Tunnel it only while testing, and close it afterwards.
    allowedHosts: ['.vicp.fun'],
    ...(devHttps
      ? {
          https: {
            // Vite 5 takes key/cert directly — no @vitejs/plugin-basic-ssl needed,
            // which keeps one npm dependency off a machine whose npm mirror is flaky.
            key: readFileSync(`${certDir}dev.key`),
            cert: readFileSync(`${certDir}dev.crt`),
          },
        }
      : {}),
    proxy: {
      // Backend owns /api; dev server forwards so the browser stays same-origin.
      // Because requests are relative, switching to https introduces no mixed content
      // and needs no CORS change — the browser only ever sees one origin, and the
      // hop to http://localhost:8000 happens server-side (uvicorn binds 127.0.0.1 only,
      // which is exactly right: the phone must not reach the backend directly).
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
