import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Backend API. Sessions, secrets vault, server-side proxies for
      // external APIs. In prod, frontend + backend are same-origin so
      // this proxy isn't used — see server.js's static serving block.
      // NOTE: keep these BEFORE the legacy /api/{service}* rules so
      // they match first.
      '/api/auth': { target: 'http://localhost:4000', changeOrigin: true, secure: false },
      '/api/secrets': { target: 'http://localhost:4000', changeOrigin: true, secure: false },
      '/api/proxy': { target: 'http://localhost:4000', changeOrigin: true, secure: false },
      '/api/health': { target: 'http://localhost:4000', changeOrigin: true, secure: false },
      '/api/jibble-identity': {
        target: 'https://identity.prod.jibble.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/jibble-identity/, ''),
      },
      '/api/jibble-tt': {
        target: 'https://time-tracking.prod.jibble.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/jibble-tt/, '/v1'),
      },
      '/api/jibble': {
        target: 'https://workspace.prod.jibble.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/jibble/, '/v1'),
      },
      // Property Inspect — READ-ONLY pull integration.
      // Only GET requests are sent to PI's data API. The only POST is to
      // the OAuth token endpoint (authentication only, no data mutation).
      // NOTE: more specific prefixes must come before less specific ones.
      '/api/pi-oauth-api': {
        target: 'https://api.propertyinspect.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pi-oauth-api/, '/oauth'),
      },
      '/api/pi-oauth-my': {
        target: 'https://my.propertyinspect.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pi-oauth-my/, '/oauth'),
      },
      '/api/pi-api': {
        target: 'https://api.propertyinspect.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pi-api/, ''),
      },
      '/api/pi-my': {
        target: 'https://my.propertyinspect.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pi-my/, ''),
      },
      // DocuSign — OAuth + eSignature REST API.
      // Demo (sandbox) hosts:
      '/api/ds-auth-d': {
        target: 'https://account-d.docusign.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ds-auth-d/, ''),
      },
      '/api/ds-rest-d': {
        target: 'https://demo.docusign.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ds-rest-d/, ''),
      },
      // Production hosts:
      '/api/ds-auth': {
        target: 'https://account.docusign.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ds-auth/, ''),
      },
      '/api/ds-rest': {
        target: 'https://www.docusign.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ds-rest/, ''),
      },
    },
  },
})
