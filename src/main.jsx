import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// When a new build is deployed, the chunk filenames change and the
// currently-loaded SPA can fail to fetch the new chunks ("Failed to fetch
// dynamically imported module"). Vite emits `vite:preloadError` when this
// happens — auto-reload so the user transparently gets the latest bundle.
// We guard against an infinite reload loop by checking a sessionStorage flag.
window.addEventListener('vite:preloadError', (event) => {
  // eslint-disable-next-line no-console
  console.warn('[chunk] preload failed; reloading to pick up new bundle:', event.payload);
  if (!sessionStorage.getItem('ep:just-reloaded-for-chunks')) {
    sessionStorage.setItem('ep:just-reloaded-for-chunks', String(Date.now()));
    window.location.reload();
  }
});

// Clear the reload-guard on a successful navigation > 10s after the last attempt,
// so future deploys can trigger another reload if needed.
const lastReload = Number(sessionStorage.getItem('ep:just-reloaded-for-chunks') || 0);
if (lastReload && Date.now() - lastReload > 10000) {
  sessionStorage.removeItem('ep:just-reloaded-for-chunks');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
