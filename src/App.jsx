import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  LayoutDashboard, Building2, Users, Clock, ClipboardCheck, FileSignature,
  Settings as SettingsIcon, Search, Bell, ChevronDown, Plus, Edit2, Trash2, X,
  CheckCircle2, AlertCircle, TrendingUp, TrendingDown, DollarSign,
  Home, MapPin, Calendar, Mail, Phone, Download, RefreshCw,
  ExternalLink, Star, Activity, FileText, ChevronRight, LogOut, User,
  Wrench, BarChart3, Shield, Database, Sliders, Briefcase, Inbox,
  AlertTriangle, Undo2, Save, Info, Coffee, UserPlus, Layers, MoreVertical,
  Zap, Play, Pause, Lock, Calculator, Sparkles, Upload, Eye, FileCheck, History,
  Droplets, Siren, Send, Menu
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import * as api from './lib/api.js';

// ============================================================
// DESIGN TOKENS
// ============================================================
const brand = {
  navy: '#0F1E2E',
  navyDeep: '#0A1521',
  navyLight: '#1B2D42',
  gold: '#B8924A',
  goldLight: '#D4B370',
  goldPale: '#F5EBD6',
  cream: '#FAF7F0',
  ivory: '#FDFBF5',
  border: '#E8E2D4',
  borderDark: '#D4CCB8',
  text: '#1A1A1A',
  textMuted: '#6B6356',
  success: '#2D6A4F',
  successLight: '#D8E8DE',
  warning: '#A86523',
  warningLight: '#F5E2CC',
  danger: '#8B2929',
  dangerLight: '#F0D4D4',
};

// ============================================================
// VALIDATION HELPERS
// ============================================================
const validators = {
  required: (v) => (!v || String(v).trim() === '' ? 'This field is required' : ''),
  email: (v) => {
    if (!v) return 'Email is required';
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(v) ? '' : 'Please enter a valid email address';
  },
  phone: (v) => {
    if (!v) return 'Phone number is required';
    const cleaned = v.replace(/[\s\-()+]/g, '');
    if (!/^\d+$/.test(cleaned)) return 'Phone must contain only digits, spaces, +, -, ()';
    if (cleaned.length < 9 || cleaned.length > 15) return 'Phone must be between 9 and 15 digits';
    return '';
  },
  name: (v) => {
    if (!v || v.trim() === '') return 'Name is required';
    if (v.trim().length < 2) return 'Name must be at least 2 characters';
    if (!/^[a-zA-Z\s'-]+$/.test(v)) return 'Name can only contain letters, spaces, hyphens, and apostrophes';
    return '';
  },
  positiveNumber: (v) => {
    if (v === '' || v === null || v === undefined) return 'This field is required';
    const n = Number(v);
    if (isNaN(n)) return 'Must be a valid number';
    if (n <= 0) return 'Must be greater than zero';
    return '';
  },
  futureDate: (v) => {
    if (!v) return 'Date is required';
    const d = new Date(v);
    if (isNaN(d.getTime())) return 'Invalid date';
    if (d < new Date(new Date().toDateString())) return 'Date must be today or later';
    return '';
  },
  idNumber: (v) => {
    if (!v) return 'ID number is required';
    if (!/^\d+$/.test(v)) return 'ID must contain only digits';
    if (v.length !== 13) return 'ID must be exactly 13 digits';
    return '';
  },
};

const validateForm = (values, schema) => {
  const errors = {};
  Object.keys(schema).forEach((field) => {
    for (const validator of schema[field]) {
      const err = validator(values[field]);
      if (err) { errors[field] = err; break; }
    }
  });
  return errors;
};

// ============================================================
// PERSISTENT STORAGE HOOK
// Uses window.storage (Claude artifact persistent KV store)
// Falls back gracefully if storage isn't available.
// ============================================================
const useStoredState = (key, initialValue) => {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setStoredValue = useCallback((newValue) => {
    setValue((prev) => {
      const valueToStore = typeof newValue === 'function' ? newValue(prev) : newValue;
      try {
        localStorage.setItem(key, JSON.stringify(valueToStore));
      } catch {}
      return valueToStore;
    });
  }, [key]);

  return [value, setStoredValue, true];
};

// Format helpers
const formatCurrency = (n) => `R ${Number(n || 0).toLocaleString('en-ZA')}`;
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const todayISO = () => new Date().toISOString().split('T')[0];

// Time-ago helper for live UI
const timeAgo = (iso) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

// Name helpers — handle single-name employees gracefully
const fullName = (employee) => {
  if (!employee) return '';
  return `${employee.firstName || ''}${employee.lastName ? ' ' + employee.lastName : ''}`.trim();
};
const initials = (employee) => {
  if (!employee) return '';
  return `${(employee.firstName?.[0] || '').toUpperCase()}${(employee.lastName?.[0] || '').toUpperCase()}`;
};

// Password hashing — SHA-256 with per-user salt. Client-only, so not as strong
// as a server-side hash (no slow KDF), but better than plaintext for the
// localStorage-based credentials we have here.
const PASSWORD_DEFAULT = 'welcome123';
const hashPassword = async (password, email) => {
  const data = new TextEncoder().encode(`${(email || '').toLowerCase()}:${password}:exceed-properties`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

// ============================================================
// JIBBLE API CLIENT
// Supports two authentication methods:
//   1. Personal Access Token (PAT) — paste a single bearer token
//   2. API Key (OAuth 2.0 Client Credentials) — Client ID + Client Secret
//      → Token exchange against https://identity.prod.jibble.io/connect/token
//
// NOTE ON CORS: Direct browser → Jibble calls are typically blocked by CORS.
// In production, route requests through your own backend as a proxy.
// The error handler below surfaces this clearly when it happens.
// ============================================================
// On localhost, route direct Jibble URLs through the Vite dev proxy
// (configured in vite.config.js) so the browser doesn't hit CORS.
const localizeForDev = (url) => {
  if (typeof window === 'undefined') return url;
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return url;
  return url
    .replace(/^https:\/\/identity\.prod\.jibble\.io/, '/api/jibble-identity')
    .replace(/^https:\/\/time-tracking\.prod\.jibble\.io\/v1/, '/api/jibble-tt')
    .replace(/^https:\/\/workspace\.prod\.jibble\.io\/v1/, '/api/jibble');
};

const jibbleAPI = {
  defaultBaseUrl: 'https://workspace.prod.jibble.io/v1',
  timeTrackingBaseUrl: 'https://time-tracking.prod.jibble.io/v1',
  identityUrl: 'https://identity.prod.jibble.io/connect/token',

  // Exchange Client ID + Client Secret for an access token (OAuth Client Credentials)
  async exchangeClientCredentials({ clientId, clientSecret, identityUrl }) {
    if (!clientId || !clientSecret) {
      throw new Error('Both API Key ID (Client ID) and API Key Secret (Client Secret) are required');
    }
    const url = localizeForDev(identityUrl || this.identityUrl);
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new Error(
        `Network error: ${err.message}. CORS is blocking the token exchange. The identity endpoint must be called from your backend — once a proxy is in place this same code will work unchanged.`
      );
    }

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) {}
      if (res.status === 400) throw new Error('Invalid credentials (400). Check your API Key ID and Secret.');
      if (res.status === 401) throw new Error('Unauthorized (401). The credentials were rejected by Jibble.');
      throw new Error(`Token exchange failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    const data = await res.json();
    if (!data.access_token) throw new Error('Token response missing access_token');
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in, // seconds
      tokenType: data.token_type || 'Bearer',
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    };
  },

  // In-memory token cache, keyed by credentials so it auto-invalidates
  // when the user changes their API key.
  _tokenCache: { token: null, expiresAt: 0, credsKey: '' },

  // Get a valid bearer token, exchanging credentials if needed
  async getBearerToken(config) {
    if (config.authMethod === 'pat') {
      if (!config.personalAccessToken) throw new Error('Personal Access Token is required');
      return config.personalAccessToken;
    }
    const credsKey = `${config.clientId}|${config.clientSecret}`;
    const cache = this._tokenCache;
    if (cache.token && cache.credsKey === credsKey && Date.now() < cache.expiresAt - 60000) {
      return cache.token;
    }
    const { accessToken, expiresAt } = await this.exchangeClientCredentials({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    cache.token = accessToken;
    cache.expiresAt = new Date(expiresAt).getTime();
    cache.credsKey = credsKey;
    return accessToken;
  },

  // Generic request wrapper
  async request({ baseUrl, token, path, params = {} }) {
    if (!token) throw new Error('Bearer token is required');
    if (!baseUrl) throw new Error('API base URL is required');

    const url = new URL(
      localizeForDev(`${baseUrl.replace(/\/$/, '')}${path}`),
      typeof window !== 'undefined' ? window.location.origin : undefined
    );
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, v);
    });

    let res;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
    } catch (err) {
      throw new Error(
        `Network error: ${err.message}. This is usually CORS blocking the request — Jibble's API needs to be called from your backend, not the browser. Save your credentials anyway; they'll work once routed through a server.`
      );
    }

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) {}
      if (res.status === 401) throw new Error('Authentication failed (401). Your token is invalid or expired.');
      if (res.status === 403) throw new Error('Forbidden (403). Your token may lack the required scope.');
      if (res.status === 404) throw new Error(`Endpoint not found (404). Check the API base URL.`);
      if (res.status === 429) throw new Error('Rate limit exceeded (429). Try again in a moment.');
      throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200) || res.statusText}`);
    }

    return res.json();
  },

  // Full test: get token (exchange if OAuth) then call People
  async testConnection(config) {
    const token = await this.getBearerToken(config);
    const data = await this.request({
      baseUrl: config.apiBaseUrl, token, path: '/People',
      params: { '$top': 1, '$select': 'id,fullName' },
    });
    return { token, data };
  },

  // List people
  async fetchPeople(config) {
    const token = await this.getBearerToken(config);
    return this.request({
      baseUrl: config.apiBaseUrl, token, path: '/People',
      params: { '$top': 50, '$select': 'id,fullName,email,status,role', '$orderby': 'fullName' },
    });
  },

  // List projects — used to resolve TimeEntry projectId → friendly project name.
  // Hardcoded to the workspace host so it routes through the dev proxy regardless
  // of any custom apiBaseUrl the user has saved.
  async fetchProjects(config) {
    const token = await this.getBearerToken(config);
    return this.request({
      baseUrl: this.defaultBaseUrl, token, path: '/Projects',
      params: { '$top': 500 },
    });
  },

  // List time entries. NOTE: TimeEntries lives on the time-tracking host,
  // NOT the workspace host where People/Organizations live.
  async fetchTimeEntries(config, { from, to, top = 100 } = {}) {
    const token = await this.getBearerToken(config);
    const filter = [];
    if (from) filter.push(`belongsToDate ge ${from}`);
    if (to) filter.push(`belongsToDate le ${to}`);
    return this.request({
      baseUrl: this.timeTrackingBaseUrl,
      token,
      path: '/TimeEntries',
      params: {
        '$top': top,
        '$filter': filter.join(' and ') || undefined,
        '$orderby': 'time desc',
        '$expand': 'person',
      },
    });
  },
};

// ============================================================
// PROPERTY INSPECT API CLIENT — READ-ONLY
// OAuth 2 Client Credentials → exchanges Client ID + Secret for
// an Auth token + Refresh token (per Property Inspect API spec).
//
// Safety: this client only exposes GET helpers. There is intentionally
// no method that can POST/PUT/PATCH/DELETE business data on Property
// Inspect's side, so importing inspections cannot mutate PI's records.
// The only POSTs are to the OAuth token endpoint, which is authentication
// only and does not modify any PI customer data.
// ============================================================
const localizePIForDev = (url) => {
  if (typeof window === 'undefined') return url;
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return url;
  return url
    // Primary OAuth on api.propertyinspect.com
    .replace(/^https:\/\/api\.propertyinspect\.com\/oauth/, '/api/pi-oauth-api')
    // Primary API host — bare resource paths
    .replace(/^https:\/\/api\.propertyinspect\.com/, '/api/pi-api')
    // Legacy OAuth on my.propertyinspect.com (used as fallback)
    .replace(/^https:\/\/my\.propertyinspect\.com\/oauth/, '/api/pi-oauth-my')
    .replace(/^https:\/\/my\.propertyinspect\.com/, '/api/pi-my');
};

const propertyInspectAPI = {
  defaultBaseUrl: 'https://api.propertyinspect.com',
  defaultTokenUrl: 'https://api.propertyinspect.com/oauth/token',
  // PI uses Laravel Passport: the user-facing authorize page is on the
  // 'my.' host (their app shell). Pointing this at api.propertyinspect.com
  // hits a JSON-only endpoint that returns {"message":"Unauthenticated."}
  // when there's no Bearer token — the symptom users saw when connecting.
  defaultAuthorizeUrl: 'https://my.propertyinspect.com/oauth/authorize',
  // The OLD bad default — if a user has this saved in their integration
  // state from a previous version, we silently rewrite it to the right
  // host below in the PI card's form init.
  legacyBadAuthorizeUrl: 'https://api.propertyinspect.com/oauth/authorize',
  defaultRedirectUri: typeof window !== 'undefined'
    ? `${window.location.origin}/oauth/pi-callback`
    : 'http://localhost:5173/oauth/pi-callback',

  // Build the URL the user is redirected to so they can approve our app.
  // Returns the absolute https:// URL — never the dev-proxy rewrite, because
  // the user's browser must reach Property Inspect directly, not via Vite.
  buildAuthorizeUrl({ clientId, redirectUri, state, scope, authorizeUrl }) {
    const url = new URL(authorizeUrl || this.defaultAuthorizeUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri || this.defaultRedirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    if (scope) url.searchParams.set('scope', scope);
    return url.toString();
  },

  // Exchange the authorization code returned in the redirect callback for a
  // user-bound access token (+ refresh token).
  async exchangeAuthorizationCode({ clientId, clientSecret, code, redirectUri, tokenUrl }) {
    if (!clientId || !clientSecret) throw new Error('Client ID and Secret required');
    if (!code) throw new Error('Authorization code required');
    const url = localizePIForDev(tokenUrl || this.defaultTokenUrl);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri || this.defaultRedirectUri,
      code,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Authorization code exchange failed (HTTP ${res.status}): ${text || res.statusText}`);
    }
    const json = await res.json();
    if (!json.access_token) throw new Error('Token response missing access_token');
    const expiresIn = Number(json.expires_in) || 3600;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || null,
      expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000,
    };
  },

  // Exchange client_id + client_secret for an access_token (+ refresh_token).
  // `scope` is now optional — pass undefined to omit the param entirely.
  async exchangeClientCredentials({ clientId, clientSecret, tokenUrl, scope }) {
    if (!clientId || !clientSecret) {
      throw new Error('Client ID and Client Secret are both required');
    }
    const url = localizePIForDev(tokenUrl || this.defaultTokenUrl);
    const params = {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    };
    if (scope !== undefined && scope !== null) params.scope = scope;
    const body = new URLSearchParams(params);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body,
      });
    } catch (err) {
      throw new Error(
        `Network error contacting Property Inspect token endpoint. This is usually a CORS block — proxy the request through your backend or the Vite dev proxy. (${err.message})`
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Token exchange failed (HTTP ${res.status}): ${text || res.statusText}`);
    }
    const json = await res.json();
    if (!json.access_token) {
      throw new Error('Token exchange response did not contain an access_token.');
    }
    const expiresIn = Number(json.expires_in) || 3600;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || null,
      // Subtract 30s as a safety margin so we refresh before the real expiry.
      expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000,
      tokenType: json.token_type || 'Bearer',
      scope: json.scope || null,
    };
  },

  // Refresh expired access token.
  async refreshAccessToken({ refreshToken, clientId, clientSecret, tokenUrl }) {
    if (!refreshToken) throw new Error('No refresh token available — re-authenticate with Client ID + Secret');
    const url = localizePIForDev(tokenUrl || this.defaultTokenUrl);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Refresh token failed (HTTP ${res.status}): ${text || res.statusText}`);
    }
    const json = await res.json();
    const expiresIn = Number(json.expires_in) || 3600;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000,
    };
  },

  // Generic GET helper. The only method that ever hits PI data endpoints.
  // It is deliberately the only verb exposed.
  // PI's CORS preflight allows direct calls from http://localhost:5173 with
  // credentials, so we hit api.propertyinspect.com directly (no dev proxy)
  // and include credentials — if the user is logged into PI in this browser,
  // the session cookie may auth the request alongside the Bearer token.
  async _get(path, { accessToken, baseUrl, params, useDirect = true }) {
    const base = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const directUrl = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    const finalUrl = useDirect ? directUrl : localizePIForDev(directUrl);
    const browserBase = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = /^https?:\/\//i.test(finalUrl) ? new URL(finalUrl) : new URL(finalUrl, browserBase);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.append(k, v);
      });
    }
    // Match PI's documented request exactly — Bearer token + Accept JSON.
    const trimmedToken = (accessToken || '').trim();
    const res = await fetch(url.toString(), {
      method: 'GET',
      credentials: useDirect ? 'include' : 'same-origin',
      headers: {
        'Authorization': `Bearer ${trimmedToken}`,
        'Accept': 'application/json',
      },
    });
    // Capture the WWW-Authenticate header on auth/scope failures — it often
    // contains the exact scopes the endpoint requires (e.g.
    // `Bearer scope="inspections.read"`).
    const wwwAuth = res.headers.get('www-authenticate') || '';
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('json')) {
      const text = await res.text().catch(() => '');
      if (/^\s*<(!doctype|html)/i.test(text)) {
        throw new Error(`Property Inspect returned an HTML page (HTTP ${res.status}) instead of JSON for ${path}. The API Base URL doesn't match an API route, or the token isn't accepted for data endpoints.`);
      }
      if (!res.ok) {
        const wwwLine = wwwAuth ? `\nWWW-Authenticate: ${wwwAuth}` : '';
        throw new Error(`Property Inspect GET ${path} failed (HTTP ${res.status}): ${(text || res.statusText).slice(0, 300)}${wwwLine}`);
      }
      throw new Error(`Property Inspect returned non-JSON (content-type "${contentType}") for ${path}.`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const wwwLine = wwwAuth ? `\nWWW-Authenticate: ${wwwAuth}` : '';
      throw new Error(`Property Inspect GET ${path} failed (HTTP ${res.status}): ${(text || res.statusText).slice(0, 300)}${wwwLine}`);
    }
    return res.json();
  },

  // Probe a list of candidate (baseUrl, path) combos and return the first
  // one that returns valid JSON. Strictly read-only.
  async discoverBaseUrl({ accessToken, candidates, probePaths }) {
    const tried = [];
    const paths = probePaths || ['/inspections'];
    for (const candidate of candidates) {
      for (const path of paths) {
        try {
          const data = await this._get(path, { accessToken, baseUrl: candidate, params: { page: 1, perPage: 1 } });
          return { baseUrl: candidate, workingPath: path, sample: data, tried };
        } catch (err) {
          tried.push({ baseUrl: candidate, path, error: err.message });
        }
      }
    }
    return { baseUrl: null, workingPath: null, tried };
  },

  // Try the documented path first; on 403 "Invalid scope(s) provided" fall
  // back through known list/search sub-routes that may bypass scope middleware.
  // Read-only; never modifies PI data.
  inspectionListPaths: ['/inspections', '/inspections/list', '/inspections/search', '/inspections/index', '/inspections/all'],

  async listInspections({ accessToken, baseUrl, page = 1, perPage = 25, since, status }) {
    const params = { page, perPage, ...(since ? { since } : {}), ...(status ? { status } : {}) };
    const errors = [];
    for (const path of this.inspectionListPaths) {
      try {
        const data = await this._get(path, { accessToken, baseUrl, params });
        return { ...data, _workingPath: path };
      } catch (err) {
        errors.push(`${path}: ${err.message}`);
        // Only retry on scope/permission errors; other errors are likely
        // structural (404, network) and shouldn't trigger fallback.
        if (!/403|Invalid scope|Unauthorized/i.test(err.message)) {
          throw err;
        }
      }
    }
    throw new Error(`All inspection-list endpoints failed:\n${errors.join('\n')}`);
  },

  async getInspection({ accessToken, baseUrl, id }) {
    return this._get(`/inspections/${encodeURIComponent(id)}`, { accessToken, baseUrl });
  },

  // Convenience: get a fresh access token (using cached one if still valid)
  // or refresh it. NEVER falls back to client_credentials, because the data
  // endpoints reject those tokens with a 500 — they need a user-bound token
  // from the authorization_code flow.
  async ensureAccessToken(pi) {
    const now = Date.now();
    if (pi.cachedAccessToken && pi.cachedAccessTokenExpiry && now < pi.cachedAccessTokenExpiry) {
      return { accessToken: pi.cachedAccessToken, updates: null };
    }
    if (pi.cachedRefreshToken) {
      const refreshed = await this.refreshAccessToken({
        refreshToken: pi.cachedRefreshToken,
        clientId: pi.clientId,
        clientSecret: pi.clientSecret,
        tokenUrl: pi.tokenUrl,
      });
      return {
        accessToken: refreshed.accessToken,
        updates: {
          cachedAccessToken: refreshed.accessToken,
          cachedAccessTokenExpiry: refreshed.expiresAt,
          cachedRefreshToken: refreshed.refreshToken,
        },
      };
    }
    throw new Error('No access token available. Click "Connect with Property Inspect" to authenticate.');
  },
};

// ============================================================
// DOCUSIGN API CLIENT
// Authorization Code OAuth flow (browser-friendly, no private key).
// Real REST envelope creation via eSignature REST API v2.1.
// ============================================================
//
// DocuSign hosts differ between developer sandbox and production.
//   Demo  (sandbox) — account-d.docusign.com (auth) + demo.docusign.net  (api)
//   Prod  (live)    — account.docusign.com  (auth) + per-account base URI
//
// Required OAuth scopes for envelope creation:
//   - signature (basic envelope operations)
//   - extended  (optional — enables refresh tokens)
//
// IMPORTANT: This client never deletes envelopes, never voids envelopes,
// and never modifies recipients on existing envelopes. The only write
// operation it exposes is `createEnvelope` (POST /envelopes) which creates
// a NEW envelope from the lease document. All other methods are GETs.
const DOCUSIGN_ENVIRONMENTS = {
  demo: {
    label: 'Demo / Sandbox',
    authHost: 'https://account-d.docusign.com',
    defaultBaseUri: 'https://demo.docusign.net/restapi',
  },
  prod: {
    label: 'Production',
    authHost: 'https://account.docusign.com',
    // base URI is account-specific — we fetch the real one from /userinfo
    defaultBaseUri: 'https://www.docusign.net/restapi',
  },
};

const localizeDocuSignForDev = (url) => {
  if (typeof window === 'undefined') return url;
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return url;
  return url
    .replace(/^https:\/\/account-d\.docusign\.com/, '/api/ds-auth-d')
    .replace(/^https:\/\/account\.docusign\.com/, '/api/ds-auth')
    // Any DocuSign REST host — match the most specific patterns first.
    .replace(/^https:\/\/demo\.docusign\.net/, '/api/ds-rest-d')
    .replace(/^https:\/\/(eu|na1|na2|na3|na4|au|ca|sg)\.docusign\.net/, '/api/ds-rest')
    .replace(/^https:\/\/www\.docusign\.net/, '/api/ds-rest');
};

const docusignAPI = {
  // Build the URL the user is redirected to in order to approve our app.
  buildAuthorizeUrl({ environment = 'demo', clientId, redirectUri, state, scope = 'signature extended' }) {
    const env = DOCUSIGN_ENVIRONMENTS[environment] || DOCUSIGN_ENVIRONMENTS.demo;
    const url = new URL(`${env.authHost}/oauth/auth`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scope);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  },

  // Exchange authorization code for access + refresh tokens.
  async exchangeAuthorizationCode({ environment = 'demo', clientId, clientSecret, code, redirectUri }) {
    const env = DOCUSIGN_ENVIRONMENTS[environment] || DOCUSIGN_ENVIRONMENTS.demo;
    const url = localizeDocuSignForDev(`${env.authHost}/oauth/token`);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
    });
    const basic = btoa(`${clientId}:${clientSecret}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DocuSign token exchange failed (HTTP ${res.status}): ${text || res.statusText}`);
    }
    const json = await res.json();
    if (!json.access_token) throw new Error('DocuSign token response missing access_token');
    const expiresIn = Number(json.expires_in) || 3600;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || null,
      expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000,
    };
  },

  // Refresh an expired access token using the stored refresh token.
  async refreshAccessToken({ environment = 'demo', clientId, clientSecret, refreshToken }) {
    if (!refreshToken) throw new Error('No DocuSign refresh token — re-authenticate.');
    const env = DOCUSIGN_ENVIRONMENTS[environment] || DOCUSIGN_ENVIRONMENTS.demo;
    const url = localizeDocuSignForDev(`${env.authHost}/oauth/token`);
    const basic = btoa(`${clientId}:${clientSecret}`);
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DocuSign refresh failed (HTTP ${res.status}): ${text || res.statusText}`);
    }
    const json = await res.json();
    const expiresIn = Number(json.expires_in) || 3600;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000,
    };
  },

  // Read user/account info — used right after OAuth to auto-detect
  // accountId and base_uri (production base URIs vary per account region).
  async getUserInfo({ environment = 'demo', accessToken }) {
    const env = DOCUSIGN_ENVIRONMENTS[environment] || DOCUSIGN_ENVIRONMENTS.demo;
    const url = localizeDocuSignForDev(`${env.authHost}/oauth/userinfo`);
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DocuSign /userinfo failed (HTTP ${res.status}): ${text || res.statusText}`);
    }
    return res.json();
  },

  // Get a specific envelope's status. Read-only.
  async getEnvelope({ baseUri, accountId, envelopeId, accessToken }) {
    const url = localizeDocuSignForDev(`${baseUri}/v2.1/accounts/${encodeURIComponent(accountId)}/envelopes/${encodeURIComponent(envelopeId)}`);
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DocuSign getEnvelope failed (HTTP ${res.status}): ${text || res.statusText}`);
    }
    return res.json();
  },

  // Create a NEW envelope. This is the ONLY write method exposed.
  // No method exists in this client to void, delete, or modify an envelope's
  // recipients/documents after creation.
  async createEnvelope({ baseUri, accountId, envelope, accessToken }) {
    const url = localizeDocuSignForDev(`${baseUri}/v2.1/accounts/${encodeURIComponent(accountId)}/envelopes`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DocuSign createEnvelope failed (HTTP ${res.status}): ${text || res.statusText}`);
    }
    return res.json();
  },

  // Ensure we have a fresh access token, refreshing if needed.
  async ensureAccessToken(ds) {
    const now = Date.now();
    if (ds.cachedAccessToken && ds.cachedAccessTokenExpiry && now < ds.cachedAccessTokenExpiry) {
      return { accessToken: ds.cachedAccessToken, updates: null };
    }
    if (ds.cachedRefreshToken) {
      const refreshed = await this.refreshAccessToken({
        environment: ds.environment,
        clientId: ds.integrationKey,
        clientSecret: ds.clientSecret,
        refreshToken: ds.cachedRefreshToken,
      });
      return {
        accessToken: refreshed.accessToken,
        updates: {
          cachedAccessToken: refreshed.accessToken,
          cachedAccessTokenExpiry: refreshed.expiresAt,
          cachedRefreshToken: refreshed.refreshToken,
        },
      };
    }
    throw new Error('No DocuSign access token available. Click Connect in Settings → Integrations.');
  },
};

// Helper — convert a Blob (e.g. a generated lease DOCX) to a base64 string
// suitable for DocuSign's documentBase64 field. Pure local operation.
const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => {
    const result = String(reader.result || '');
    const comma = result.indexOf(',');
    resolve(comma >= 0 ? result.slice(comma + 1) : result);
  };
  reader.readAsDataURL(blob);
});

// Anchor strings the lease template should embed at each signature spot.
// DocuSign locates these strings in the rendered document and places the
// matching sign/date/initial field at that exact position. Keep these
// strings unusual enough that they will never appear in normal lease text.
const DOCUSIGN_ANCHORS = {
  landlord: {
    signature: '\\sig_landlord\\',
    date:      '\\date_landlord\\',
    name:      '\\name_landlord\\',
    initials:  '\\init_landlord\\',
  },
  tenant: {
    signature: '\\sig_tenant\\',
    date:      '\\date_tenant\\',
    name:      '\\name_tenant\\',
    initials:  '\\init_tenant\\',
  },
  surety: (n) => ({
    signature: `\\sig_surety_${n}\\`,
    date:      `\\date_surety_${n}\\`,
    name:      `\\name_surety_${n}\\`,
    initials:  `\\init_surety_${n}\\`,
  }),
  witness: (n) => ({
    signature: `\\sig_witness_${n}\\`,
    date:      `\\date_witness_${n}\\`,
    name:      `\\name_witness_${n}\\`,
  }),
};

// Build DocuSign tab definitions from anchor strings.
// All anchor offsets are pixels; positive Y moves the field DOWN on the page.
const buildSignerTabs = (anchorSet) => ({
  signHereTabs: anchorSet.signature ? [{
    anchorString: anchorSet.signature,
    anchorUnits: 'pixels',
    anchorXOffset: '0',
    anchorYOffset: '0',
    anchorIgnoreIfNotPresent: 'true',
  }] : [],
  dateSignedTabs: anchorSet.date ? [{
    anchorString: anchorSet.date,
    anchorUnits: 'pixels',
    anchorXOffset: '0',
    anchorYOffset: '0',
    anchorIgnoreIfNotPresent: 'true',
  }] : [],
  fullNameTabs: anchorSet.name ? [{
    anchorString: anchorSet.name,
    anchorUnits: 'pixels',
    anchorXOffset: '0',
    anchorYOffset: '0',
    anchorIgnoreIfNotPresent: 'true',
  }] : [],
  initialHereTabs: anchorSet.initials ? [{
    anchorString: anchorSet.initials,
    anchorUnits: 'pixels',
    anchorXOffset: '0',
    anchorYOffset: '0',
    anchorIgnoreIfNotPresent: 'true',
  }] : [],
});

// ============================================================
// DEPARTMENT & TEAM STRUCTURE
// Three primary departments, each with multiple teams.
// ============================================================
const DEPARTMENTS_CONFIG = {
  'Executive': {
    color: '#0F1E2E',
    description: 'Company leadership',
    teams: [],
  },
  'Debtors': {
    color: '#8B2929',
    description: 'Collections and accounts receivable',
    teams: ['Commercial Debt Recovery', 'Residential Debt Recovery'],
  },
  'Commercial Leasing': {
    color: '#B8924A',
    description: 'Retail, office, and industrial property leasing',
    teams: ['Retail Leasing', 'Office & Industrial'],
  },
  'Residential Leasing': {
    color: '#2D6A4F',
    description: 'Apartment and residential property leasing',
    teams: ['Apartments', 'Estates & Homes'],
  },
};

const getDepartmentName = (deptKey) => deptKey;
const getTeamsForDepartment = (deptKey) => DEPARTMENTS_CONFIG[deptKey]?.teams || [];
const getAllTeams = () => Object.entries(DEPARTMENTS_CONFIG).flatMap(([dept, cfg]) => cfg.teams.map(t => ({ dept, team: t })));

// ============================================================
// ROLES & PERMISSIONS
// Defines the RBAC system. Every section/action checks against this.
// ============================================================
const PERMISSIONS = {
  VIEW_DASHBOARD: 'view:dashboard',
  VIEW_PROPERTIES: 'view:properties',
  EDIT_PROPERTIES: 'edit:properties',
  VIEW_EMPLOYEES: 'view:employees',
  EDIT_EMPLOYEES: 'edit:employees',
  VIEW_TIME: 'view:time',
  APPROVE_TIME: 'approve:time',
  VIEW_INSPECTIONS: 'view:inspections',
  EDIT_INSPECTIONS: 'edit:inspections',
  VIEW_MAINTENANCE: 'view:maintenance',
  EDIT_MAINTENANCE: 'edit:maintenance',
  VIEW_OUTAGES: 'view:outages',
  REPORT_OUTAGES: 'report:outages',
  VIEW_TENANCY: 'view:tenancy',
  VIEW_PROJECTIONS: 'view:projections',
  VIEW_LEASE_LEARNER: 'view:leaseLearner',
  VIEW_LEASING: 'view:leasing',
  EDIT_LEASING: 'edit:leasing',
  VIEW_DEBTORS: 'view:debtors',
  EDIT_DEBTORS: 'edit:debtors',
  VIEW_REPORTS: 'view:reports',
  VIEW_ONDESK: 'view:ondesk',
  EDIT_ONDESK: 'edit:ondesk',
  VIEW_SETTINGS: 'view:settings',
  MANAGE_USERS: 'manage:users',
};

const ROLES = {
  director: {
    label: 'Director',
    description: 'Full access to every section and action',
    color: '#0F1E2E',
    permissions: Object.values(PERMISSIONS),
  },
  property_manager: {
    label: 'Property Manager',
    description: 'Operations, maintenance, inspections, and time approval',
    color: '#B8924A',
    permissions: [
      PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_PROPERTIES, PERMISSIONS.EDIT_PROPERTIES,
      PERMISSIONS.VIEW_EMPLOYEES, PERMISSIONS.VIEW_TIME, PERMISSIONS.APPROVE_TIME,
      PERMISSIONS.VIEW_INSPECTIONS, PERMISSIONS.EDIT_INSPECTIONS,
      PERMISSIONS.VIEW_MAINTENANCE, PERMISSIONS.EDIT_MAINTENANCE,
      PERMISSIONS.VIEW_OUTAGES, PERMISSIONS.REPORT_OUTAGES,
      PERMISSIONS.VIEW_TENANCY, PERMISSIONS.VIEW_PROJECTIONS, PERMISSIONS.VIEW_LEASE_LEARNER,
      PERMISSIONS.VIEW_LEASING, PERMISSIONS.VIEW_DEBTORS, PERMISSIONS.VIEW_REPORTS,
      PERMISSIONS.VIEW_ONDESK, PERMISSIONS.EDIT_ONDESK,
    ],
  },
  leasing_agent: {
    label: 'Leasing Agent',
    description: 'Lease management and tenant onboarding',
    color: '#2D6A4F',
    permissions: [
      PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_PROPERTIES,
      PERMISSIONS.VIEW_LEASING, PERMISSIONS.EDIT_LEASING,
      PERMISSIONS.VIEW_DEBTORS, PERMISSIONS.VIEW_TENANCY,
      PERMISSIONS.VIEW_LEASE_LEARNER, PERMISSIONS.VIEW_PROJECTIONS,
      PERMISSIONS.VIEW_ONDESK, PERMISSIONS.EDIT_ONDESK,
    ],
  },
  inspector: {
    label: 'Property Inspector',
    description: 'Conduct inspections and report findings',
    color: '#A86523',
    permissions: [
      PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_PROPERTIES,
      PERMISSIONS.VIEW_INSPECTIONS, PERMISSIONS.EDIT_INSPECTIONS,
      PERMISSIONS.VIEW_MAINTENANCE, PERMISSIONS.VIEW_OUTAGES, PERMISSIONS.REPORT_OUTAGES,
      PERMISSIONS.VIEW_ONDESK, PERMISSIONS.EDIT_ONDESK,
    ],
  },
  debtors_manager: {
    label: 'Debtors Manager',
    description: 'Track payments and chase overdue accounts',
    color: '#8B2929',
    permissions: [
      PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_DEBTORS, PERMISSIONS.EDIT_DEBTORS,
      PERMISSIONS.VIEW_LEASING, PERMISSIONS.VIEW_REPORTS,
      PERMISSIONS.VIEW_ONDESK, PERMISSIONS.EDIT_ONDESK,
    ],
  },
  maintenance: {
    label: 'Maintenance Staff',
    description: 'Handle maintenance requests and repairs',
    color: '#1B2D42',
    permissions: [
      PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_PROPERTIES,
      PERMISSIONS.VIEW_MAINTENANCE, PERMISSIONS.EDIT_MAINTENANCE,
      PERMISSIONS.VIEW_OUTAGES, PERMISSIONS.REPORT_OUTAGES,
      PERMISSIONS.VIEW_ONDESK, PERMISSIONS.EDIT_ONDESK,
    ],
  },
  readonly: {
    label: 'Read-Only Viewer',
    description: 'Can view everything but cannot edit',
    color: '#6B6356',
    permissions: [
      PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_PROPERTIES, PERMISSIONS.VIEW_EMPLOYEES,
      PERMISSIONS.VIEW_TIME, PERMISSIONS.VIEW_INSPECTIONS, PERMISSIONS.VIEW_MAINTENANCE,
      PERMISSIONS.VIEW_LEASING, PERMISSIONS.VIEW_DEBTORS, PERMISSIONS.VIEW_REPORTS,
      PERMISSIONS.VIEW_OUTAGES, PERMISSIONS.VIEW_TENANCY,
      PERMISSIONS.VIEW_PROJECTIONS, PERMISSIONS.VIEW_LEASE_LEARNER,
      PERMISSIONS.VIEW_ONDESK,
    ],
  },
};

const hasPermission = (user, permission) => {
  if (!user || !user.systemRole) return false;
  const role = ROLES[user.systemRole];
  return role ? role.permissions.includes(permission) : false;
};

// Desk status types — what someone is currently doing
const DESK_STATUSES = {
  working: { label: 'Working', color: '#2D6A4F', bg: '#D8E8DE', icon: Activity },
  in_meeting: { label: 'In Meeting', color: '#A86523', bg: '#F5E2CC', icon: Users },
  on_break: { label: 'On Break', color: '#B8924A', bg: '#F5EBD6', icon: Coffee },
  travelling: { label: 'Travelling', color: '#1B2D42', bg: '#E8EEF5', icon: MapPin },
  unavailable: { label: 'Unavailable', color: '#8B2929', bg: '#F0D4D4', icon: Pause },
  off_duty: { label: 'Off Duty', color: '#6B6356', bg: '#E8E2D4', icon: Lock },
};

// ============================================================
// SEED DATA
// ============================================================
const seedEmployees = [
  // Executive
  { id: 0, firstName: 'Wayne', lastName: 'Marks', email: 'w.marks@exceedproperties.co.za', phone: '+27 82 555 0001', role: 'Managing Director', department: 'Executive', team: null, isTeamLead: false, status: 'Active', startDate: '2018-01-15', idNumber: '7503125678901', systemAccess: true, systemRole: 'director', lastLogin: '2026-05-12T08:14:00Z' },

  // Commercial Leasing
  { id: 1, firstName: 'Giovani', lastName: 'Bonani', email: 'g.bonani@exceedproperties.co.za', phone: '+27 82 555 1234', role: 'Retail Leasing Manager', department: 'Commercial Leasing', team: 'Retail Leasing', isTeamLead: true, status: 'Active', startDate: '2022-03-15', idNumber: '8504125678901', systemAccess: true, systemRole: 'property_manager', lastLogin: '2026-05-12T07:48:00Z' },
  { id: 2, firstName: 'Earle', lastName: 'Marks', email: 'e.marks@exceedproperties.co.za', phone: '+27 83 555 9821', role: 'Office Leasing Manager', department: 'Commercial Leasing', team: 'Office & Industrial', isTeamLead: true, status: 'Active', startDate: '2021-07-01', idNumber: '8801025432109', systemAccess: true, systemRole: 'leasing_agent', lastLogin: '2026-05-12T08:02:00Z' },
  { id: 3, firstName: 'Hetty', lastName: '', email: 'hetty@exceedproperties.co.za', phone: '+27 84 555 4471', role: 'Property Inspector', department: 'Commercial Leasing', team: 'Retail Leasing', isTeamLead: false, status: 'Active', startDate: '2023-01-20', idNumber: '9203157890123', systemAccess: true, systemRole: 'inspector', lastLogin: '2026-05-12T07:55:00Z' },

  // Debtors
  { id: 4, firstName: 'Trinity', lastName: '', email: 'trinity@exceedproperties.co.za', phone: '+27 82 555 7733', role: 'Debtors Manager', department: 'Debtors', team: 'Commercial Debt Recovery', isTeamLead: true, status: 'Active', startDate: '2020-11-08', idNumber: '8607234567890', systemAccess: true, systemRole: 'debtors_manager', lastLogin: '2026-05-12T07:30:00Z' },
  { id: 5, firstName: 'Zollie', lastName: '', email: 'zollie@exceedproperties.co.za', phone: '+27 83 555 6677', role: 'Residential Debt Recovery Lead', department: 'Debtors', team: 'Residential Debt Recovery', isTeamLead: true, status: 'Active', startDate: '2022-09-05', idNumber: '8801056789012', systemAccess: true, systemRole: 'debtors_manager', lastLogin: '2026-05-12T08:15:00Z' },

  // Residential Leasing
  { id: 6, firstName: 'Shaheen', lastName: 'Kolia', email: 's.kolia@exceedproperties.co.za', phone: '+27 84 555 1188', role: 'Residential Apartments Manager', department: 'Residential Leasing', team: 'Apartments', isTeamLead: true, status: 'Active', startDate: '2023-04-01', idNumber: '8712034567890', systemAccess: true, systemRole: 'leasing_agent', lastLogin: '2026-05-12T08:20:00Z' },
];

const seedProperties = [
  { id: 1, address: 'Bougainville Shopping Centre, Pretoria', type: 'Shopping Centre', units: 28, occupied: 26, manager: 'Giovani Bonani', status: 'Active' },
  { id: 2, address: 'Protea Shopping Centre, Soweto', type: 'Shopping Centre', units: 42, occupied: 39, manager: 'Giovani Bonani', status: 'Active' },
  { id: 3, address: 'Kempton Park Shopping Centre, Kempton Park', type: 'Shopping Centre', units: 36, occupied: 31, manager: 'Giovani Bonani', status: 'Active' },
  { id: 4, address: 'Woodmead Office Park, Sandton', type: 'Office Park', units: 24, occupied: 22, manager: 'Earle Marks', status: 'Active' },
  { id: 5, address: 'Riverside Estate, Modderfontein', type: 'Apartment Complex', units: 64, occupied: 58, manager: 'Shaheen Kolia', status: 'Active' },
  { id: 6, address: 'Greenstone Hill Estate, Edenvale', type: 'Residential Estate', units: 42, occupied: 39, manager: 'Yehuda Noik', status: 'Active' },
  { id: 7, address: 'Bryanston Heights Apartments, Sandton', type: 'Apartment Complex', units: 36, occupied: 32, manager: 'Shaheen Kolia', status: 'Active' },
];

const seedInspections = [
  { id: 1, property: 'Bougainville Shopping Centre, Pretoria', unit: 'Shop 4', inspector: 'Hetty', scheduledDate: '2026-05-14', type: 'Move-out', status: 'Scheduled', priority: 'High' },
  { id: 2, property: 'Protea Shopping Centre, Soweto', unit: 'Common Areas', inspector: 'Hetty', scheduledDate: '2026-05-12', type: 'Quarterly', status: 'Completed', priority: 'Medium', score: 92 },
  { id: 3, property: 'Kempton Park Shopping Centre, Kempton Park', unit: 'Shop 8', inspector: 'Hetty', scheduledDate: '2026-05-15', type: 'Move-in', status: 'Scheduled', priority: 'High' },
  { id: 4, property: 'Woodmead Office Park, Sandton', unit: 'Suite 301', inspector: 'Hetty', scheduledDate: '2026-05-10', type: 'Routine', status: 'In Progress', priority: 'Low' },
  { id: 5, property: 'Bougainville Shopping Centre, Pretoria', unit: 'Parking Area', inspector: 'Hetty', scheduledDate: '2026-05-08', type: 'Quarterly', status: 'Completed', priority: 'Medium', score: 78 },
];

// Lease pipeline stages
const LEASE_STAGES = {
  offer: { label: 'Offer Sent', color: '#B8924A', description: 'Initial offer extended to prospective tenant' },
  draft: { label: 'Drafted', color: '#A86523', description: 'Lease agreement drafted, awaiting internal review' },
  docusign: { label: 'On DocuSign', color: '#7B61FF', description: 'Sent for electronic signature' },
  active: { label: 'Active', color: '#2D6A4F', description: 'Lease is signed and in effect' },
  expiring: { label: 'Expiring Soon', color: '#A86523', description: 'Lease ends within 90 days' },
};
const LEASE_STAGE_ORDER = ['offer', 'draft', 'docusign', 'active', 'expiring'];

const seedLeases = [
  // === COMMERCIAL — Active ===
  { id: 1, type: 'commercial', tenant: 'Mr Price Group', property: 'Protea Shopping Centre', unit: 'Shop 12', startDate: '2024-08-01', endDate: '2027-07-31', monthlyRent: 45000, status: 'Active', pipelineStage: 'active', deposit: 90000, assignedTo: 'Giovani Bonani' },
  { id: 2, type: 'commercial', tenant: 'Standard Bank', property: 'Bougainville Shopping Centre', unit: 'Shop 4', startDate: '2023-04-01', endDate: '2028-03-31', monthlyRent: 28000, status: 'Active', pipelineStage: 'active', deposit: 84000, assignedTo: 'Giovani Bonani' },
  { id: 3, type: 'commercial', tenant: 'Clicks Pharmacy', property: 'Kempton Park Shopping Centre', unit: 'Shop 8', startDate: '2025-02-01', endDate: '2026-06-30', monthlyRent: 52000, status: 'Expiring Soon', pipelineStage: 'expiring', deposit: 104000, assignedTo: 'Giovani Bonani' },
  { id: 4, type: 'commercial', tenant: 'Werksmans Attorneys', property: 'Woodmead Office Park', unit: 'Suite 301', startDate: '2024-11-15', endDate: '2027-11-14', monthlyRent: 85000, status: 'Active', pipelineStage: 'active', deposit: 170000, assignedTo: 'Earle Marks' },
  { id: 5, type: 'commercial', tenant: 'Pick n Pay', property: 'Protea Shopping Centre', unit: 'Anchor Store', startDate: '2023-01-01', endDate: '2028-12-31', monthlyRent: 125000, status: 'Active', pipelineStage: 'active', deposit: 375000, assignedTo: 'Giovani Bonani' },
  { id: 6, type: 'commercial', tenant: 'Vodacom', property: 'Kempton Park Shopping Centre', unit: 'Shop 15', startDate: '2024-03-01', endDate: '2027-02-28', monthlyRent: 22000, status: 'Active', pipelineStage: 'active', deposit: 44000, assignedTo: 'Giovani Bonani' },
  { id: 7, type: 'commercial', tenant: 'Discovery Health', property: 'Woodmead Office Park', unit: 'Suite 405', startDate: '2023-09-01', endDate: '2028-08-31', monthlyRent: 72000, status: 'Active', pipelineStage: 'active', deposit: 144000, assignedTo: 'Earle Marks' },

  // === COMMERCIAL — Pipeline (offer / draft / docusign) ===
  { id: 10, type: 'commercial', tenant: 'Cape Union Mart', property: 'Bougainville Shopping Centre', unit: 'Shop 6', startDate: '2026-07-01', endDate: '2029-06-30', monthlyRent: 35000, status: 'Pending', pipelineStage: 'offer', deposit: 70000, assignedTo: 'Giovani Bonani', stageEntered: '2026-05-08' },
  { id: 11, type: 'commercial', tenant: 'Cotton On', property: 'Protea Shopping Centre', unit: 'Shop 18', startDate: '2026-06-01', endDate: '2029-05-31', monthlyRent: 28000, status: 'Pending', pipelineStage: 'draft', deposit: 56000, assignedTo: 'Giovani Bonani', stageEntered: '2026-05-10' },
  { id: 12, type: 'commercial', tenant: 'KFC (renewal)', property: 'Bougainville Shopping Centre', unit: 'Shop 1', startDate: '2026-06-01', endDate: '2031-05-31', monthlyRent: 42000, status: 'Pending', pipelineStage: 'docusign', deposit: 84000, assignedTo: 'Giovani Bonani', stageEntered: '2026-05-11', docusignEnvelopeId: 'ENV-2026-00142' },
  { id: 13, type: 'commercial', tenant: 'Investec Bank', property: 'Woodmead Office Park', unit: 'Suite 502', startDate: '2026-08-01', endDate: '2031-07-31', monthlyRent: 165000, status: 'Pending', pipelineStage: 'offer', deposit: 495000, assignedTo: 'Earle Marks', stageEntered: '2026-05-09' },
  { id: 14, type: 'commercial', tenant: 'Sasol', property: 'Woodmead Office Park', unit: 'Suite 203-204', startDate: '2026-07-15', endDate: '2031-07-14', monthlyRent: 145000, status: 'Pending', pipelineStage: 'draft', deposit: 435000, assignedTo: 'Earle Marks', stageEntered: '2026-05-07' },

  // === RESIDENTIAL — Active ===
  { id: 20, type: 'residential', tenant: 'Sarah Mthembu', property: 'Riverside Estate', unit: 'Unit 12A', startDate: '2024-09-01', endDate: '2026-08-31', monthlyRent: 15000, status: 'Active', pipelineStage: 'active', deposit: 30000, assignedTo: 'Shaheen Kolia' },
  { id: 21, type: 'residential', tenant: 'David & Emma van der Berg', property: 'Greenstone Hill Estate', unit: 'House 28', startDate: '2025-02-01', endDate: '2027-01-31', monthlyRent: 22000, status: 'Active', pipelineStage: 'active', deposit: 44000, assignedTo: 'Yehuda Noik' },
  { id: 22, type: 'residential', tenant: 'Lerato Molefe', property: 'Bryanston Heights Apartments', unit: 'Apt 6B', startDate: '2024-12-01', endDate: '2026-11-30', monthlyRent: 18000, status: 'Active', pipelineStage: 'active', deposit: 36000, assignedTo: 'Shaheen Kolia' },
  { id: 23, type: 'residential', tenant: 'Ahmed Patel', property: 'Riverside Estate', unit: 'Unit 4C', startDate: '2025-05-01', endDate: '2026-06-30', monthlyRent: 14500, status: 'Expiring Soon', pipelineStage: 'expiring', deposit: 29000, assignedTo: 'Shaheen Kolia' },

  // === RESIDENTIAL — Pipeline ===
  { id: 24, type: 'residential', tenant: 'Lebo Mahlangu', property: 'Riverside Estate', unit: 'Unit 8B', startDate: '2026-06-01', endDate: '2028-05-31', monthlyRent: 12500, status: 'Pending', pipelineStage: 'offer', deposit: 25000, assignedTo: 'Shaheen Kolia', stageEntered: '2026-05-09' },
  { id: 25, type: 'residential', tenant: 'Pieter & Karin Smit', property: 'Greenstone Hill Estate', unit: 'House 31', startDate: '2026-06-15', endDate: '2028-06-14', monthlyRent: 19000, status: 'Pending', pipelineStage: 'draft', deposit: 38000, assignedTo: 'Yehuda Noik', stageEntered: '2026-05-08' },
  { id: 26, type: 'residential', tenant: 'Tumi Sithole', property: 'Bryanston Heights Apartments', unit: 'Apt 4F', startDate: '2026-06-01', endDate: '2028-05-31', monthlyRent: 16500, status: 'Pending', pipelineStage: 'docusign', deposit: 33000, assignedTo: 'Shaheen Kolia', stageEntered: '2026-05-11', docusignEnvelopeId: 'ENV-2026-00148' },
  { id: 27, type: 'residential', tenant: 'Jenna Williams', property: 'Greenstone Hill Estate', unit: 'House 14', startDate: '2026-07-01', endDate: '2028-06-30', monthlyRent: 21500, status: 'Pending', pipelineStage: 'offer', deposit: 43000, assignedTo: 'Yehuda Noik', stageEntered: '2026-05-10' },
];

// Mock Jibble time tracking data (falls back to this when real sync isn't configured)
const seedTimeEntries = [
  { id: 1, employee: 'Giovani Bonani', date: '2026-05-11', clockIn: '07:48', clockOut: '17:12', hours: 9.4, status: 'Approved', location: 'Bougainville Shopping Centre' },
  { id: 2, employee: 'Earle Marks', date: '2026-05-11', clockIn: '08:02', clockOut: '17:05', hours: 9.05, status: 'Approved', location: 'Woodmead Office Park' },
  { id: 3, employee: 'Hetty', date: '2026-05-11', clockIn: '07:55', clockOut: '16:48', hours: 8.88, status: 'Pending', location: 'Field - Kempton Park' },
  { id: 4, employee: 'Shaheen Kolia', date: '2026-05-11', clockIn: '08:20', clockOut: '17:30', hours: 9.17, status: 'Approved', location: 'Riverside Estate, Modderfontein' },
  { id: 5, employee: 'Trinity', date: '2026-05-11', clockIn: '07:30', clockOut: '16:30', hours: 9.0, status: 'Approved', location: 'Head Office' },
  { id: 6, employee: 'Zollie', date: '2026-05-11', clockIn: '08:15', clockOut: '17:02', hours: 8.78, status: 'Approved', location: 'Head Office' },
  { id: 7, employee: 'Yehuda Noik', date: '2026-05-11', clockIn: '07:45', clockOut: '16:55', hours: 9.17, status: 'Approved', location: 'Field - Edenvale' },
  { id: 8, employee: 'Wayne Marks', date: '2026-05-11', clockIn: '08:30', clockOut: '17:15', hours: 8.75, status: 'Approved', location: 'Head Office' },
];

// Debtor / tenant payment tracking data
// ----- Collections workflow -----
// Four collectors, hard-coded. To add/remove/rename, edit this list.
const COLLECTORS = [
  { id: 'peter', name: 'Peter', color: '#0F1E2E' },
  { id: 'hetty', name: 'Hetty', color: '#8B2929' },
  { id: 'francois', name: 'Francois', color: '#2D6A4F' },
  { id: 'dudu', name: 'Dudu', color: '#B8924A' },
];

const DEBTOR_STATUSES = [
  { id: 'NEW', label: 'New', color: '#6B6356' },
  { id: 'IN_PROGRESS', label: 'In Progress', color: '#B8924A' },
  { id: 'PAYMENT_PLAN', label: 'Payment Plan', color: '#0F1E2E' },
  { id: 'ESCALATED', label: 'Escalated', color: '#8B2929' },
  { id: 'DISPUTED', label: 'Disputed', color: '#7c3aed' },
  { id: 'RESOLVED', label: 'Resolved', color: '#2D6A4F' },
  { id: 'WRITTEN_OFF', label: 'Written Off', color: '#374151' },
];

const DEBTOR_ACTIONS = [
  { id: 'CALL', label: 'Call', icon: 'Phone' },
  { id: 'EMAIL', label: 'Email', icon: 'Mail' },
  { id: 'SMS', label: 'SMS' },
  { id: 'PAYMENT_PLAN', label: 'Payment plan' },
  { id: 'NOTE', label: 'Note' },
  { id: 'STATUS_CHANGE', label: 'Status change' },
  { id: 'ASSIGNMENT', label: 'Assignment' },
];

const ACTION_TEMPLATES = {
  CALL: 'Spoke to <name>. <outcome>. Next step: <…>',
  EMAIL: 'Sent email re: <subject>. Awaiting reply.',
  SMS: 'Sent SMS: <message>',
  PAYMENT_PLAN: 'Agreed payment plan: R <amount> by <date>, R <amount> by <date>.',
};

// Default account state when a new account is first seen during an import
const newDebtorAccount = () => ({
  assignedTo: null,        // collector id or null
  status: 'NEW',           // DEBTOR_STATUSES id
  nextFollowUp: null,      // ISO date or null
  pinned: false,
});

// Bad-payer rules. Each rule trips if ANY of its non-null thresholds match.
// Edit these constants to retune. New-shape (MDA) records use these directly.
const BAD_PAYER_RULES = [
  { name: 'Large outstanding balance', minCurrentBalance: 10000, severity: 'BAD' },
  { name: 'Moderate outstanding balance', minCurrentBalance: 2000, severity: 'WARNING' },
  { name: 'Heavy historic arrears', minArrearsBroughtForward: 50000, severity: 'BAD' },
  { name: 'Very low payment ratio', maxPaymentRatio: 0.25, severity: 'BAD' },
  { name: 'Low payment ratio', maxPaymentRatio: 0.5, severity: 'WARNING' },
];

// Payment ratio = |receipts| / (arrears + rent + recoveries + adjustments).
// MDA exports receipts as negative numbers, so abs() before dividing.
const computePaymentRatio = (d) => {
  const arrears = Number(d?.arrearsBroughtForward) || 0;
  const rent = Number(d?.rentLevy) || 0;
  const recoveries = Number(d?.recoveries) || 0;
  const adjustments = Number(d?.adjustments) || 0;
  const receipts = Math.abs(Number(d?.receipts) || 0);
  const totalDue = arrears + rent + recoveries + adjustments;
  if (totalDue <= 0) return 1;
  return receipts / totalDue;
};

// Derive flag from MDA-shape OR legacy-shape debtor records.
const computeDebtorFlag = (d) => {
  if (!d) return 'OK';
  if (d.currentBalance !== undefined || d.arrearsBroughtForward !== undefined) {
    const ratio = computePaymentRatio(d);
    let worst = 'OK';
    for (const r of BAD_PAYER_RULES) {
      let matched = false;
      if (r.minCurrentBalance != null && Number(d.currentBalance || 0) >= r.minCurrentBalance) matched = true;
      if (r.minArrearsBroughtForward != null && Number(d.arrearsBroughtForward || 0) >= r.minArrearsBroughtForward) matched = true;
      if (r.maxPaymentRatio != null && ratio < r.maxPaymentRatio) matched = true;
      if (matched) {
        if (r.severity === 'BAD') worst = 'BAD';
        else if (r.severity === 'WARNING' && worst !== 'BAD') worst = 'WARNING';
      }
    }
    return worst;
  }
  // Legacy: pre-MDA seed shape
  const balance = Number(d.outstandingBalance) || 0;
  const days = Number(d.daysOverdue) || 0;
  const monthly = Number(d.amountDue) || 0;
  const status = (d.status || '').toLowerCase();
  if (balance > 0 && (days >= 60 || status === 'overdue' || (monthly > 0 && balance >= monthly * 2))) return 'BAD';
  if (balance > 0 || status === 'partial' || status === 'unpaid') return 'WARNING';
  return 'OK';
};

// Semicolon-joined names of every rule that tripped (tooltip / banner text).
const computeDebtorReason = (d) => {
  if (!d || (d.currentBalance === undefined && d.arrearsBroughtForward === undefined)) return null;
  const ratio = computePaymentRatio(d);
  const reasons = [];
  for (const r of BAD_PAYER_RULES) {
    let matched = false;
    if (r.minCurrentBalance != null && Number(d.currentBalance || 0) >= r.minCurrentBalance) matched = true;
    if (r.minArrearsBroughtForward != null && Number(d.arrearsBroughtForward || 0) >= r.minArrearsBroughtForward) matched = true;
    if (r.maxPaymentRatio != null && ratio < r.maxPaymentRatio) matched = true;
    if (matched) reasons.push(r.name);
  }
  return reasons.join('; ') || null;
};

// ----- MDA Tenant/Debtor Financial Summary parser (.xls or .xlsx) -----
// Finds header row by scanning for "Arrears B/f". Property heading rows have
// a numeric code in col 2 and the name in col 4. Tenant rows have a unit
// identifier in col 1, account no in col 2, name in col 4. Notes rows attach
// to the most recent tenant.
const parseDebtorFinancial = async (file) => {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('Spreadsheet has no worksheets');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });

  let period = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const t = (rows[i] || []).map(c => String(c ?? '')).join(' ');
    const m = t.match(/for the Period\s+([A-Za-z]+ \d{4})/i);
    if (m) { period = m[1]; break; }
  }

  const labelMap = {
    arrears: ['arrears b/f', 'arrears bf', 'arrears'],
    rentLevy: ['rent / levy', 'rent/levy', 'rent levy', 'rent'],
    recoveries: ['recoveries', 'recovery'],
    adjustments: ['adjustments', 'adjustment'],
    receipts: ['receipts', 'receipt'],
    currentBal: ['current bal', 'current balance', 'balance'],
  };
  let headerRow = -1;
  const colIdx = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = (rows[i] || []).map(c => String(c ?? '').trim().toLowerCase());
    const hasArrears = r.findIndex(c => labelMap.arrears.includes(c));
    if (hasArrears >= 0) {
      headerRow = i;
      Object.entries(labelMap).forEach(([key, cands]) => {
        colIdx[key] = r.findIndex(c => cands.includes(c));
      });
      break;
    }
  }
  if (headerRow === -1) throw new Error('Could not find header row (looking for "Arrears B/f")');

  const num = (idx, r) => {
    if (idx < 0) return 0;
    const v = r[idx];
    if (v === null || v === undefined || v === '') return 0;
    const cleaned = String(v).replace(/[R\s,]/g, '').replace(/[()]/g, '-');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  };

  const out = [];
  let curProperty = { code: '', name: '' };
  let lastTenant = null;
  let grandTotals = null;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const c1 = String(r[1] ?? '').trim();
    const c2 = String(r[2] ?? '').trim();
    const c4 = String(r[4] ?? '').trim();
    const c5 = String(r[5] ?? '').trim();
    const rowText = r.map(c => String(c ?? '')).join(' ');

    if (rowText.includes('Software supplied by') || /^Total Due\s*=/.test(rowText.trim())) break;

    if (c5 === 'Grand Totals' || rowText.includes('Grand Totals')) {
      grandTotals = {
        arrearsBroughtForward: num(colIdx.arrears, r),
        rentLevy: num(colIdx.rentLevy, r),
        recoveries: num(colIdx.recoveries, r),
        adjustments: num(colIdx.adjustments, r),
        receipts: num(colIdx.receipts, r),
        currentBalance: num(colIdx.currentBal, r),
      };
      continue;
    }
    if (c4.startsWith('Current/Total Due') || c4.startsWith('Current/New Billings')) continue;
    if (c2 === 'Notes:' && lastTenant) {
      lastTenant.notes = c5 || rowText.trim();
      continue;
    }
    if (!c1 && /^\d+$/.test(c2) && c4) {
      curProperty = { code: c2, name: c4 };
      lastTenant = null;
      continue;
    }
    if (c1 && /^\d+$/.test(c2) && c4) {
      const arrears = num(colIdx.arrears, r);
      const rentLevy = num(colIdx.rentLevy, r);
      const recoveries = num(colIdx.recoveries, r);
      const adjustments = num(colIdx.adjustments, r);
      const receipts = num(colIdx.receipts, r);
      const currentBalance = num(colIdx.currentBal, r);
      const row = {
        id: `d-${c2}-${out.length}`,
        accountNumber: c2,
        tenantName: c4,
        propertyCode: curProperty.code,
        propertyName: curProperty.name,
        unitId: c1,
        arrearsBroughtForward: arrears,
        rentLevy, recoveries, adjustments, receipts, currentBalance,
        notes: null,
        paymentRatio: null,
        // Legacy aliases for the existing UI
        tenant: c4,
        property: curProperty.name,
        unit: c1,
        amountDue: rentLevy,
        outstandingBalance: currentBalance,
        status: currentBalance > 0 ? 'Unpaid' : 'Paid',
        lastPaymentDate: '',
        daysOverdue: 0,
      };
      row.paymentRatio = computePaymentRatio(row);
      out.push(row);
      lastTenant = row;
    }
  }
  return { period, rows: out, grandTotals };
};

// ----- MDA Tenancy Schedule parser (.xls or .xlsx) -----
const parseTenancySchedule = async (file) => {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('Spreadsheet has no worksheets');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });

  let asAtDate = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const t = (rows[i] || []).map(c => String(c ?? '')).join(' ');
    const m = t.match(/as at\s+([A-Za-z0-9 ,\-/]+\d{4})/i);
    if (m) { asAtDate = m[1].trim(); break; }
  }

  const labelMap = {
    area: ['area'],
    tenant: ['tenant'],
    starts: ['starts', 'commencement'],
    expires: ['expires', 'expiry'],
    review: ['review'],
    monthsOption: ['months option', 'option'],
    currentRent: ['current rent'],
    rentRate: ['rent rate'],
    rentEsc: ['rent esc%', 'rent escalation', 'esc%'],
    otherChargings: ['other chargings'],
    description: ['description'],
    amount: ['amount'],
    rate: ['rate'],
    grossIncome: ['gross income'],
    grossRate: ['gross rate'],
    marketRate: ['market rate'],
    marketEsc: ['market esc%', 'market escalation'],
  };
  let headerRow = -1;
  const col = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = (rows[i] || []).map(c => String(c ?? '').trim().toLowerCase());
    if (r.includes('tenant') && r.findIndex(c => c === 'current rent') >= 0) {
      headerRow = i;
      Object.entries(labelMap).forEach(([key, cands]) => {
        col[key] = r.findIndex(c => cands.includes(c));
      });
      break;
    }
  }
  if (headerRow === -1) throw new Error('Could not find header row (need "Tenant" + "Current Rent")');

  const numAt = (idx, r) => {
    if (idx < 0) return null;
    const v = r[idx];
    if (v === null || v === undefined || v === '') return null;
    const cleaned = String(v).replace(/[R\s,]/g, '').replace(/[()]/g, '-').replace(/%/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  };
  const dateAt = (idx, r) => {
    if (idx < 0) return null;
    const v = r[idx];
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().split('T')[0];
    return String(v).trim();
  };
  const heading = /^(.+?)\s*\((\d+)\)\s*$/;

  const properties = [];
  let curProperty = null;
  let lastTenant = null;
  let grandTotals = null;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const c1 = String(r[1] ?? '').trim();
    const c2 = String(r[2] ?? '').trim();
    const c3 = String(r[3] ?? '').trim();
    const tenantCell = String(r[col.tenant] ?? '').trim();
    const otherChargingCell = String(r[col.otherChargings] ?? '').trim();
    const descCell = String(r[col.description] ?? '').trim();
    const rowText = r.map(c => String(c ?? '')).join(' ');

    if (/Software Supplied by/i.test(rowText)) break;

    if (c3 === 'Grand Totals' || rowText.includes('Grand Totals')) {
      grandTotals = { area: numAt(col.area, r), income: numAt(col.currentRent, r), grossIncome: numAt(col.grossIncome, r) };
      continue;
    }

    if (curProperty) {
      if (/^property totals$/i.test(c1)) {
        curProperty.totalArea = numAt(col.area, r);
        curProperty.totalRent = numAt(col.currentRent, r);
        continue;
      }
      if (/^total vacancy/i.test(c1)) { curProperty.vacancyPercent = numAt(col.area, r); continue; }
      if (/^total occupancy/i.test(c1)) { curProperty.occupancyPercent = numAt(col.area, r); continue; }
    }

    const propMatch = c1.match(heading);
    if (propMatch && !tenantCell) {
      curProperty = {
        propertyCode: propMatch[2],
        propertyName: propMatch[1].trim(),
        totalArea: null, totalRent: null, occupancyPercent: null, vacancyPercent: null,
        tenants: [],
      };
      properties.push(curProperty);
      lastTenant = null;
      continue;
    }

    const tenMatch = tenantCell.match(heading);
    if (tenMatch && curProperty) {
      const t = {
        unitId: c2 || null,
        accountNumber: tenMatch[2],
        tenantName: tenMatch[1].trim(),
        area: numAt(col.area, r),
        leaseStart: dateAt(col.starts, r),
        leaseExpiry: dateAt(col.expires, r),
        reviewDate: dateAt(col.review, r),
        monthsOption: numAt(col.monthsOption, r),
        currentRent: numAt(col.currentRent, r),
        rentRate: numAt(col.rentRate, r),
        escalation: numAt(col.rentEsc, r),
        otherChargings: [],
        grossIncome: numAt(col.grossIncome, r),
        grossRate: numAt(col.grossRate, r),
        marketRate: numAt(col.marketRate, r),
        marketEscalation: numAt(col.marketEsc, r),
      };
      curProperty.tenants.push(t);
      lastTenant = t;
      continue;
    }

    if (otherChargingCell && lastTenant) {
      lastTenant.otherChargings.push({
        type: otherChargingCell,
        description: descCell,
        amount: numAt(col.amount, r),
        rate: numAt(col.rate, r),
      });
    }
  }

  return { asAtDate, properties, grandTotals };
};

// Find any debtor whose tenant name fuzzy-matches the supplied company name.
// Returns null if no match, else the first matching debtor.
const findDebtorByTenant = (debtors, companyName) => {
  const q = (companyName || '').trim().toLowerCase();
  if (!q) return null;
  // Match if either side substring-contains the other (handles abbreviations
  // like "Mr Price" matching "Mr Price Group", and uppercase vs lowercase).
  return debtors.find(d => {
    const t = (d.tenant || d.tenantName || '').trim().toLowerCase();
    if (!t) return false;
    return t === q || t.includes(q) || q.includes(t);
  }) || null;
};

const seedDebtors = [
  { id: 1, tenant: 'Mr Price Group', property: 'Protea Shopping Centre', unit: 'Shop 12', amountDue: 45000, outstandingBalance: 0, status: 'Paid', lastPaymentDate: '2026-05-01', daysOverdue: 0 },
  { id: 2, tenant: 'Standard Bank', property: 'Bougainville Shopping Centre', unit: 'Shop 4', amountDue: 28000, outstandingBalance: 0, status: 'Paid', lastPaymentDate: '2026-05-02', daysOverdue: 0 },
  { id: 3, tenant: 'Clicks Pharmacy', property: 'Kempton Park Shopping Centre', unit: 'Shop 8', amountDue: 52000, outstandingBalance: 52000, status: 'Unpaid', lastPaymentDate: '2026-04-03', daysOverdue: 8 },
  { id: 4, tenant: 'Werksmans Attorneys', property: 'Woodmead Office Park', unit: 'Suite 301', amountDue: 85000, outstandingBalance: 0, status: 'Paid', lastPaymentDate: '2026-05-01', daysOverdue: 0 },
  { id: 5, tenant: 'KFC', property: 'Bougainville Shopping Centre', unit: 'Shop 1', amountDue: 38000, outstandingBalance: 76000, status: 'Overdue', lastPaymentDate: '2026-02-15', daysOverdue: 86 },
  { id: 6, tenant: 'Pick n Pay', property: 'Protea Shopping Centre', unit: 'Anchor Store', amountDue: 125000, outstandingBalance: 0, status: 'Paid', lastPaymentDate: '2026-04-30', daysOverdue: 0 },
  { id: 7, tenant: 'Vodacom', property: 'Kempton Park Shopping Centre', unit: 'Shop 15', amountDue: 22000, outstandingBalance: 12000, status: 'Partial', lastPaymentDate: '2026-05-05', daysOverdue: 6 },
  { id: 8, tenant: 'Discovery Health', property: 'Woodmead Office Park', unit: 'Suite 405', amountDue: 72000, outstandingBalance: 0, status: 'Paid', lastPaymentDate: '2026-05-01', daysOverdue: 0 },
];

const seedMaintenance = [
  { id: 1, property: 'Bougainville Shopping Centre', unit: 'Shop 1', issueType: 'Plumbing', description: 'Leaking pipe in kitchen area causing water damage', priority: 'High', status: 'Open', reportedBy: 'KFC Manager', reportedDate: '2026-05-09', assignedTo: '', completedDate: '' },
  { id: 2, property: 'Woodmead Office Park', unit: 'Suite 301', issueType: 'Electrical', description: 'Boardroom lights flickering intermittently', priority: 'Medium', status: 'In Progress', reportedBy: 'Werksmans Reception', reportedDate: '2026-05-08', assignedTo: 'Earle Marks', completedDate: '' },
  { id: 3, property: 'Protea Shopping Centre', unit: 'Common Areas', issueType: 'HVAC', description: 'Air conditioning not cooling in food court', priority: 'High', status: 'In Progress', reportedBy: 'Centre Manager', reportedDate: '2026-05-07', assignedTo: 'Giovani Bonani', completedDate: '' },
  { id: 4, property: 'Kempton Park Shopping Centre', unit: 'Shop 15', issueType: 'Security', description: 'Faulty access card reader at staff entrance', priority: 'Medium', status: 'Completed', reportedBy: 'Vodacom Store Manager', reportedDate: '2026-05-03', assignedTo: 'Giovani Bonani', completedDate: '2026-05-06' },
  { id: 5, property: 'Woodmead Office Park', unit: 'Parking Lot', issueType: 'General', description: 'Pothole near visitor parking entrance', priority: 'Low', status: 'Open', reportedBy: 'Building Security', reportedDate: '2026-05-10', assignedTo: '', completedDate: '' },
];

const defaultCompanyProfile = {
  name: 'Exceed Properties (Pty) Ltd',
  tradingName: 'Exceed Properties',
  registration: '2018/123456/07',
  vatNumber: '4567891234',
  address: '1st Floor, Woodmead Office Park, Sandton, 2191',
  phone: '+27 11 555 0100',
  email: 'info@exceedproperties.co.za',
  website: 'www.exceedproperties.co.za',
};

const defaultDepartments = Object.keys(DEPARTMENTS_CONFIG);

const defaultNotificationPrefs = {
  leaseExpiring: { email: true, sms: false, inApp: true },
  paymentOverdue: { email: true, sms: true, inApp: true },
  inspectionScheduled: { email: true, sms: false, inApp: true },
  maintenanceRequest: { email: true, sms: false, inApp: true },
  employeeFlagged: { email: false, sms: false, inApp: true },
  weeklyReport: { email: true, sms: false, inApp: false },
};

const defaultIntegrations = {
  jibble: {
    connected: false,
    apiBaseUrl: 'https://workspace.prod.jibble.io/v1',
    identityUrl: 'https://identity.prod.jibble.io/connect/token',
    authMethod: 'client_credentials', // 'pat' | 'client_credentials'
    personalAccessToken: '',
    clientId: '',
    clientSecret: '',
    cachedAccessToken: '',
    cachedAccessTokenExpiry: null,
    organizationId: '',
    syncFrequency: 'every-15-min',
    autoApprove: false,
    lastSync: null,
    lastSyncStatus: null,
    lastSyncError: null,
  },
  docusign: {
    connected: false,
    environment: 'demo', // 'demo' or 'prod'
    integrationKey: '',  // OAuth client_id
    clientSecret: '',    // OAuth client_secret
    redirectUri: '',     // populated from window.location on first render
    accountId: '',       // auto-detected via /userinfo after OAuth
    baseUri: '',         // auto-detected via /userinfo after OAuth
    userId: '',          // user GUID returned by /userinfo
    userEmail: '',
    cachedAccessToken: '',
    cachedAccessTokenExpiry: null,
    cachedRefreshToken: '',
    lastSync: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastEnvelopeId: '',
  },
  emailProvider: { provider: 'SendGrid', connected: true, fromAddress: 'noreply@exceedproperties.co.za' },
  smsProvider: { provider: 'Twilio', connected: false, fromNumber: '' },
  anthropic: { connected: false, apiKey: '', model: 'claude-haiku-4-5-20251001', lastTested: null, lastError: null },
  propertyInspect: {
    connected: false,
    baseUrl: 'https://api.propertyinspect.com',
    tokenUrl: 'https://api.propertyinspect.com/oauth/token',
    authorizeUrl: 'https://api.propertyinspect.com/oauth/authorize',
    redirectUri: '',
    clientId: '',
    clientSecret: '',
    cachedAccessToken: '',
    cachedAccessTokenExpiry: null,
    cachedRefreshToken: '',
    lastSync: null,
    lastSyncStatus: null,
    lastSyncError: null,
    importedInspections: [],
    importedCount: 0,
  },
};

const defaultSecurity = {
  twoFactorRequired: true,
  sessionTimeoutMinutes: 60,
  passwordMinLength: 12,
  passwordRequireSpecial: true,
  loginAlertEmails: true,
};

const seedNotifications = [
  { id: 1, type: 'overdue', title: 'Payment Overdue', message: 'KFC at Bougainville is 86 days overdue (R 76,000)', time: '15 min ago', read: false, severity: 'high' },
  { id: 2, type: 'inspection', title: 'Inspection Completed', message: 'Hetty scored Protea Shopping Centre 92/100', time: '2 hours ago', read: false, severity: 'low' },
  { id: 3, type: 'lease', title: 'Lease Expiring Soon', message: 'KFC lease at Bougainville expires May 31, 2026', time: '5 hours ago', read: false, severity: 'medium' },
  { id: 4, type: 'maintenance', title: 'New Maintenance Request', message: 'Plumbing issue reported at Bougainville Shop 1', time: '1 day ago', read: true, severity: 'high' },
  { id: 5, type: 'time', title: 'Late Clock-in Flagged', message: 'Hetty clocked in at 08:15 (15 min late)', time: '2 days ago', read: true, severity: 'medium' },
];

// On Desk — what each employee is currently working on
const nowMinusHours = (h) => new Date(Date.now() - h * 3600000).toISOString();
const nowMinusDays = (d) => new Date(Date.now() - d * 86400000).toISOString();
const seedDeskStatuses = [
  { id: 1, employeeId: 0, status: 'working', task: 'Reviewing Q2 portfolio performance and signing off on KFC lease renewal', location: 'Head Office', startedAt: nowMinusHours(1.5), expectedDuration: '2 hours', notes: '' },
  { id: 2, employeeId: 1, status: 'travelling', task: 'En route to Protea Shopping Centre for HVAC contractor walkthrough', location: 'Travelling to Soweto', startedAt: nowMinusHours(0.5), expectedDuration: '45 min', notes: 'Meeting with Bidvest Steiner at 10:30' },
  { id: 3, employeeId: 2, status: 'in_meeting', task: 'Lease negotiation with Investec for 600m² at Woodmead Suite 502', location: 'Woodmead Office Park', startedAt: nowMinusHours(0.75), expectedDuration: '1.5 hours', notes: 'They want a 5% reduction — counter at 2%' },
  { id: 4, employeeId: 3, status: 'working', task: 'Quarterly inspection at Kempton Park Shopping Centre, Shop 8 (Clicks)', location: 'Kempton Park Shopping Centre', startedAt: nowMinusHours(2), expectedDuration: '3 hours', notes: '' },
  { id: 5, employeeId: 4, status: 'working', task: 'Following up with KFC accounts payable re: 86-day overdue R76,000', location: 'Head Office', startedAt: nowMinusHours(0.25), expectedDuration: '1 hour', notes: 'Spoke to Karen at HO, escalating to franchise director' },
  { id: 6, employeeId: 5, status: 'working', task: 'Drafting demand letters for 60+ day overdue residential tenants', location: 'Head Office', startedAt: nowMinusHours(1), expectedDuration: '2 hours', notes: '' },
  { id: 7, employeeId: 6, status: 'in_meeting', task: 'Showing 2-bedroom apartment at Bryanston Heights to prospective tenant', location: 'Bryanston Heights Apartments', startedAt: nowMinusHours(0.5), expectedDuration: '1 hour', notes: 'Couple relocating from Cape Town' },
  { id: 8, employeeId: 7, status: 'on_break', task: 'Lunch break — back at 14:00', location: 'Head Office', startedAt: nowMinusHours(0.5), expectedDuration: '1 hour', notes: '' },
];

// ============================================================
// ACTIVITY LOG — what each person has done over the past month
// ============================================================
const ACTIVITY_TYPES = {
  inspection_completed: { label: 'Inspection', icon: ClipboardCheck, color: '#2D6A4F' },
  inspection_scheduled: { label: 'Inspection Scheduled', icon: Calendar, color: '#1B2D42' },
  lease_offered: { label: 'Lease Offer', icon: FileText, color: '#B8924A' },
  lease_drafted: { label: 'Lease Drafted', icon: FileSignature, color: '#A86523' },
  lease_sent_docusign: { label: 'Sent to DocuSign', icon: ExternalLink, color: '#7B61FF' },
  lease_signed: { label: 'Lease Signed', icon: CheckCircle2, color: '#2D6A4F' },
  viewing_conducted: { label: 'Property Viewing', icon: Home, color: '#0F1E2E' },
  payment_collected: { label: 'Payment Recorded', icon: DollarSign, color: '#2D6A4F' },
  collection_call: { label: 'Collection Call', icon: Phone, color: '#A86523' },
  demand_letter_sent: { label: 'Demand Letter', icon: Mail, color: '#8B2929' },
  maintenance_scheduled: { label: 'Maintenance Logged', icon: Wrench, color: '#A86523' },
  maintenance_completed: { label: 'Maintenance Done', icon: CheckCircle2, color: '#2D6A4F' },
  meeting: { label: 'Meeting', icon: Users, color: '#0F1E2E' },
  report_generated: { label: 'Report Generated', icon: BarChart3, color: '#B8924A' },
  tenant_communication: { label: 'Tenant Contact', icon: Phone, color: '#0F1E2E' },
  contract_review: { label: 'Contract Review', icon: FileText, color: '#1B2D42' },
};

// Generate roughly the past 30 days of activity per employee.
// Real-world this would come from your database / Jibble / DocuSign webhooks.
const seedActivityLog = [
  // Wayne Marks (Director) - oversight, meetings
  { id: 1, employeeId: 0, type: 'meeting', description: 'Quarterly board meeting with shareholders', date: nowMinusDays(28), durationMinutes: 180 },
  { id: 2, employeeId: 0, type: 'meeting', description: 'Reviewed Investec lease offer with Earle Marks', date: nowMinusDays(25), durationMinutes: 45 },
  { id: 3, employeeId: 0, type: 'report_generated', description: 'Generated April portfolio performance report', date: nowMinusDays(22), durationMinutes: 60 },
  { id: 4, employeeId: 0, type: 'meeting', description: 'Strategy session with Trinity re: outstanding debtor accounts', date: nowMinusDays(18), durationMinutes: 90 },
  { id: 5, employeeId: 0, type: 'meeting', description: 'Visited Bougainville Shopping Centre with Giovani Bonani', date: nowMinusDays(14), durationMinutes: 120 },
  { id: 6, employeeId: 0, type: 'contract_review', description: 'Reviewed and approved Pick n Pay lease renewal terms', date: nowMinusDays(10), durationMinutes: 75 },
  { id: 7, employeeId: 0, type: 'meeting', description: 'Met with Shaheen Kolia about Riverside Estate expansion', date: nowMinusDays(6), durationMinutes: 60 },
  { id: 8, employeeId: 0, type: 'report_generated', description: 'Reviewed weekly performance dashboard', date: nowMinusDays(2), durationMinutes: 30 },
  { id: 9, employeeId: 0, type: 'meeting', description: 'KFC lease renewal sign-off review', date: nowMinusHours(2), durationMinutes: 45 },

  // Giovani Bonani (Retail Leasing Lead)
  { id: 10, employeeId: 1, type: 'viewing_conducted', description: 'Showed Shop 6 at Bougainville to Cape Union Mart team', date: nowMinusDays(26), durationMinutes: 90 },
  { id: 11, employeeId: 1, type: 'lease_offered', description: 'Sent lease offer to Cape Union Mart for Bougainville Shop 6', date: nowMinusDays(20), durationMinutes: 60 },
  { id: 12, employeeId: 1, type: 'meeting', description: 'Bidvest Steiner HVAC contractor briefing for Protea', date: nowMinusDays(17), durationMinutes: 120 },
  { id: 13, employeeId: 1, type: 'lease_drafted', description: 'Drafted Cotton On lease agreement for Protea Shop 18', date: nowMinusDays(15), durationMinutes: 180 },
  { id: 14, employeeId: 1, type: 'maintenance_scheduled', description: 'Logged HVAC service request for Protea food court', date: nowMinusDays(12), durationMinutes: 30 },
  { id: 15, employeeId: 1, type: 'viewing_conducted', description: 'Walkthrough with KFC franchise rep for renewal', date: nowMinusDays(9), durationMinutes: 75 },
  { id: 16, employeeId: 1, type: 'lease_drafted', description: 'Drafted KFC lease renewal at Bougainville', date: nowMinusDays(7), durationMinutes: 240 },
  { id: 17, employeeId: 1, type: 'lease_sent_docusign', description: 'Sent KFC renewal to DocuSign (ENV-2026-00142)', date: nowMinusDays(1), durationMinutes: 20 },
  { id: 18, employeeId: 1, type: 'tenant_communication', description: 'Call with Vodacom store manager re: parking allocation', date: nowMinusDays(4), durationMinutes: 25 },

  // Earle Marks (Office Leasing Lead)
  { id: 19, employeeId: 2, type: 'meeting', description: 'Tour of Woodmead Suite 502 with Investec property team', date: nowMinusDays(24), durationMinutes: 90 },
  { id: 20, employeeId: 2, type: 'lease_offered', description: 'Issued lease offer to Investec for Suite 502', date: nowMinusDays(21), durationMinutes: 75 },
  { id: 21, employeeId: 2, type: 'viewing_conducted', description: 'Showed Sasol team Suites 203-204 at Woodmead', date: nowMinusDays(18), durationMinutes: 105 },
  { id: 22, employeeId: 2, type: 'lease_drafted', description: 'Drafted Sasol lease for Woodmead Suites 203-204', date: nowMinusDays(14), durationMinutes: 240 },
  { id: 23, employeeId: 2, type: 'contract_review', description: 'Reviewed Werksmans renewal terms with their legal team', date: nowMinusDays(11), durationMinutes: 90 },
  { id: 24, employeeId: 2, type: 'maintenance_scheduled', description: 'Booked electrician for Suite 301 lighting issue', date: nowMinusDays(8), durationMinutes: 20 },
  { id: 25, employeeId: 2, type: 'tenant_communication', description: 'Quarterly check-in call with Discovery Health facilities', date: nowMinusDays(5), durationMinutes: 45 },
  { id: 26, employeeId: 2, type: 'meeting', description: 'Investec negotiation — discussed counter-offer at 2%', date: nowMinusHours(1), durationMinutes: 90 },

  // Hetty (Property Inspector)
  { id: 27, employeeId: 3, type: 'inspection_completed', description: 'Quarterly inspection at Protea Shopping Centre — scored 92/100', date: nowMinusDays(27), durationMinutes: 240 },
  { id: 28, employeeId: 3, type: 'inspection_completed', description: 'Move-out inspection at Bougainville Shop 12', date: nowMinusDays(24), durationMinutes: 180 },
  { id: 29, employeeId: 3, type: 'inspection_completed', description: 'Annual inspection at Woodmead Suite 405 — scored 88/100', date: nowMinusDays(20), durationMinutes: 150 },
  { id: 30, employeeId: 3, type: 'inspection_completed', description: 'Quarterly inspection at Bougainville Parking Area — scored 78/100', date: nowMinusDays(16), durationMinutes: 90 },
  { id: 31, employeeId: 3, type: 'inspection_scheduled', description: 'Scheduled 12 inspections for May', date: nowMinusDays(13), durationMinutes: 60 },
  { id: 32, employeeId: 3, type: 'inspection_completed', description: 'Move-in inspection at Kempton Park Shop 8', date: nowMinusDays(10), durationMinutes: 120 },
  { id: 33, employeeId: 3, type: 'inspection_completed', description: 'Quarterly inspection at Kempton Park Common Areas', date: nowMinusDays(7), durationMinutes: 180 },
  { id: 34, employeeId: 3, type: 'report_generated', description: 'Compiled monthly inspection report for management', date: nowMinusDays(4), durationMinutes: 90 },
  { id: 35, employeeId: 3, type: 'inspection_completed', description: 'Routine inspection at Woodmead Suite 301 — flagged 3 issues', date: nowMinusHours(4), durationMinutes: 120 },

  // Trinity (Commercial Debtors Lead)
  { id: 36, employeeId: 4, type: 'collection_call', description: 'Called KFC accounts payable re: 86-day overdue R76,000', date: nowMinusDays(28), durationMinutes: 30 },
  { id: 37, employeeId: 4, type: 'collection_call', description: 'Followed up with Clicks Pharmacy re: May payment', date: nowMinusDays(25), durationMinutes: 20 },
  { id: 38, employeeId: 4, type: 'demand_letter_sent', description: 'Sent formal demand letter to KFC franchise director', date: nowMinusDays(22), durationMinutes: 45 },
  { id: 39, employeeId: 4, type: 'payment_collected', description: 'Recorded payment of R45,000 from Mr Price Group', date: nowMinusDays(19), durationMinutes: 15 },
  { id: 40, employeeId: 4, type: 'payment_collected', description: 'Recorded payment of R125,000 from Pick n Pay', date: nowMinusDays(15), durationMinutes: 15 },
  { id: 41, employeeId: 4, type: 'collection_call', description: 'Negotiated payment plan with Vodacom — R10k upfront', date: nowMinusDays(12), durationMinutes: 50 },
  { id: 42, employeeId: 4, type: 'payment_collected', description: 'Recorded partial payment of R10,000 from Vodacom', date: nowMinusDays(7), durationMinutes: 10 },
  { id: 43, employeeId: 4, type: 'report_generated', description: 'Compiled commercial aging report for April', date: nowMinusDays(5), durationMinutes: 120 },
  { id: 44, employeeId: 4, type: 'collection_call', description: 'Escalation call with KFC HO accounts director', date: nowMinusHours(0.5), durationMinutes: 35 },

  // Zollie (Residential Debt Recovery Lead)
  { id: 45, employeeId: 5, type: 'collection_call', description: 'Called Ahmed Patel re: April rent arrears', date: nowMinusDays(26), durationMinutes: 15 },
  { id: 46, employeeId: 5, type: 'payment_collected', description: 'Recorded payment of R14,500 from Ahmed Patel', date: nowMinusDays(24), durationMinutes: 10 },
  { id: 47, employeeId: 5, type: 'collection_call', description: 'Follow-up with 3 Bryanston tenants on May rent', date: nowMinusDays(20), durationMinutes: 45 },
  { id: 48, employeeId: 5, type: 'demand_letter_sent', description: 'Sent demand letters to 2 Greenstone Hill tenants', date: nowMinusDays(15), durationMinutes: 60 },
  { id: 49, employeeId: 5, type: 'payment_collected', description: 'Recorded payment from David & Emma van der Berg', date: nowMinusDays(12), durationMinutes: 10 },
  { id: 50, employeeId: 5, type: 'tenant_communication', description: 'Negotiated payment plan with 2 Riverside tenants', date: nowMinusDays(8), durationMinutes: 60 },
  { id: 51, employeeId: 5, type: 'report_generated', description: 'Compiled residential aging report for April', date: nowMinusDays(4), durationMinutes: 90 },
  { id: 52, employeeId: 5, type: 'demand_letter_sent', description: 'Drafted demand letters for 60+ day overdue residential tenants', date: nowMinusHours(1), durationMinutes: 90 },

  // Shaheen Kolia (Apartments Lead)
  { id: 53, employeeId: 6, type: 'viewing_conducted', description: 'Showed Apt 4F at Bryanston Heights to Tumi Sithole', date: nowMinusDays(25), durationMinutes: 60 },
  { id: 54, employeeId: 6, type: 'lease_offered', description: 'Offered Apt 4F lease to Tumi Sithole', date: nowMinusDays(22), durationMinutes: 45 },
  { id: 55, employeeId: 6, type: 'viewing_conducted', description: 'Multiple viewings at Riverside Estate Unit 8B', date: nowMinusDays(19), durationMinutes: 180 },
  { id: 56, employeeId: 6, type: 'lease_offered', description: 'Offered Unit 8B at Riverside to Lebo Mahlangu', date: nowMinusDays(15), durationMinutes: 40 },
  { id: 57, employeeId: 6, type: 'lease_drafted', description: 'Drafted Tumi Sithole apartment lease', date: nowMinusDays(13), durationMinutes: 120 },
  { id: 58, employeeId: 6, type: 'meeting', description: 'Quarterly review with Riverside body corporate', date: nowMinusDays(9), durationMinutes: 90 },
  { id: 59, employeeId: 6, type: 'tenant_communication', description: 'Resolved noise complaint at Bryanston Heights Apt 6B', date: nowMinusDays(6), durationMinutes: 30 },
  { id: 60, employeeId: 6, type: 'lease_sent_docusign', description: 'Sent Tumi Sithole lease to DocuSign (ENV-2026-00148)', date: nowMinusDays(1), durationMinutes: 20 },
  { id: 61, employeeId: 6, type: 'viewing_conducted', description: 'Showed 2BR apartment to relocating Cape Town couple', date: nowMinusHours(0.5), durationMinutes: 60 },

  // Yehuda Noik (Estates Lead)
  { id: 62, employeeId: 7, type: 'viewing_conducted', description: 'Showed House 14 at Greenstone Hill to Jenna Williams', date: nowMinusDays(27), durationMinutes: 75 },
  { id: 63, employeeId: 7, type: 'viewing_conducted', description: 'Open day at Greenstone Hill — 8 prospective tenants', date: nowMinusDays(23), durationMinutes: 300 },
  { id: 64, employeeId: 7, type: 'lease_offered', description: 'Offered House 31 to Pieter & Karin Smit', date: nowMinusDays(18), durationMinutes: 50 },
  { id: 65, employeeId: 7, type: 'lease_drafted', description: 'Drafted Smit family estate home lease', date: nowMinusDays(14), durationMinutes: 150 },
  { id: 66, employeeId: 7, type: 'lease_offered', description: 'Offered House 14 to Jenna Williams', date: nowMinusDays(10), durationMinutes: 40 },
  { id: 67, employeeId: 7, type: 'tenant_communication', description: 'Pool maintenance scheduling with 5 Greenstone Hill households', date: nowMinusDays(7), durationMinutes: 60 },
  { id: 68, employeeId: 7, type: 'meeting', description: 'Met with HOA committee re: estate security upgrade', date: nowMinusDays(3), durationMinutes: 120 },
  { id: 69, employeeId: 7, type: 'maintenance_scheduled', description: 'Logged 3 maintenance requests across the estate', date: nowMinusHours(2.5), durationMinutes: 45 },
];

// ============================================================
// SHARED UI COMPONENTS
// ============================================================
const Card = ({ children, className = '', style = {} }) => (
  <div
    className={`rounded-lg ${className}`}
    style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, ...style }}
  >
    {children}
  </div>
);

const StatusBadge = ({ status }) => {
  const colors = {
    Active: { bg: brand.successLight, text: brand.success },
    Completed: { bg: brand.successLight, text: brand.success },
    Approved: { bg: brand.successLight, text: brand.success },
    Scheduled: { bg: '#E8EEF5', text: brand.navy },
    'In Progress': { bg: brand.goldPale, text: brand.warning },
    Pending: { bg: brand.goldPale, text: brand.warning },
    'On Leave': { bg: brand.goldPale, text: brand.warning },
    'Expiring Soon': { bg: brand.warningLight, text: brand.warning },
    'Renovation': { bg: brand.warningLight, text: brand.warning },
    Flagged: { bg: brand.dangerLight, text: brand.danger },
    Inactive: { bg: brand.dangerLight, text: brand.danger },
    High: { bg: brand.dangerLight, text: brand.danger },
    Medium: { bg: brand.goldPale, text: brand.warning },
    Low: { bg: '#E8EEF5', text: brand.navy },
    Paid: { bg: brand.successLight, text: brand.success },
    Unpaid: { bg: brand.warningLight, text: brand.warning },
    Overdue: { bg: brand.dangerLight, text: brand.danger },
    Partial: { bg: brand.goldPale, text: brand.warning },
  };
  const c = colors[status] || { bg: brand.border, text: brand.text };
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 text-xs font-medium tracking-wide rounded"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {status}
    </span>
  );
};

const Button = ({ children, variant = 'primary', size = 'md', icon: Icon, onClick, type = 'button', disabled }) => {
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-sm',
  };
  const variants = {
    primary: { backgroundColor: brand.navy, color: '#fff', border: `1px solid ${brand.navy}` },
    gold: { backgroundColor: brand.gold, color: '#fff', border: `1px solid ${brand.gold}` },
    ghost: { backgroundColor: 'transparent', color: brand.text, border: `1px solid ${brand.border}` },
    danger: { backgroundColor: '#fff', color: brand.danger, border: `1px solid ${brand.danger}` },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${sizes[size]} font-medium tracking-wide transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2 rounded`}
      style={variants[variant]}
    >
      {Icon && <Icon size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
};

const Field = ({ label, error, required, children, hint }) => (
  <div className="mb-4">
    <label className="block text-xs font-medium tracking-wider uppercase mb-1.5" style={{ color: brand.textMuted }}>
      {label} {required && <span style={{ color: brand.danger }}>*</span>}
    </label>
    {children}
    {hint && !error && (
      <p className="mt-1 text-xs" style={{ color: brand.textMuted }}>{hint}</p>
    )}
    {error && (
      <p className="mt-1 text-xs flex items-center gap-1" style={{ color: brand.danger }}>
        <AlertCircle size={12} /> {error}
      </p>
    )}
  </div>
);

const Input = ({ error, ...props }) => (
  <input
    {...props}
    className="w-full px-3 py-2 text-sm rounded outline-none transition-all"
    style={{
      backgroundColor: '#fff',
      border: `1px solid ${error ? brand.danger : brand.border}`,
      color: brand.text,
    }}
    onFocus={(e) => { if (!error) e.target.style.borderColor = brand.gold; }}
    onBlur={(e) => { e.target.style.borderColor = error ? brand.danger : brand.border; }}
  />
);

const Select = ({ error, children, ...props }) => (
  <select
    {...props}
    className="w-full px-3 py-2 text-sm rounded outline-none transition-all appearance-none"
    style={{
      backgroundColor: '#fff',
      border: `1px solid ${error ? brand.danger : brand.border}`,
      color: brand.text,
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6356' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 0.75rem center',
      paddingRight: '2rem',
    }}
  >
    {children}
  </select>
);

const Modal = ({ open, onClose, title, children, size = 'md' }) => {
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl' };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 30, 46, 0.6)' }}
      onClick={onClose}
    >
      <div
        className={`${widths[size]} w-full max-h-[90vh] overflow-y-auto rounded-lg`}
        style={{ backgroundColor: brand.ivory, border: `1px solid ${brand.borderDark}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: `1px solid ${brand.border}` }}>
          <h3 className="text-lg font-semibold tracking-tight" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>
            {title}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-black hover:bg-opacity-5">
            <X size={18} style={{ color: brand.textMuted }} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
};

const Toast = ({ message, type, onClose }) => {
  if (!message) return null;
  const styles = {
    success: { bg: brand.success, icon: CheckCircle2 },
    error: { bg: brand.danger, icon: AlertCircle },
  };
  const s = styles[type] || styles.success;
  const Icon = s.icon;
  return (
    <div
      className="fixed top-6 right-6 z-[100] px-4 py-3 rounded shadow-lg flex items-center gap-3 animate-fade-in"
      style={{ backgroundColor: s.bg, color: '#fff' }}
    >
      <Icon size={18} />
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 opacity-80 hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  );
};

const ConfirmDialog = ({ open, onConfirm, onCancel, title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 30, 46, 0.7)' }}
      onClick={onCancel}
    >
      <div
        className="max-w-md w-full rounded-lg overflow-hidden"
        style={{ backgroundColor: brand.ivory, border: `1px solid ${brand.borderDark}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5">
          <div className="flex items-start gap-4">
            <div
              className="p-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: danger ? brand.dangerLight : brand.goldPale }}
            >
              <AlertTriangle size={20} style={{ color: danger ? brand.danger : brand.warning }} />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{title}</h3>
              <p className="text-sm" style={{ color: brand.textMuted }}>{message}</p>
            </div>
          </div>
        </div>
        <div className="px-6 py-3 flex justify-end gap-2" style={{ backgroundColor: brand.cream, borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={onCancel}>{cancelText}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmText}</Button>
        </div>
      </div>
    </div>
  );
};

const EmptyState = ({ icon: Icon = Inbox, title, message, action }) => (
  <div className="text-center py-16 px-6">
    <div
      className="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center"
      style={{ backgroundColor: brand.goldPale }}
    >
      <Icon size={22} style={{ color: brand.gold }} />
    </div>
    <h3 className="text-base font-semibold mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{title}</h3>
    <p className="text-sm mb-4" style={{ color: brand.textMuted }}>{message}</p>
    {action}
  </div>
);

const Toggle = ({ checked, onChange, label, description, disabled }) => (
  <div className="flex items-start justify-between py-3" style={{ borderBottom: `1px solid ${brand.border}` }}>
    <div className="flex-1 pr-4">
      {label && <p className="text-sm font-medium" style={{ color: brand.text }}>{label}</p>}
      {description && <p className="text-xs mt-0.5" style={{ color: brand.textMuted }}>{description}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-50"
      style={{ backgroundColor: checked ? brand.success : brand.borderDark }}
    >
      <span
        className="absolute top-0.5 inline-block h-4 w-4 rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  </div>
);

// ============================================================
// DASHBOARD
// ============================================================
const Dashboard = ({ employees, properties, inspections, leases, debtors, activityLog = [], currentUser, onNavigate }) => {
  const totalUnits = properties.reduce((s, p) => s + p.units, 0);
  const occupiedUnits = properties.reduce((s, p) => s + p.occupied, 0);
  const occupancyRate = ((occupiedUnits / totalUnits) * 100).toFixed(1);
  const pendingInspections = inspections.filter(i => i.status === 'Scheduled' || i.status === 'In Progress').length;
  const expiringLeases = leases.filter(l => l.status === 'Expiring Soon').length;
  const unpaidTenants = debtors.filter(d => d.status !== 'Paid').length;
  const overdueTenants = debtors.filter(d => d.status === 'Overdue').length;

  const kpis = [
    { label: 'Unpaid Tenants', value: unpaidTenants, sub: `${overdueTenants} severely overdue`, trend: overdueTenants > 0 ? 'Action needed' : 'On track', up: unpaidTenants === 0, icon: AlertCircle },
    { label: 'Occupancy Rate', value: `${occupancyRate}%`, sub: `${occupiedUnits} of ${totalUnits} units`, trend: '+1.8%', up: true, icon: Home },
    { label: 'Active Employees', value: employees.filter(e => e.status === 'Active').length, sub: `${employees.length} total staff`, trend: 'Stable', up: null, icon: Users },
    { label: 'Pending Inspections', value: pendingInspections, sub: `${expiringLeases} leases expiring`, trend: '-2', up: false, icon: ClipboardCheck },
  ];

  // Pull recent activity from the real activityLog, fall back to hardcoded if empty
  const recentActivity = useMemo(() => {
    if (!activityLog || activityLog.length === 0) {
      return [
        { type: 'inspection', text: 'Hetty completed inspection at Protea Shopping Centre', time: '2 hours ago', icon: ClipboardCheck },
        { type: 'debtor', text: 'Trinity flagged 2 tenant accounts as overdue', time: '4 hours ago', icon: AlertCircle },
        { type: 'lease', text: 'New lease signed for Shop 8, Kempton Park Centre', time: '5 hours ago', icon: FileSignature },
      ];
    }
    return [...activityLog]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 6)
      .map(entry => {
        const def = ACTIVITY_TYPES[entry.type] || { label: 'Activity', icon: Activity, color: brand.navy };
        const emp = employees.find(e => e.id === entry.employeeId);
        const author = emp ? `${emp.firstName}${emp.lastName ? ' ' + emp.lastName[0] + '.' : ''}` : 'Someone';
        return {
          text: `${author} · ${entry.description}`,
          time: timeAgo(entry.date),
          icon: def.icon,
          color: def.color,
        };
      });
  }, [activityLog, employees]);

  const activity = recentActivity;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div>
      <div className="mb-8 animate-fade-in-up">
        <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Overview</p>
        <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>
          {greeting}, {currentUser?.firstName || 'there'}
        </h1>
        <p className="text-sm" style={{ color: brand.textMuted }}>
          Here's what's happening across the Exceed portfolio today.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <Card key={i} className={`p-5 card-lift animate-fade-in-up stagger-${i + 1}`}>
              <div className="flex items-start justify-between mb-4">
                <div
                  className="p-2 rounded"
                  style={{ backgroundColor: brand.goldPale, color: brand.gold }}
                >
                  <Icon size={18} />
                </div>
                {kpi.up !== null && (
                  <div className="flex items-center gap-1 text-xs font-medium" style={{ color: kpi.up ? brand.success : brand.danger }}>
                    {kpi.up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {kpi.trend}
                  </div>
                )}
              </div>
              <p className="text-2xl font-semibold mb-1 stat-number" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>
                {kpi.value}
              </p>
              <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>{kpi.label}</p>
              <p className="text-xs mt-1" style={{ color: brand.textMuted }}>{kpi.sub}</p>
            </Card>
          );
        })}
      </div>

      {/* Portfolio at a glance */}
      <div className="grid grid-cols-1 gap-4">
        <Card className="p-5 animate-fade-in-up stagger-6">
          <h2 className="text-base font-semibold mb-4" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Portfolio at a glance</h2>
          <div className="space-y-4">
            {properties.slice(0, 4).map((p) => (
              <div key={p.id}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-medium truncate pr-2" style={{ color: brand.text }}>{p.address.split(',')[0]}</p>
                  <p className="text-xs" style={{ color: brand.textMuted }}>{p.occupied}/{p.units}</p>
                </div>
                <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: brand.border }}>
                  <div
                    className="h-1.5 rounded-full transition-all"
                    style={{ width: `${(p.occupied / p.units) * 100}%`, backgroundColor: brand.gold }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

// ============================================================
// EMPLOYEES
// ============================================================
const EmployeesSection = ({ employees, setEmployees, showToast, logAction }) => {
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  const [filterTeam, setFilterTeam] = useState('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', role: '', department: 'Commercial Leasing', team: '', isTeamLead: false, status: 'Active', startDate: '', idNumber: '' });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [deleteId, setDeleteId] = useState(null);

  const schema = {
    firstName: [validators.name],
    lastName: [validators.name],
    email: [validators.email],
    phone: [validators.phone],
    role: [validators.required],
    department: [validators.required],
    status: [validators.required],
    startDate: [validators.required],
    idNumber: [validators.idNumber],
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ firstName: '', lastName: '', email: '', phone: '', role: '', department: 'Commercial Leasing', team: '', isTeamLead: false, status: 'Active', startDate: '', idNumber: '' });
    setErrors({});
    setTouched({});
    setModalOpen(true);
  };

  const openEdit = (emp) => {
    setEditingId(emp.id);
    setForm({ ...emp });
    setErrors({});
    setTouched({});
    setModalOpen(true);
  };

  const handleField = (field, value) => {
    setForm({ ...form, [field]: value });
    if (touched[field]) {
      const newErrors = validateForm({ ...form, [field]: value }, schema);
      setErrors(newErrors);
    }
  };

  const handleBlur = (field) => {
    setTouched({ ...touched, [field]: true });
    const newErrors = validateForm(form, schema);
    setErrors(newErrors);
  };

  const handleSubmit = () => {
    const allTouched = Object.keys(schema).reduce((a, k) => ({ ...a, [k]: true }), {});
    setTouched(allTouched);
    const newErrors = validateForm(form, schema);
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      showToast('Please fix the errors before saving', 'error');
      return;
    }
    // Check duplicate email
    const dupEmail = employees.find(e => e.email.toLowerCase() === form.email.toLowerCase() && e.id !== editingId);
    if (dupEmail) {
      setErrors({ ...newErrors, email: 'An employee with this email already exists' });
      showToast('Duplicate email address detected', 'error');
      return;
    }
    if (editingId !== null) {
      setEmployees(employees.map(e => e.id === editingId ? { ...form, id: editingId } : e));
      logAction && logAction(`Updated employee: ${form.firstName} ${form.lastName}`);
      showToast('Employee updated successfully', 'success');
    } else {
      const newId = Math.max(0, ...employees.map(e => e.id)) + 1;
      setEmployees([...employees, { ...form, id: newId }]);
      logAction && logAction(`Added employee: ${form.firstName} ${form.lastName}`);
      showToast('Employee added successfully', 'success');
    }
    setModalOpen(false);
  };

  const confirmDelete = () => {
    const emp = employees.find(e => e.id === deleteId);
    setEmployees(employees.filter(e => e.id !== deleteId));
    logAction && logAction(`Removed employee: ${emp?.firstName} ${emp?.lastName}`);
    showToast('Employee removed', 'success');
    setDeleteId(null);
  };

  const filtered = useMemo(() =>
    employees.filter(e => {
      const matchesSearch = `${e.firstName} ${e.lastName} ${e.email} ${e.role} ${e.team || ''}`.toLowerCase().includes(search.toLowerCase());
      const matchesDept = filterDept === 'All' || e.department === filterDept;
      const matchesTeam = filterTeam === 'All' || e.team === filterTeam;
      return matchesSearch && matchesDept && matchesTeam;
    }), [employees, search, filterDept, filterTeam]);

  // Available teams for the current department filter
  const availableTeams = filterDept === 'All'
    ? Array.from(new Set(employees.map(e => e.team).filter(Boolean)))
    : getTeamsForDepartment(filterDept);

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>People</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Employees</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Manage staff records, roles, and employment status.</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={openCreate}>Add Employee</Button>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: brand.textMuted }} />
            <input
              type="text"
              placeholder="Search by name, email, role, or team..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded outline-none"
              style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}
            />
          </div>
          <Select value={filterDept} onChange={(e) => { setFilterDept(e.target.value); setFilterTeam('All'); }}>
            <option value="All">All Departments</option>
            {Object.keys(DEPARTMENTS_CONFIG).map(d => <option key={d} value={d}>{d}</option>)}
          </Select>
          {availableTeams.length > 0 && (
            <Select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)}>
              <option value="All">All Teams</option>
              {availableTeams.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          )}
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                {['Employee', 'Contact', 'Role', 'Department / Team', 'Status', 'Start Date', ''].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8" style={{ color: brand.textMuted }}>No employees match your filters.</td></tr>
              )}
              {filtered.map((emp) => (
                <tr key={emp.id} style={{ borderBottom: `1px solid ${brand.border}` }} className="hover:bg-black hover:bg-opacity-[0.02]">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold" style={{ backgroundColor: brand.goldPale, color: brand.gold }}>
                        {emp.firstName[0]}{emp.lastName[0]}
                      </div>
                      <div>
                        <p className="font-medium" style={{ color: brand.text }}>{emp.firstName} {emp.lastName}</p>
                        <p className="text-xs" style={{ color: brand.textMuted }}>ID: {emp.idNumber.slice(0, 6)}***</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-xs flex items-center gap-1" style={{ color: brand.text }}><Mail size={11} /> {emp.email}</p>
                    <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: brand.textMuted }}><Phone size={11} /> {emp.phone}</p>
                  </td>
                  <td className="px-5 py-4" style={{ color: brand.text }}>{emp.role}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: DEPARTMENTS_CONFIG[emp.department]?.color || brand.gold }} />
                      <div>
                        <p className="text-sm" style={{ color: brand.text }}>{emp.department}</p>
                        {emp.team && (
                          <p className="text-xs flex items-center gap-1" style={{ color: brand.textMuted }}>
                            {emp.team}
                            {emp.isTeamLead && <span className="text-[10px] px-1 rounded font-medium" style={{ backgroundColor: brand.cream, color: brand.navy }}>Lead</span>}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4"><StatusBadge status={emp.status} /></td>
                  <td className="px-5 py-4 text-xs" style={{ color: brand.textMuted }}>{emp.startDate}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(emp)} className="p-1.5 rounded hover:bg-black hover:bg-opacity-5" title="Edit">
                        <Edit2 size={14} style={{ color: brand.textMuted }} />
                      </button>
                      <button onClick={() => setDeleteId(emp.id)} className="p-1.5 rounded hover:bg-black hover:bg-opacity-5" title="Remove">
                        <Trash2 size={14} style={{ color: brand.danger }} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId !== null ? 'Edit Employee' : 'Add New Employee'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="First Name" required error={touched.firstName && errors.firstName}>
            <Input value={form.firstName} onChange={(e) => handleField('firstName', e.target.value)} onBlur={() => handleBlur('firstName')} error={touched.firstName && errors.firstName} />
          </Field>
          <Field label="Last Name" required error={touched.lastName && errors.lastName}>
            <Input value={form.lastName} onChange={(e) => handleField('lastName', e.target.value)} onBlur={() => handleBlur('lastName')} error={touched.lastName && errors.lastName} />
          </Field>
          <Field label="Email Address" required error={touched.email && errors.email}>
            <Input type="email" value={form.email} onChange={(e) => handleField('email', e.target.value)} onBlur={() => handleBlur('email')} error={touched.email && errors.email} placeholder="name@exceedproperties.co.za" />
          </Field>
          <Field label="Phone Number" required error={touched.phone && errors.phone} hint="Format: +27 82 555 1234">
            <Input value={form.phone} onChange={(e) => handleField('phone', e.target.value)} onBlur={() => handleBlur('phone')} error={touched.phone && errors.phone} />
          </Field>
          <Field label="ID Number" required error={touched.idNumber && errors.idNumber} hint="13-digit South African ID">
            <Input value={form.idNumber} onChange={(e) => handleField('idNumber', e.target.value)} onBlur={() => handleBlur('idNumber')} error={touched.idNumber && errors.idNumber} maxLength={13} />
          </Field>
          <Field label="Role / Job Title" required error={touched.role && errors.role}>
            <Input value={form.role} onChange={(e) => handleField('role', e.target.value)} onBlur={() => handleBlur('role')} error={touched.role && errors.role} placeholder="e.g. Property Manager" />
          </Field>
          <Field label="Department" required error={touched.department && errors.department}>
            <Select value={form.department} onChange={(e) => {
              const newDept = e.target.value;
              const teams = getTeamsForDepartment(newDept);
              setForm({ ...form, department: newDept, team: teams.includes(form.team) ? form.team : '' });
            }}>
              {Object.keys(DEPARTMENTS_CONFIG).map(d => <option key={d} value={d}>{d}</option>)}
            </Select>
          </Field>
          {getTeamsForDepartment(form.department).length > 0 && (
            <Field label="Team" hint="Optional — assign to a specific team within the department">
              <Select value={form.team || ''} onChange={(e) => handleField('team', e.target.value)}>
                <option value="">No team assigned</option>
                {getTeamsForDepartment(form.department).map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Team Lead">
            <Select value={form.isTeamLead ? 'Yes' : 'No'} onChange={(e) => handleField('isTeamLead', e.target.value === 'Yes')}>
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </Select>
          </Field>
          <Field label="Employment Status" required>
            <Select value={form.status} onChange={(e) => handleField('status', e.target.value)}>
              <option>Active</option><option>On Leave</option><option>Inactive</option>
            </Select>
          </Field>
          <Field label="Start Date" required error={touched.startDate && errors.startDate}>
            <Input type="date" value={form.startDate} onChange={(e) => handleField('startDate', e.target.value)} onBlur={() => handleBlur('startDate')} error={touched.startDate && errors.startDate} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit}>{editingId !== null ? 'Save Changes' : 'Add Employee'}</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onCancel={() => setDeleteId(null)}
        onConfirm={confirmDelete}
        title="Remove Employee"
        message="This will permanently remove the employee from the system. This action cannot be undone."
        confirmText="Remove Employee"
        danger
      />
    </div>
  );
};

// ============================================================
// PROPERTIES
// ============================================================
const PropertiesSection = ({ properties, setProperties, tenancies = [], setTenancies, showToast, logAction }) => {
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [lastImport, setLastImport] = useStoredState('ep:propertiesLastImport', null);
  const [tenanciesModalOpen, setTenanciesModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const uploadInputRef = useRef(null);

  const filtered = properties.filter(p => p.address.toLowerCase().includes(search.toLowerCase()));

  // Per-property tenancy aggregates (used in cards + the View Tenants modal)
  const tenanciesByProperty = useMemo(() => {
    const map = {};
    (tenancies || []).forEach(t => {
      const key = (t.property || '').trim().toLowerCase();
      if (!key) return;
      (map[key] ||= []).push(t);
    });
    return map;
  }, [tenancies]);
  const tenanciesFor = (addr) => {
    const key = (addr || '').trim().toLowerCase();
    // Match either exact OR the first comma-separated chunk (building name)
    const exact = tenanciesByProperty[key];
    if (exact) return exact;
    const firstChunk = key.split(',')[0].trim();
    return tenanciesByProperty[firstChunk] || [];
  };

  const handleUploadMda = async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      showToast('Upload a .xlsx or .xls file', 'error');
      return;
    }
    setUploading(true);
    try {
      const parsed = await parseTenancySchedule(file);
      // Flatten to legacy tenancies array (one row per tenant) AND build the
      // properties summary array. Keeps the existing PropertiesSection UI working.
      const nextTenancies = [];
      const nextProperties = parsed.properties.map((p, idx) => {
        p.tenants.forEach((t, tIdx) => {
          nextTenancies.push({
            id: `t-${p.propertyCode}-${t.accountNumber || t.unitId || 'na'}-${tIdx}`,
            property: p.propertyName,
            propertyCode: p.propertyCode,
            unit: t.unitId || '',
            tenant: t.tenantName,
            accountNumber: t.accountNumber,
            monthlyRent: t.currentRent || 0,
            leaseStart: t.leaseStart || '',
            leaseEnd: t.leaseExpiry || '',
            review: t.reviewDate || '',
            escalation: t.escalation,
            otherChargings: t.otherChargings || [],
            status: t.tenantName ? 'Occupied' : 'Vacant',
          });
        });
        return {
          id: properties.find(ex => ex.address === p.propertyName)?.id || (Math.max(0, ...properties.map(x => Number(x.id) || 0)) + idx + 1),
          address: p.propertyName,
          type: 'Property',
          units: p.tenants.length,
          occupied: p.tenants.filter(t => t.tenantName).length,
          manager: '',
          status: 'Active',
          totalArea: p.totalArea,
          totalRent: p.totalRent,
          occupancyPercent: p.occupancyPercent,
          vacancyPercent: p.vacancyPercent,
        };
      });
      // Pass-through: keep existing properties not present in upload
      properties.forEach(ex => {
        if (!nextProperties.find(np => np.address?.toLowerCase() === ex.address?.toLowerCase())) {
          nextProperties.push(ex);
        }
      });
      if (nextTenancies.length === 0) throw new Error('No tenancy rows found — is this the MDA Tenancy Schedule?');
      setProperties(nextProperties);
      setTenancies(nextTenancies);
      setLastImport({ at: new Date().toISOString(), source: file.name, properties: nextProperties.length, tenancies: nextTenancies.length, asAtDate: parsed.asAtDate, grandTotals: parsed.grandTotals });
      logAction && logAction(`Imported MDA Tenancy Schedule from ${file.name} — ${nextProperties.length} properties / ${nextTenancies.length} tenancies${parsed.asAtDate ? ' as at ' + parsed.asAtDate : ''}`);
      showToast(`Imported ${nextProperties.length} properties and ${nextTenancies.length} tenancies${parsed.asAtDate ? ' as at ' + parsed.asAtDate : ''}.`, 'success');
    } catch (err) {
      showToast('Import failed: ' + (err.message || String(err)).slice(0, 120), 'error');
      // eslint-disable-next-line no-console
      console.error('[Properties MDA import]', err);
    } finally {
      setUploading(false);
    }
  };

  const openTenancies = (p) => {
    setSelectedProperty(p);
    setTenanciesModalOpen(true);
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Portfolio</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Properties</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>
            {lastImport
              ? `Tenancy Schedule${lastImport.asAtDate ? ' — As at ' + lastImport.asAtDate : ''} · imported ${timeAgo(lastImport.at)} from ${lastImport.source} · ${lastImport.properties} properties · ${lastImport.tenancies} tenancies`
              : 'Manage the full property portfolio under Exceed\'s management.'}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={uploadInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadMda(f); e.target.value = ''; }}
          />
          <Button variant="gold" icon={Upload} onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Importing…' : 'Upload Tenancy Schedule'}
          </Button>
          <Button variant="primary" icon={Plus}>Add Property</Button>
        </div>
      </div>

      <Card className="mb-4 p-4">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: brand.textMuted }} />
          <input
            type="text"
            placeholder="Search properties..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded outline-none"
            style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((p, i) => {
          const propTenancies = tenanciesFor(p.address);
          return (
          <Card key={p.id} className={`overflow-hidden card-lift animate-fade-in-up stagger-${Math.min(i + 1, 8)}`}>
            <div className="h-32 relative" style={{ background: `linear-gradient(135deg, ${brand.navy} 0%, ${brand.navyLight} 100%)` }}>
              <div className="absolute top-3 right-3"><StatusBadge status={p.status} /></div>
              <div className="absolute bottom-3 left-4">
                <Building2 size={28} style={{ color: brand.goldLight, opacity: 0.7 }} />
              </div>
            </div>
            <div className="p-5">
              <p className="text-xs tracking-wider uppercase mb-1" style={{ color: brand.gold }}>{p.type}</p>
              <h3 className="text-base font-semibold mb-3" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{p.address}</h3>
              <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
                <div>
                  <p style={{ color: brand.textMuted }}>Occupancy</p>
                  <p className="font-semibold mt-0.5" style={{ color: brand.text }}>{p.occupied}/{p.units} units</p>
                </div>
                <div>
                  <p style={{ color: brand.textMuted }}>Vacancy Rate</p>
                  <p className="font-semibold mt-0.5" style={{ color: brand.text }}>{p.units ? (((p.units - p.occupied) / p.units) * 100).toFixed(1) : '0.0'}%</p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-3" style={{ borderTop: `1px solid ${brand.border}` }}>
                <p className="text-xs" style={{ color: brand.textMuted }}>Manager: <span style={{ color: brand.text }}>{p.manager || '—'}</span></p>
                {propTenancies.length > 0 ? (
                  <button onClick={() => openTenancies(p)} className="text-xs font-medium flex items-center gap-1 btn-press" style={{ color: brand.gold }}>
                    View Tenants ({propTenancies.length}) <ChevronRight size={12} />
                  </button>
                ) : (
                  <span className="text-xs" style={{ color: brand.textMuted }}>No tenancies imported</span>
                )}
              </div>
            </div>
          </Card>
          );
        })}
      </div>

      {/* Tenancies modal — opens when "View Tenants" is clicked on a card */}
      <Modal open={tenanciesModalOpen} onClose={() => setTenanciesModalOpen(false)} title={selectedProperty ? `Tenancies — ${selectedProperty.address}` : 'Tenancies'} size="lg">
        {selectedProperty && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                  {['Unit', 'Tenant', 'Monthly Rent', 'Lease Period', 'Status'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenanciesFor(selectedProperty.address).map(t => (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${brand.border}` }}>
                    <td className="px-3 py-2" style={{ color: brand.text }}>{t.unit || '—'}</td>
                    <td className="px-3 py-2" style={{ color: brand.text }}>{t.tenant || '—'}</td>
                    <td className="px-3 py-2" style={{ color: brand.navy, fontWeight: 600 }}>{t.monthlyRent ? `R ${Number(t.monthlyRent).toLocaleString()}` : '—'}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: brand.textMuted }}>
                      {t.leaseStart || '—'} → {t.leaseEnd || '—'}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={t.status || 'Vacant'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ============================================================
// TIME TRACKING (JIBBLE)
// ============================================================
// People to hide from time tracking views. Case-insensitive substring match
// against Jibble's `person.fullName`. Add/remove names here as needed.
const JIBBLE_EXCLUDED_NAMES = ['zelda', 'john', 'yehuda noik'];

const isJibbleExcluded = (rawEntry) => {
  const name = (rawEntry?.person?.fullName || rawEntry?.personName || '').toLowerCase().trim();
  if (!name) return false;
  return JIBBLE_EXCLUDED_NAMES.some(excl => name.includes(excl));
};

// Jibble's TimeEntries endpoint returns one row per clock event
// (clock-in, clock-out, break-in, break-out), not paired records.
// We pair them per (person, date) to produce one row per work segment.
const isInEvent = (e) => {
  const t = (e.type || e.kind || e.eventType || e.action || '').toString().toLowerCase();
  if (/(^|_)in(_|$)|clockin|enter|start/.test(t)) return true;
  if (/(^|_)out(_|$)|clockout|exit|end/.test(t)) return false;
  if (e.isIn === true || e.isClockIn === true) return true;
  if (e.isOut === true || e.isClockOut === true) return false;
  // Some Jibble payloads use a flag like `isFirst` / `isLast` or paired in/out fields
  if (e.in && !e.out) return true;
  if (!e.in && e.out) return false;
  return null; // unknown
};

const fmtTime = (iso) => iso
  ? new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
  : '—';

const resolveLocation = (entry, projectsMap) => {
  const projectName = entry?.projectId && projectsMap?.[entry.projectId];
  return projectName || entry?.address || entry?.location?.name || entry?.locationName || '—';
};

const pairClockEvents = (rawEntries, projectsMap = {}) => {
  // Fast path: if entries are already paired (have both `in` and `out`), use them directly.
  const alreadyPaired = rawEntries.length > 0 && rawEntries.every(e => e.in !== undefined && e.out !== undefined);
  if (alreadyPaired) {
    return rawEntries.map((entry, i) => ({
      id: entry.id || `e-${i}`,
      employee: entry.person?.fullName || entry.personName || 'Unknown',
      personId: entry.person?.id || entry.personId,
      date: entry.belongsToDate || entry.date || (entry.in ? String(entry.in).split('T')[0] : ''),
      clockIn: fmtTime(entry.in),
      clockOut: fmtTime(entry.out),
      hours: entry.duration ? entry.duration / 3600
        : (entry.in && entry.out ? (new Date(entry.out) - new Date(entry.in)) / 3600000 : 0),
      location: resolveLocation(entry, projectsMap),
      isOpen: !entry.out,
    }));
  }

  // Group by person + date
  const groups = new Map();
  rawEntries.forEach(e => {
    const personKey = e.person?.id || e.personId || e.person?.fullName || 'unknown';
    const dateKey = e.belongsToDate || e.date || (e.time ? String(e.time).split('T')[0] : '');
    const key = `${personKey}|${dateKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });

  const out = [];
  let i = 0;
  groups.forEach((events) => {
    events.sort((a, b) => new Date(a.time || 0) - new Date(b.time || 0));
    let openIn = null;
    events.forEach(e => {
      const isIn = isInEvent(e);
      if (isIn === true) {
        if (openIn) {
          // Unmatched in — emit the previous as still open, start new
          out.push(makePaired(openIn, null, i++, projectsMap));
        }
        openIn = e;
      } else if (isIn === false) {
        if (openIn) {
          out.push(makePaired(openIn, e, i++, projectsMap));
          openIn = null;
        }
        // Unmatched out — skip
      } else {
        // Unknown event type: best-effort alternation
        if (!openIn) openIn = e;
        else { out.push(makePaired(openIn, e, i++, projectsMap)); openIn = null; }
      }
    });
    if (openIn) out.push(makePaired(openIn, null, i++, projectsMap));
  });
  return out;
};

const makePaired = (inEv, outEv, idx, projectsMap = {}) => {
  const inTime = inEv?.time;
  const outTime = outEv?.time;
  return {
    id: `${inEv?.id || 'open'}-${outEv?.id || 'open'}-${idx}`,
    employee: inEv?.person?.fullName || inEv?.personName || 'Unknown',
    personId: inEv?.person?.id || inEv?.personId,
    date: inEv?.belongsToDate || inEv?.date || (inTime ? String(inTime).split('T')[0] : ''),
    clockIn: fmtTime(inTime),
    clockOut: fmtTime(outTime),
    hours: inTime && outTime ? (new Date(outTime) - new Date(inTime)) / 3600000 : 0,
    location: resolveLocation(inEv, projectsMap) !== '—'
      ? resolveLocation(inEv, projectsMap)
      : resolveLocation(outEv, projectsMap),
    isOpen: !outEv,
  };
};

const startOfWeekISO = () => {
  const d = new Date();
  const day = d.getDay() || 7; // Sun → 7
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  return d.toISOString().split('T')[0];
};

const startOfMonthISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const TimeTrackingSection = ({ employees, showToast, integrations, setIntegrations, onNavigateToSettings }) => {
  const jibble = integrations?.jibble || {};

  // Configured-ness now comes from the server vault — query on mount.
  // The local integrations.jibble state only holds non-secret status flags.
  const [isConfigured, setIsConfigured] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.secrets.get('jibble')
      .then(rows => {
        if (cancelled) return;
        const hasClientId = rows.some(r => r.key === 'clientId' && r.hasValue);
        const hasSecret = rows.some(r => r.key === 'clientSecret' && r.hasValue);
        setIsConfigured(hasClientId && hasSecret);
      })
      .catch(() => { if (!cancelled) setIsConfigured(false); });
    return () => { cancelled = true; };
  }, []);

  const [rangeKey, setRangeKey] = useState('week');
  const [customFrom, setCustomFrom] = useState(startOfWeekISO());
  const [customTo, setCustomTo] = useState(todayISO());

  const [filterPerson, setFilterPerson] = useState('All');
  const [filterLocation, setFilterLocation] = useState('All');
  const [search, setSearch] = useState('');

  const [activeTab, setActiveTab] = useState('overview');

  const [rawEntries, setRawEntries] = useState([]);
  const [rawLiveEntries, setRawLiveEntries] = useState([]);
  const [projectsMap, setProjectsMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [liveLastRefresh, setLiveLastRefresh] = useState(null);
  const [syncError, setSyncError] = useState(null);

  const entries = useMemo(() => pairClockEvents(rawEntries, projectsMap), [rawEntries, projectsMap]);
  const liveEntries = useMemo(
    () => pairClockEvents(rawLiveEntries, projectsMap).filter(p => p.isOpen),
    [rawLiveEntries, projectsMap]
  );

  const dateRange = useMemo(() => {
    const today = todayISO();
    if (rangeKey === 'today') return { from: today, to: today };
    if (rangeKey === 'week') return { from: startOfWeekISO(), to: today };
    if (rangeKey === 'month') return { from: startOfMonthISO(), to: today };
    return { from: customFrom, to: customTo };
  }, [rangeKey, customFrom, customTo]);

  // Build the OData query string for /TimeEntries — same shape as the old
  // jibbleAPI client expected, but now passed through the backend proxy.
  const buildTimeEntriesPath = (from, to, top) => {
    const filter = [];
    if (from) filter.push(`belongsToDate ge ${from}`);
    if (to) filter.push(`belongsToDate le ${to}`);
    const params = new URLSearchParams();
    params.set('$top', String(top));
    if (filter.length) params.set('$filter', filter.join(' and '));
    params.set('$orderby', 'time desc');
    params.set('$expand', 'person');
    return `/TimeEntries?${params.toString()}`;
  };

  const fetchEntries = useCallback(async () => {
    if (!isConfigured) return;
    setLoading(true);
    setSyncError(null);
    try {
      const data = await api.proxy.jibbleGet(buildTimeEntriesPath(dateRange.from, dateRange.to, 500), 'time');
      setRawEntries((data?.value || []).filter(e => !isJibbleExcluded(e)));
      setIntegrations(prev => ({
        ...prev,
        jibble: { ...prev.jibble, lastSync: new Date().toISOString(), lastSyncStatus: 'success', lastSyncError: null, connected: true },
      }));
    } catch (err) {
      setSyncError(err.message);
      setIntegrations(prev => ({
        ...prev,
        jibble: { ...prev.jibble, lastSyncStatus: 'error', lastSyncError: err.message },
      }));
    } finally {
      setLoading(false);
    }
  }, [isConfigured, dateRange.from, dateRange.to, setIntegrations]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // Pull projects once so we can map projectId → friendly name
  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.proxy.jibbleGet('/Projects?$top=500', 'workspace');
        if (cancelled) return;
        const map = {};
        (data?.value || []).forEach(p => {
          if (p?.id) map[p.id] = p.name || p.title || p.code || p.id;
        });
        setProjectsMap(map);
      } catch {
        // Quiet — entries will fall back to address / '—'
      }
    })();
    return () => { cancelled = true; };
  }, [isConfigured]);

  const fetchLive = useCallback(async () => {
    if (!isConfigured) return;
    try {
      const today = todayISO();
      const data = await api.proxy.jibbleGet(buildTimeEntriesPath(today, today, 200), 'time');
      setRawLiveEntries((data?.value || []).filter(e => !isJibbleExcluded(e)));
      setLiveLastRefresh(new Date());
    } catch {
      // Quiet failure for background refresh
    }
  }, [isConfigured]);

  useEffect(() => {
    if (!isConfigured) return;
    fetchLive();
    const id = setInterval(fetchLive, 60000);
    return () => clearInterval(id);
  }, [fetchLive, isConfigured]);

  const personOptions = useMemo(() => Array.from(new Set(entries.map(e => e.employee))).filter(Boolean).sort(), [entries]);
  const locationOptions = useMemo(() => {
    const source = filterPerson === 'All' ? entries : entries.filter(e => e.employee === filterPerson);
    return Array.from(new Set(source.map(e => e.location))).filter(l => l && l !== '—').sort();
  }, [entries, filterPerson]);

  // If the selected location is no longer valid for the chosen person, reset it
  useEffect(() => {
    if (filterLocation !== 'All' && !locationOptions.includes(filterLocation)) {
      setFilterLocation('All');
    }
  }, [locationOptions, filterLocation]);

  const filteredEntries = useMemo(() => entries.filter(e => {
    if (filterPerson !== 'All' && e.employee !== filterPerson) return false;
    if (filterLocation !== 'All' && e.location !== filterLocation) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.employee.toLowerCase().includes(q) && !e.location.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [entries, filterPerson, filterLocation, search]);

  const stats = useMemo(() => {
    const totalHours = filteredEntries.reduce((s, e) => s + e.hours, 0);
    const uniqueDays = new Set(filteredEntries.map(e => e.date).filter(Boolean)).size || 1;
    const uniquePeople = new Set(filteredEntries.map(e => e.employee)).size;
    return { totalHours, uniqueDays, uniquePeople, avgPerDay: totalHours / uniqueDays };
  }, [filteredEntries]);

  const byEmployee = useMemo(() => {
    const map = new Map();
    filteredEntries.forEach(e => {
      if (!map.has(e.employee)) map.set(e.employee, { employee: e.employee, totalHours: 0, days: new Set() });
      const r = map.get(e.employee);
      r.totalHours += e.hours;
      r.days.add(e.date);
    });
    return Array.from(map.values())
      .map(r => ({ employee: r.employee, totalHours: r.totalHours, days: r.days.size, avgPerDay: r.totalHours / Math.max(r.days.size, 1) }))
      .sort((a, b) => b.totalHours - a.totalHours);
  }, [filteredEntries]);

  const hoursByDay = useMemo(() => {
    const map = new Map();
    filteredEntries.forEach(e => {
      if (!e.date) return;
      map.set(e.date, (map.get(e.date) || 0) + e.hours);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, hours]) => ({
        date: new Date(date).toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' }),
        hours: Math.round(hours * 10) / 10,
      }));
  }, [filteredEntries]);

  // Empty state when Jibble isn't configured
  if (!isConfigured) {
    return (
      <div className="animate-fade-in-up">
        <div className="mb-6">
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Time & Attendance</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Time Tracking</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Live data from your Jibble workspace.</p>
        </div>
        <Card className="p-8">
          <EmptyState
            icon={Clock}
            title="Connect Jibble first"
            message="Add your Jibble credentials in Settings → Integrations to start pulling time entries here."
            action={<Button variant="primary" icon={SettingsIcon} onClick={onNavigateToSettings}>Open Settings</Button>}
          />
        </Card>
      </div>
    );
  }

  const topByEmployee = byEmployee.slice(0, 10);

  return (
    <div className="animate-fade-in-up">
      {/* Header */}
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Time & Attendance</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Time Tracking</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>
            {loading ? 'Loading…' : `${filteredEntries.length} entr${filteredEntries.length === 1 ? 'y' : 'ies'} · ${dateRange.from} → ${dateRange.to}`}
            {jibble.lastSync && !loading && <> · last sync {timeAgo(jibble.lastSync)}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={RefreshCw} onClick={fetchEntries} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button variant="ghost" icon={ExternalLink} onClick={() => window.open('https://web.jibble.io', '_blank')}>Open Jibble</Button>
          <Button variant="ghost" icon={SettingsIcon} onClick={onNavigateToSettings}>Settings</Button>
        </div>
      </div>

      {/* Sync error banner */}
      {syncError && (
        <Card className="mb-4 p-4" style={{ backgroundColor: brand.dangerLight, borderColor: brand.danger }}>
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="flex-shrink-0 mt-0.5" style={{ color: brand.danger }} />
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: brand.danger }}>Sync failed</p>
              <p className="text-xs mt-1" style={{ color: brand.text }}>{syncError}</p>
            </div>
            <button onClick={() => setSyncError(null)} className="p-1 rounded"><X size={14} style={{ color: brand.danger }} /></button>
          </div>
        </Card>
      )}

      {/* Currently clocked in */}
      <Card className="mb-4 p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="relative w-2.5 h-2.5">
              <div className="absolute inset-0 rounded-full" style={{ backgroundColor: brand.success }} />
              <div className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: brand.success, opacity: 0.5 }} />
            </div>
            <p className="text-xs font-semibold tracking-wider uppercase" style={{ color: brand.navy }}>
              Currently Clocked In · {liveEntries.length}
            </p>
            {liveLastRefresh && (
              <span className="text-[11px]" style={{ color: brand.textMuted }}>refreshed {timeAgo(liveLastRefresh.toISOString())}</span>
            )}
          </div>
          <button onClick={fetchLive} className="text-xs flex items-center gap-1 btn-press" style={{ color: brand.gold }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
        {liveEntries.length === 0 ? (
          <p className="text-xs italic" style={{ color: brand.textMuted }}>No one is currently clocked in.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {liveEntries.map(e => (
              <div key={e.id} className="p-3 rounded flex items-center gap-3" style={{ backgroundColor: brand.successLight }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0" style={{ backgroundColor: '#fff', color: brand.success }}>
                  {(e.employee || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: brand.text }}>{e.employee}</p>
                  <p className="text-xs flex items-center gap-1 truncate" style={{ color: brand.textMuted }}>
                    <Clock size={11} /> Since {e.clockIn}
                  </p>
                  <p className="text-xs flex items-center gap-1 truncate" style={{ color: brand.text }}>
                    <MapPin size={11} style={{ color: brand.gold }} /> {e.location}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Date range chips + filters */}
      <Card className="mb-4 p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <p className="text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>Period</p>
          {[
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'This Week' },
            { key: 'month', label: 'This Month' },
            { key: 'custom', label: 'Custom' },
          ].map(r => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key)}
              className="px-3 py-1.5 text-xs font-medium rounded btn-press transition-all"
              style={{
                backgroundColor: rangeKey === r.key ? brand.navy : 'transparent',
                color: rangeKey === r.key ? '#fff' : brand.text,
                border: `1px solid ${rangeKey === r.key ? brand.navy : brand.border}`,
              }}
            >
              {r.label}
            </button>
          ))}
          {rangeKey === 'custom' && (
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="px-2 py-1 text-xs rounded outline-none" style={{ border: `1px solid ${brand.border}` }} />
              <span style={{ color: brand.textMuted }}>→</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="px-2 py-1 text-xs rounded outline-none" style={{ border: `1px solid ${brand.border}` }} />
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 relative min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: brand.textMuted }} />
            <input
              type="text"
              placeholder="Search name or location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded outline-none"
              style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}
            />
          </div>
          <Select value={filterPerson} onChange={(e) => setFilterPerson(e.target.value)}>
            <option value="All">All People</option>
            {personOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
            <option value="All">All Locations</option>
            {locationOptions.map(l => <option key={l} value={l}>{l}</option>)}
          </Select>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total Hours', value: stats.totalHours.toFixed(1), icon: Clock, color: brand.navy },
          { label: 'People Worked', value: stats.uniquePeople, icon: Users, color: brand.success },
          { label: 'Days Worked', value: stats.uniqueDays, icon: Calendar, color: brand.warning },
          { label: 'Avg Hours/Day', value: stats.avgPerDay.toFixed(1), icon: Activity, color: brand.gold },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className="p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>{s.label}</p>
                <Icon size={14} style={{ color: s.color }} />
              </div>
              <p className="text-2xl font-semibold stat-number" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{s.value}</p>
            </Card>
          );
        })}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4" style={{ borderBottom: `1px solid ${brand.border}` }}>
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'entries', label: 'Entries' },
          { id: 'byemployee', label: 'By Employee' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className="px-4 py-2 text-sm font-medium transition-all relative btn-press"
            style={{
              color: activeTab === t.id ? brand.gold : brand.textMuted,
              fontWeight: activeTab === t.id ? 600 : 500,
            }}
          >
            {t.label}
            {activeTab === t.id && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: brand.gold }} />}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <Card className="p-4">
          <p className="text-xs font-semibold tracking-wider uppercase mb-3" style={{ color: brand.navy }}>Hours Worked Per Day</p>
          {hoursByDay.length === 0 ? (
            <p className="text-sm italic py-8 text-center" style={{ color: brand.textMuted }}>
              {loading ? 'Loading…' : 'No data in the selected range.'}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={hoursByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke={brand.border} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: brand.textMuted }} />
                <YAxis tick={{ fontSize: 11, fill: brand.textMuted }} />
                <RTooltip />
                <Bar dataKey="hours" fill={brand.gold} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      )}

      {/* Tab: Entries */}
      {activeTab === 'entries' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                  {['Employee', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Location'].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEntries.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8" style={{ color: brand.textMuted }}>
                    {loading ? 'Loading entries…' : 'No entries match your filters.'}
                  </td></tr>
                )}
                {filteredEntries.map(e => (
                  <tr key={e.id} style={{ borderBottom: `1px solid ${brand.border}` }} className="hover:bg-black hover:bg-opacity-[0.02]">
                    <td className="px-5 py-3 font-medium" style={{ color: brand.text }}>{e.employee}</td>
                    <td className="px-5 py-3 text-xs" style={{ color: brand.textMuted }}>{e.date}</td>
                    <td className="px-5 py-3" style={{ color: brand.text }}>{e.clockIn}</td>
                    <td className="px-5 py-3" style={{ color: brand.text }}>{e.clockOut}</td>
                    <td className="px-5 py-3 font-semibold" style={{ color: brand.navy }}>{e.hours.toFixed(1)}h</td>
                    <td className="px-5 py-3 text-xs" style={{ color: brand.textMuted }}>
                      <span className="flex items-center gap-1"><MapPin size={11} />{e.location}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Tab: By Employee */}
      {activeTab === 'byemployee' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4">
            <p className="text-xs font-semibold tracking-wider uppercase mb-3" style={{ color: brand.navy }}>
              Top {topByEmployee.length} by Hours
            </p>
            {topByEmployee.length === 0 ? (
              <p className="text-sm italic py-8 text-center" style={{ color: brand.textMuted }}>No data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(220, topByEmployee.length * 32 + 40)}>
                <BarChart data={topByEmployee} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={brand.border} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: brand.textMuted }} />
                  <YAxis type="category" dataKey="employee" width={120} tick={{ fontSize: 11, fill: brand.textMuted }} />
                  <RTooltip />
                  <Bar dataKey="totalHours" fill={brand.gold} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                    {['Employee', 'Hours', 'Days', 'Avg/Day'].map(h => (
                      <th key={h} className="text-left px-4 py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byEmployee.length === 0 && (
                    <tr><td colSpan={4} className="text-center py-8" style={{ color: brand.textMuted }}>No data.</td></tr>
                  )}
                  {byEmployee.map(r => (
                    <tr key={r.employee} style={{ borderBottom: `1px solid ${brand.border}` }}>
                      <td className="px-4 py-2 font-medium" style={{ color: brand.text }}>{r.employee}</td>
                      <td className="px-4 py-2 font-semibold" style={{ color: brand.navy }}>{r.totalHours.toFixed(1)}h</td>
                      <td className="px-4 py-2 text-xs" style={{ color: brand.textMuted }}>{r.days}</td>
                      <td className="px-4 py-2 text-xs" style={{ color: brand.textMuted }}>{r.avgPerDay.toFixed(1)}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// ============================================================
// INSPECTIONS
// ============================================================
const InspectionsSection = ({ inspections, setInspections, employees, properties, showToast }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ property: '', unit: '', inspector: '', scheduledDate: '', type: 'Routine', priority: 'Medium' });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const schema = {
    property: [validators.required],
    unit: [validators.required],
    inspector: [validators.required],
    scheduledDate: [validators.futureDate],
    type: [validators.required],
    priority: [validators.required],
  };

  const handleField = (f, v) => {
    setForm({ ...form, [f]: v });
    if (touched[f]) setErrors(validateForm({ ...form, [f]: v }, schema));
  };
  const handleBlur = (f) => {
    setTouched({ ...touched, [f]: true });
    setErrors(validateForm(form, schema));
  };

  const handleSubmit = () => {
    const allTouched = Object.keys(schema).reduce((a, k) => ({ ...a, [k]: true }), {});
    setTouched(allTouched);
    const newErrors = validateForm(form, schema);
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      showToast('Please fix the errors before saving', 'error');
      return;
    }
    const newId = Math.max(0, ...inspections.map(i => i.id)) + 1;
    setInspections([...inspections, { ...form, id: newId, status: 'Scheduled' }]);
    showToast('Inspection scheduled successfully', 'success');
    setModalOpen(false);
    setForm({ property: '', unit: '', inspector: '', scheduledDate: '', type: 'Routine', priority: 'Medium' });
    setErrors({});
    setTouched({});
  };

  const inspectors = employees.filter(e => e.department === 'Inspections' || e.role.includes('Inspector'));
  const scheduledCount = inspections.filter(i => i.status === 'Scheduled').length;
  const completedCount = inspections.filter(i => i.status === 'Completed').length;
  const inProgressCount = inspections.filter(i => i.status === 'In Progress').length;
  const avgScore = (inspections.filter(i => i.score).reduce((s, i) => s + i.score, 0) / inspections.filter(i => i.score).length || 0).toFixed(0);

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Quality Assurance</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Property Inspections</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Schedule, track, and report on property inspections across the portfolio.</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setModalOpen(true)}>Schedule Inspection</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Scheduled', value: scheduledCount, color: brand.navy, icon: Calendar },
          { label: 'In Progress', value: inProgressCount, color: brand.warning, icon: Activity },
          { label: 'Completed', value: completedCount, color: brand.success, icon: CheckCircle2 },
          { label: 'Avg. Score', value: `${avgScore}/100`, color: brand.gold, icon: Star },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>{s.label}</p>
                <Icon size={14} style={{ color: s.color }} />
              </div>
              <p className="text-2xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{s.value}</p>
            </Card>
          );
        })}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                {['Property', 'Unit', 'Type', 'Inspector', 'Scheduled', 'Priority', 'Status', 'Score'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inspections.map((i) => (
                <tr key={i.id} style={{ borderBottom: `1px solid ${brand.border}` }} className="hover:bg-black hover:bg-opacity-[0.02]">
                  <td className="px-5 py-4">
                    <p className="font-medium" style={{ color: brand.text }}>{i.property.split(',')[0]}</p>
                    <p className="text-xs" style={{ color: brand.textMuted }}>{i.property.split(',').slice(1).join(',').trim()}</p>
                  </td>
                  <td className="px-5 py-4" style={{ color: brand.text }}>{i.unit}</td>
                  <td className="px-5 py-4" style={{ color: brand.text }}>{i.type}</td>
                  <td className="px-5 py-4" style={{ color: brand.text }}>{i.inspector}</td>
                  <td className="px-5 py-4 text-xs" style={{ color: brand.textMuted }}>{i.scheduledDate}</td>
                  <td className="px-5 py-4"><StatusBadge status={i.priority} /></td>
                  <td className="px-5 py-4"><StatusBadge status={i.status} /></td>
                  <td className="px-5 py-4">
                    {i.score ? (
                      <span className="font-semibold" style={{ color: i.score >= 85 ? brand.success : i.score >= 70 ? brand.warning : brand.danger }}>
                        {i.score}/100
                      </span>
                    ) : <span style={{ color: brand.textMuted }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Schedule New Inspection">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Property" required error={touched.property && errors.property}>
            <Select value={form.property} onChange={(e) => handleField('property', e.target.value)} onBlur={() => handleBlur('property')} error={touched.property && errors.property}>
              <option value="">Select a property...</option>
              {properties.map(p => <option key={p.id} value={p.address}>{p.address}</option>)}
            </Select>
          </Field>
          <Field label="Unit" required error={touched.unit && errors.unit}>
            <Input value={form.unit} onChange={(e) => handleField('unit', e.target.value)} onBlur={() => handleBlur('unit')} error={touched.unit && errors.unit} placeholder="e.g. Unit 12B" />
          </Field>
          <Field label="Inspector" required error={touched.inspector && errors.inspector}>
            <Select value={form.inspector} onChange={(e) => handleField('inspector', e.target.value)} onBlur={() => handleBlur('inspector')} error={touched.inspector && errors.inspector}>
              <option value="">Select inspector...</option>
              {inspectors.map(i => <option key={i.id} value={`${i.firstName} ${i.lastName}`}>{i.firstName} {i.lastName}</option>)}
            </Select>
          </Field>
          <Field label="Scheduled Date" required error={touched.scheduledDate && errors.scheduledDate} hint="Must be today or later">
            <Input type="date" value={form.scheduledDate} onChange={(e) => handleField('scheduledDate', e.target.value)} onBlur={() => handleBlur('scheduledDate')} error={touched.scheduledDate && errors.scheduledDate} />
          </Field>
          <Field label="Inspection Type" required>
            <Select value={form.type} onChange={(e) => handleField('type', e.target.value)}>
              <option>Routine</option><option>Quarterly</option><option>Move-in</option><option>Move-out</option><option>Annual</option><option>Incident</option>
            </Select>
          </Field>
          <Field label="Priority" required>
            <Select value={form.priority} onChange={(e) => handleField('priority', e.target.value)}>
              <option>Low</option><option>Medium</option><option>High</option>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit}>Schedule Inspection</Button>
        </div>
      </Modal>
    </div>
  );
};

// ============================================================
// LEASING
// Workflow: Offer → Drafted → On DocuSign → Active → Expiring
// Categorized by Commercial vs Residential
// ============================================================
const LeasingCalculator = () => {
  const [firstMonthRent, setFirstMonthRent] = useState('');
  const [escalationPct, setEscalationPct] = useState('');
  const [vatPct, setVatPct] = useState('15');
  const [years, setYears] = useState('10');

  const fmt2 = (n) => {
    const [int, dec] = Number(n || 0).toFixed(2).split('.');
    return `R ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${dec}`;
  };

  const rows = useMemo(() => {
    const rent = Number(firstMonthRent);
    const esc = Number(escalationPct);
    const vat = Number(vatPct);
    const yrs = parseInt(years, 10);
    if (!rent || rent <= 0 || isNaN(esc) || isNaN(vat) || !yrs || yrs <= 0 || yrs > 30) return [];

    const out = [];
    let monthly = rent;
    for (let y = 1; y <= yrs; y++) {
      const monthlyVat = monthly * (vat / 100);
      out.push({
        year: y,
        monthlyExVat: monthly,
        monthlyVat,
        monthlyIncVat: monthly + monthlyVat,
      });
      monthly = monthly * (1 + esc / 100);
    }
    return out;
  }, [firstMonthRent, escalationPct, vatPct, years]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    exVat: acc.exVat + r.monthlyExVat * 12,
    vat: acc.vat + r.monthlyVat * 12,
    incVat: acc.incVat + r.monthlyIncVat * 12,
  }), { exVat: 0, vat: 0, incVat: 0 }), [rows]);

  const hasResults = rows.length > 0;

  return (
    <Card className="mt-6 p-5 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded" style={{ backgroundColor: brand.goldPale }}>
          <Calculator size={18} style={{ color: brand.gold }} />
        </div>
        <div>
          <p className="text-xs tracking-[0.2em] uppercase" style={{ color: brand.gold }}>Tools</p>
          <h2 className="text-lg" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Rental Escalation Calculator</h2>
        </div>
      </div>
      <p className="text-xs mb-4" style={{ color: brand.textMuted }}>
        Enter the first month's rent, annual escalation, and lease term to project the rental schedule and total payout — broken down by ex VAT, VAT, and inc VAT.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-4">
        <Field label="First Month's Rent (ZAR)" hint="Excluding VAT">
          <Input
            type="number"
            value={firstMonthRent}
            onChange={(e) => setFirstMonthRent(e.target.value)}
            placeholder="e.g. 15000"
            min="0"
          />
        </Field>
        <Field label="Annual Escalation (%)" hint="e.g. 8 for 8% per year">
          <Input
            type="number"
            value={escalationPct}
            onChange={(e) => setEscalationPct(e.target.value)}
            placeholder="e.g. 8"
            min="0"
            step="0.1"
          />
        </Field>
        <Field label="VAT Rate (%)" hint="Default 15% (RSA)">
          <Input
            type="number"
            value={vatPct}
            onChange={(e) => setVatPct(e.target.value)}
            min="0"
            step="0.1"
          />
        </Field>
        <Field label="Lease Term (Years)" hint="1 to 30 years">
          <Input
            type="number"
            value={years}
            onChange={(e) => setYears(e.target.value)}
            min="1"
            max="30"
            step="1"
          />
        </Field>
      </div>

      {hasResults ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                  {['Year', 'Monthly Ex VAT', 'Monthly VAT', 'Monthly Inc VAT'].map(h => (
                    <th key={h} className="text-left px-4 py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.year} style={{ borderBottom: `1px solid ${brand.border}` }}>
                    <td data-year={r.year} className="calc-year-cell px-4 py-3 font-medium" style={{ color: brand.navy }}></td>
                    <td className="px-4 py-3" style={{ color: brand.text }}>{fmt2(r.monthlyExVat)}</td>
                    <td className="px-4 py-3" style={{ color: brand.textMuted }}>{fmt2(r.monthlyVat)}</td>
                    <td className="px-4 py-3 font-semibold" style={{ color: brand.navy }}>{fmt2(r.monthlyIncVat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 p-4 rounded-lg" style={{ backgroundColor: brand.cream, border: `1px solid ${brand.gold}` }}>
            <p className="text-xs tracking-[0.2em] uppercase mb-3" style={{ color: brand.gold }}>
              Total Lease Payout · {rows.length} {rows.length === 1 ? 'Year' : 'Years'}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-[11px] tracking-wider uppercase mb-1" style={{ color: brand.textMuted }}>Total Ex VAT</p>
                <p className="text-xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.text }}>{fmt2(totals.exVat)}</p>
              </div>
              <div>
                <p className="text-[11px] tracking-wider uppercase mb-1" style={{ color: brand.textMuted }}>Total VAT</p>
                <p className="text-xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.text }}>{fmt2(totals.vat)}</p>
              </div>
              <div>
                <p className="text-[11px] tracking-wider uppercase mb-1" style={{ color: brand.gold }}>Total Inc VAT</p>
                <p className="text-2xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{fmt2(totals.incVat)}</p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-8 px-4 rounded text-sm italic" style={{ color: brand.textMuted, backgroundColor: '#FAFAF6', border: `1px dashed ${brand.border}` }}>
          Enter the first month's rent, escalation, and lease term to see the projection and total payout.
        </div>
      )}
    </Card>
  );
};

// ============================================================
// AUTOMATED LEASE DRAFTING SYSTEM
// Full multi-section commercial lease form, drafts/history/saved
// storage, preview, PDF + Word export. South African market.
// ============================================================
const VAT_RATE = 0.15;

const blankYearRental = (year = 1) => ({
  year,
  basicRentExVat: '',
  securityExVat: '',
  electricityAsAt: '',
  electricityExVat: '',
  electricityMetered: false,
  sewerageAsAt: '',
  sewerageExVat: '',
  sewerageMetered: false,
  refuseAsAt: '',
  refuseExVat: '',
  ratesAsAt: '',
  ratesExVat: '',
  from: '',
  to: '',
  overridden: {},
});

const blankLeaseForm = () => ({
  landlord: { name: '', address: '', phone: '', registrationNumber: '', vatNumber: 'TBA', bankName: '', bankBranch: '', accountNumber: '', branchCode: '', saveAsDefault: false },
  tenant: { companyName: '', idNumber: '', registrationNumber: '', vatNumber: '', address: '', phone: '', email: '', contactPerson: '', entityType: 'Company', signatoryName: '', signatoryIdNumber: '', signatoryRole: 'Director', signatoryPronoun: 'his' },
  premises: { unitNumber: '', buildingName: '', buildingAddress: '', rentableArea: '', parkingRatio: '', permittedUse: '' },
  initialPeriod: { years: 3, months: 0, commencementDate: '', terminationDate: '', terminationOverride: false },
  beneficialOccupation: { enabled: false, fromDate: '', toDate: '', amountExVat: '0' },
  optionPeriod: { years: 0, months: 0, exerciseBy: '' },
  suretyRequired: false,
  surety: { name: '', idNumber: '', address: '' },
  monthlyRental: { escalationRate: 6, years: [blankYearRental(1), blankYearRental(2), blankYearRental(3)] },
  deposit: { amount: '' },
  turnover: { percentage: 'N/A', financialYearEnd: 'N/A', minimumTurnoverRequirement: 'N/A' },
  advertising: { contribution: 'N/A' },
  tenantBankDetails: 'N/A',
  leaseFees: { amount: '750.00' },
  annexures: ['A', 'B', 'C', 'D'],
  annexureSelected: { A: true, B: true, C: true, D: true },
  // leaseType is chosen by the user on first load via a chooser modal —
  // null means "not yet chosen", which keeps the chooser blocking the form.
  meta: { createdAt: null, updatedAt: null, draftId: null, leaseType: null },
});

// Date helpers
const addMonths = (isoDate, months) => {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const target = new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
  // Subtract 1 day for inclusive end
  target.setDate(target.getDate() - 1);
  return target.toISOString().split('T')[0];
};
const addYearsToDate = (isoDate, years) => {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const target = new Date(d.getFullYear() + years, d.getMonth(), d.getDate());
  return target.toISOString().split('T')[0];
};
const fmtMoney = (n) => {
  const num = Number(n);
  if (isNaN(num)) return 'R 0.00';
  const [int, dec] = num.toFixed(2).split('.');
  // R + non-breaking space + thousands grouped with non-breaking spaces + dot decimal
  return `R ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${dec}`;
};
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
const fmtDateShort = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const fmtDateLong = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

// Section card helper — used to wrap each numbered form section
const LeaseSection = ({ number, title, icon: Icon, color, children, subtitle, headerExtra }) => (
  <Card className="mb-4 p-5 animate-fade-in-up">
    <div className="flex items-start gap-3 mb-4 flex-wrap">
      <div className="p-2 rounded flex-shrink-0" style={{ backgroundColor: brand.goldPale }}>
        <Icon size={18} style={{ color: color || brand.gold }} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold tracking-wider uppercase" style={{ color: brand.navy }}>
          <span style={{ color: brand.gold }}>{number}</span> {title}
        </h3>
        {subtitle && <p className="text-[11px] mt-0.5" style={{ color: brand.textMuted }}>{subtitle}</p>}
      </div>
      {headerExtra && <div>{headerExtra}</div>}
    </div>
    {children}
  </Card>
);

// ----- PDF text extraction (browser-side via pdfjs-dist) -----
// Loaded on demand to keep the main bundle small.
const extractPdfText = async (file) => {
  const pdfjs = await import('pdfjs-dist');
  // Bundle the worker via Vite (?url) so it serves from our own origin.
  // Loading it from a CDN is blocked by helmet's default CSP in production
  // (worker-src 'self'), which surfaces as "Setting up fake worker failed:
  // Failed to fetch dynamically imported module".
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Group items by their Y coordinate so multi-column layouts (e.g. an
    // invoice with "Bill To" on the left and the landlord block on the
    // right) keep their lines intact instead of being flattened into a
    // single space-joined blob. Within each line, sort by X so columns
    // read left-to-right. This makes it much easier for Claude to spot
    // the BANKING DETAILS block on a typical SA tax invoice.
    const items = (content.items || []).filter(it => 'str' in it && it.str);
    const lines = new Map();
    for (const it of items) {
      const y = Math.round((it.transform?.[5] ?? 0));
      const x = it.transform?.[4] ?? 0;
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x, s: it.str });
    }
    const sortedY = [...lines.keys()].sort((a, b) => b - a); // top of page first
    const pageText = sortedY
      .map(y => lines.get(y).sort((a, b) => a.x - b.x).map(p => p.s).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    text += pageText + '\n\n';
  }
  return text;
};

// ----- Claude API parse calls -----
// Both functions use tool-use for guaranteed structured JSON.
const LEASE_CONTROL_TOOL = {
  name: 'submit_lease_control_data',
  description: 'Submit the structured fields extracted from a South African Lease Control Schedule PDF.',
  input_schema: {
    type: 'object',
    properties: {
      landlord: {
        type: 'object',
        description: 'Landlord details — extract ONLY from under the heading "1.1 THE LANDLORD" or "LANDLORD".',
        properties: {
          name: { type: 'string', description: 'Landlord company name (uppercase as printed)' },
          phone: { type: 'string' },
          registrationNumber: { type: 'string' },
          vatNumber: { type: 'string' },
          bankName: { type: 'string' },
          bankBranch: { type: 'string' },
          accountNumber: { type: 'string' },
          branchCode: { type: 'string' },
        },
      },
      tenant: {
        type: 'object',
        description: 'Tenant details — extract from under the section heading "1.2 THE TENANT" or "TENANT" in the Lease Control Schedule. Never use the landlord section.',
        properties: {
          companyName: { type: 'string', description: 'Tenant company name as printed under "1.2 THE TENANT" (often shown bold/uppercase)' },
          idNumber: { type: 'string', description: 'Tenant ID number if a natural person; usually blank for companies' },
          registrationNumber: { type: 'string', description: 'Tenant company registration number, format YYYY/NNNNNN/NN' },
          vatNumber: { type: 'string', description: 'Tenant VAT registration number (10 digits, usually starts with 4). If shown as "TBA" or "N/A", use that literal value.' },
          address: { type: 'string', description: 'Tenant address — use the physical address if both postal and physical are shown; join multi-line addresses with comma+space.' },
          phone: { type: 'string', description: 'Tenant phone, label "TEL" / "PHONE" / "CONTACT NO"' },
          email: { type: 'string', description: 'Tenant email, label "EMAIL" / "E-MAIL"' },
          contactPerson: { type: 'string', description: 'Tenant contact person name, label "CONTACT" / "ATTN" / "ATTENTION"' },
        },
      },
      premises: {
        type: 'object',
        properties: {
          unitNumber: { type: 'string' },
          buildingName: { type: 'string' },
          buildingAddress: { type: 'string' },
          rentableArea: { type: 'number', description: 'Area in m²' },
          parkingRatio: { type: 'number' },
          permittedUse: { type: 'string' },
        },
      },
      initialPeriod: {
        type: 'object',
        properties: {
          years: { type: 'number' },
          months: { type: 'number' },
          commencementDate: { type: 'string', description: 'ISO format YYYY-MM-DD' },
          terminationDate: { type: 'string', description: 'ISO format YYYY-MM-DD' },
        },
      },
      optionPeriod: {
        type: 'object',
        properties: {
          years: { type: 'number' },
          months: { type: 'number' },
          exerciseBy: { type: 'string', description: 'ISO format YYYY-MM-DD' },
        },
      },
      surety: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          idNumber: { type: 'string' },
          address: { type: 'string' },
        },
      },
      monthlyRental: {
        type: 'object',
        properties: {
          escalationRate: { type: 'number', description: 'Annual escalation %, e.g. 8 for 8%' },
          yearOneRent: { type: 'number', description: 'Year 1 basic rent excluding VAT' },
        },
      },
      deposit: { type: 'object', properties: { amount: { type: 'number' } } },
      leaseFees: { type: 'object', properties: { amount: { type: 'number' } } },
      advertising: { type: 'object', properties: { contribution: { type: 'string' } } },
      turnover: {
        type: 'object',
        properties: {
          percentage: { type: 'string' },
          financialYearEnd: { type: 'string' },
          minimumTurnoverRequirement: { type: 'string' },
        },
      },
    },
  },
};

const INVOICE_TOOL = {
  name: 'submit_invoice_data',
  description: 'Submit landlord identity, banking, deposit and utility data extracted from a South African commercial lease invoice PDF.',
  input_schema: {
    type: 'object',
    properties: {
      landlord: {
        type: 'object',
        description: 'Landlord details. On this invoice format, landlord information is printed in the TOP-RIGHT of the page (and again in the banking-details block lower down). Extract ONLY from those regions.',
        properties: {
          name: { type: 'string', description: 'Landlord company name as printed in the top-right' },
          address: { type: 'string', description: 'Landlord postal/physical address from the top-right block. Multi-line should be joined with comma+space. NEVER use the "Bill To" address.' },
          phone: { type: 'string', description: 'Landlord phone (TEL / PHONE) from the top-right' },
          vatNumber: { type: 'string', description: 'Landlord VAT registration number (label "VAT No" / "VAT Reg" — 10 digits, usually starts with 4)' },
          registrationNumber: { type: 'string', description: 'Landlord company registration number (label "Reg No" / "Co Reg" — format YYYY/NNNNNN/NN)' },
          bankName: { type: 'string', description: 'Bank name from the banking/payment details block, e.g. "Nedbank"' },
          bankBranch: { type: 'string', description: 'Branch name, e.g. "Northern Gauteng"' },
          accountNumber: { type: 'string', description: 'Bank account number (digits only, no spaces)' },
          branchCode: { type: 'string', description: 'Bank branch/sort code (digits only)' },
        },
      },
      deposit: {
        type: 'object',
        description: 'Any deposit line item on the invoice (often labelled "DEPOSIT", "SECURITY DEPOSIT", or "REFUNDABLE DEPOSIT"). Omit if no deposit is shown.',
        properties: {
          amount: { type: 'number', description: 'Deposit amount in Rands, no currency symbol or thousands separator' },
        },
      },
      utilities: {
        type: 'object',
        description: 'Utility and rates charges. Omit any value not clearly on the invoice.',
        properties: {
          electricity: { type: 'number' },
          sewerageWater: { type: 'number' },
          refuse: { type: 'number' },
          rates: { type: 'number' },
          asAt: { type: 'string', description: 'ISO date YYYY-MM-DD that the utility/rates values apply to' },
        },
      },
    },
  },
};

// CIPC company registration document (e.g. CoR 14.3 / 14.1A or the CIPC
// Disclosure Certificate). Identifies the legal entity that will sign the
// lease — primary use is to confirm tenant company name, registration
// number, type of entity, and current directors / members.
const CIPC_TOOL = {
  name: 'submit_cipc_data',
  description: 'Extract company-level fields from a South African CIPC company-disclosure / registration certificate (CoR 14.3, CoR 9.4, Disclosure Certificate, etc).',
  input_schema: {
    type: 'object',
    properties: {
      tenant: {
        type: 'object',
        description: 'Tenant / company being disclosed by the CIPC document.',
        properties: {
          companyName: { type: 'string', description: 'Registered company name exactly as printed' },
          tradingName: { type: 'string', description: 'Trading-as name if different from registered name' },
          registrationNumber: { type: 'string', description: 'Format YYYY/NNNNNN/NN (CIPC registration number)' },
          entityType: { type: 'string', description: 'Company | CC | Trust | Partnership | Sole Proprietor — pick the closest match' },
          status: { type: 'string', description: 'Company status — In Business, In Deregistration, etc.' },
          registrationDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
          financialYearEnd: { type: 'string', description: 'Month name or ISO date (e.g. "February" or "2026-02-28")' },
          principalAddress: { type: 'string', description: 'Registered principal business address, multi-line joined by ", "' },
          postalAddress: { type: 'string', description: 'Postal address if different from principal' },
        },
      },
      directors: {
        type: 'array',
        description: 'Active directors / members / trustees as listed on the document.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Full name (First Middle Last)' },
            idNumber: { type: 'string', description: '13-digit RSA ID number, digits only' },
            role: { type: 'string', description: 'Director / Member / Trustee / Public Officer' },
            appointmentDate: { type: 'string', description: 'ISO date YYYY-MM-DD if shown' },
          },
        },
      },
    },
  },
};

// SA ID document — green ID book, smart-ID card, or ID copy. Used to
// confirm the signatory's identity. The drafter fills section 1.2's
// signatory name and 13-digit ID.
const ID_DOCUMENT_TOOL = {
  name: 'submit_id_data',
  description: 'Extract identifying fields from a South African ID document (green book, smart card, passport).',
  input_schema: {
    type: 'object',
    properties: {
      signatory: {
        type: 'object',
        properties: {
          fullName: { type: 'string', description: 'Surname, Given names — formatted as "Given Names Surname"' },
          surname: { type: 'string' },
          givenNames: { type: 'string' },
          idNumber: { type: 'string', description: '13-digit RSA ID number; digits only, no spaces' },
          dateOfBirth: { type: 'string', description: 'ISO YYYY-MM-DD' },
          gender: { type: 'string', description: 'M | F' },
          citizenship: { type: 'string', description: 'SA Citizen | Permanent Resident | etc.' },
          nationality: { type: 'string' },
          documentType: { type: 'string', description: 'Green ID Book | Smart ID Card | Passport | Asylum' },
        },
      },
    },
  },
};

// SARS Tax Clearance Certificate / Tax Compliance Status (TCS) PIN letter.
// Pulls VAT number + tax-clearance reference for inclusion in the lease.
const TAX_TOOL = {
  name: 'submit_tax_data',
  description: 'Extract VAT and tax-clearance fields from a SARS tax document (Tax Clearance Certificate or Tax Compliance Status PIN letter).',
  input_schema: {
    type: 'object',
    properties: {
      tenant: {
        type: 'object',
        properties: {
          taxpayerName: { type: 'string', description: 'Registered taxpayer name (should match tenant company name)' },
          vatNumber: { type: 'string', description: 'VAT registration number — 10 digits, usually starts with 4' },
          taxNumber: { type: 'string', description: 'Income-tax reference number — typically 10 digits' },
          taxClearanceRef: { type: 'string', description: 'TCS reference / PIN / certificate number' },
          status: { type: 'string', description: 'Compliant | Non-Compliant | Unknown' },
          issuedDate: { type: 'string', description: 'ISO YYYY-MM-DD' },
          validUntil: { type: 'string', description: 'ISO YYYY-MM-DD if shown' },
        },
      },
    },
  },
};

// Route Claude calls through the backend proxy so the API key never
// touches the browser. The proxy server-side reads the stored key from
// the secrets vault and forwards to api.anthropic.com.
const callClaudeTool = async ({ model, tool, systemPrompt, userText }) => {
  const res = await api.proxy.anthropicMessages({
    model: model || 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    system: systemPrompt,
    messages: [{ role: 'user', content: userText }],
  });
  const block = (res.content || []).find(b => b.type === 'tool_use');
  if (!block) throw new Error('Claude did not return a structured tool_use response');
  return block.input || {};
};

const parseLeaseControlPdf = async (pdfText, model) => callClaudeTool({
  model, tool: LEASE_CONTROL_TOOL,
  systemPrompt: [
    'You extract fields from a South African commercial Lease Control Schedule.',
    '',
    'THE DOCUMENT IS STRUCTURED AS A SCHEDULE OF PARTICULARS — every party has an explicit numbered heading. Use the headings as the source of truth:',
    '  • "1.1 THE LANDLORD" / "LANDLORD" → landlord block',
    '  • "1.2 THE TENANT" / "TENANT" → tenant block',
    '  • "1.3" through "1.8" → premises block',
    '  • "1.9 INITIAL PERIOD OF LEASE" → initialPeriod block',
    '  • "1.10 OPTION PERIOD OF LEASE" → optionPeriod block',
    '  • "1.11 SURETIES" / "SURETY" → surety block',
    '  • "1.12 MONTHLY RENTAL" → monthlyRental block (first row\'s "BASIC RENT EXCL. VAT" → yearOneRent, "ESCALATION" or annual % → escalationRate)',
    '  • "1.13 DEPOSIT" → deposit.amount',
    '  • "1.14" → turnover block',
    '  • "1.15 ADVERTISING" → advertising.contribution',
    '  • "1.16/1.17 LEASE FEES" → leaseFees.amount',
    '',
    'EXTRACT EVERY FIELD YOU CAN FIND for both parties. Specifically for the TENANT, look for and extract: company name, registration number, VAT number (or "TBA" if shown that way), physical/postal address (multi-line OK), phone, email, and contact person. The tenant section often spans multiple lines with these labels.',
    '',
    'ABSOLUTE RULES:',
    '  • If a value is under "1.1 THE LANDLORD", it is a LANDLORD field. Never put it in tenant.',
    '  • If a value is under "1.2 THE TENANT", it is a TENANT field. Never put it in landlord.',
    '  • If a value is under "1.11 SURETIES", it is a SURETY field. Never put it in tenant or landlord.',
    '  • Omit any field you cannot find — never invent or guess.',
    '  • Dates: ISO YYYY-MM-DD. Numbers: plain digits, no currency symbols, no thousand separators. Account/branch codes: digits only.',
  ].join('\n'),
  userText: `Extract every field you can find from this Lease Control Schedule. Pay particular attention to section 1.2 THE TENANT — extract the tenant's company name, registration number, VAT number, address, phone, email, and contact person if present.\n\n${pdfText}`,
});

const parseCipcPdf = async (pdfText, model) => callClaudeTool({
  model, tool: CIPC_TOOL,
  systemPrompt: [
    'You extract structured data from a South African CIPC company registration / disclosure document.',
    '',
    'EXTRACT:',
    '  • The registered company name, registration number (YYYY/NNNNNN/NN), entity type, status, principal/postal addresses.',
    '  • All active directors / members / trustees with their full names, 13-digit RSA ID numbers, role, and appointment dates.',
    '',
    'RULES:',
    '  • IDs: 13 digits, no spaces.',
    '  • Dates: ISO YYYY-MM-DD.',
    '  • Omit any field you cannot find with high confidence.',
    '  • If a director is listed as "Resigned" or no longer active, OMIT them.',
  ].join('\n'),
  userText: `Extract company and active-director details from this CIPC document.\n\n${pdfText}`,
});

const parseIdPdf = async (pdfText, model) => callClaudeTool({
  model, tool: ID_DOCUMENT_TOOL,
  systemPrompt: [
    'You extract identity fields from a South African ID document (green book, smart-card ID, or passport).',
    '',
    'RULES:',
    '  • idNumber must be exactly 13 digits with NO spaces.',
    '  • Build fullName as "Given Names Surname" (e.g. "Wayne Marks" from surname=MARKS, names=WAYNE).',
    '  • Date of birth ISO YYYY-MM-DD.',
    '  • Omit fields you cannot find.',
  ].join('\n'),
  userText: `Extract the holder's identity details from this ID document.\n\n${pdfText}`,
});

const parseTaxPdf = async (pdfText, model) => callClaudeTool({
  model, tool: TAX_TOOL,
  systemPrompt: [
    'You extract tax-registration details from a SARS Tax Clearance Certificate or Tax Compliance Status PIN letter.',
    '',
    'RULES:',
    '  • VAT number: 10 digits, usually starts with 4.',
    '  • Tax/Income-tax reference: 10 digits.',
    '  • Dates ISO YYYY-MM-DD.',
    '  • Omit anything you cannot read with high confidence.',
  ].join('\n'),
  userText: `Extract the taxpayer's tax-registration details from this SARS document.\n\n${pdfText}`,
});

const parseInvoicePdf = async (pdfText, model) => callClaudeTool({
  model, tool: INVOICE_TOOL,
  systemPrompt: [
    'You extract structured data from South African commercial lease tax invoices.',
    '',
    'INVOICE LAYOUT FOR THIS USER:',
    '  • The LANDLORD\'s identity (company name, address, phone, registration number, VAT number) is printed in the TOP-RIGHT of the page.',
    '  • The LANDLORD\'s banking details are printed in a separate banking block lower on the page (labelled BANKING DETAILS / EFT DETAILS / PAYMENT DETAILS / BANK DETAILS).',
    '  • The TENANT is the "Bill To" / "Invoice To" / "Customer" block (usually middle-left). You must NOT extract any tenant information. The schema you are calling has NO tenant fields — only landlord, deposit, and utilities.',
    '',
    'RULES:',
    '  1. ONLY extract landlord identity from the TOP-RIGHT region of the page.',
    '  2. The BANKING block is REQUIRED — every SA commercial invoice has one. Look for any of these labels: BANKING DETAILS, EFT DETAILS, PAYMENT DETAILS, BANK DETAILS, BANK INFO, FOR PAYMENT, EFT BANKING. It is usually at the FOOTER of the invoice, below the line-items.',
    '  3. From the banking block ALWAYS try to populate ALL FOUR fields: bankName, bankBranch, accountNumber, branchCode. Common SA banks: FNB / First National Bank, Standard Bank, Absa, Nedbank, Capitec, Investec.',
    '  4. branchCode is usually a 6-digit number labelled "Branch Code" / "Sort Code" / "Universal Branch Code". If the invoice gives only one number under "Branch", that is the branch CODE (digits) — leave bankBranch (name) blank if only the code is shown.',
    '  5. accountNumber: digits only, no spaces or hyphens. Strip any "A/C No:" or "Acc:" prefix.',
    '  6. Treat the "Bill To" / "Invoice To" / "Customer" block as if it does not exist. Never extract any field from there.',
    '  7. If you cannot confidently identify the landlord in the top-right, OMIT the landlord identity fields entirely. Do not fall back to the "Bill To" company. (But still try to extract the banking block — it stands alone.)',
    '  8. Deposit: amount in Rands from a line item labelled DEPOSIT / SECURITY DEPOSIT / REFUNDABLE DEPOSIT.',
    '  9. Utilities: electricity, sewerage/water, refuse, rates if shown as separate line items.',
    '',
    'FORMATTING:',
    '  • Money: plain numbers, no R, no commas, no thousand separators (e.g. 12345.67).',
    '  • Dates: ISO YYYY-MM-DD.',
    '  • Multi-line addresses: join with comma+space.',
    '  • Account numbers and branch codes: digits only, no spaces or hyphens.',
    '',
    'Return ONLY fields you can read with high confidence — but treat banking-block fields as high-priority and do not omit them just because the layout is messy. Lines from a multi-column PDF may interleave; reconstruct the banking block from any labelled fragments you can identify.',
  ].join('\n'),
  userText: `Extract landlord identity, landlord banking details, deposit, and utility line items from this invoice.\n\nReminder: The landlord is in the TOP-RIGHT. The "Bill To" / "Customer" block is the tenant — IGNORE it completely.\n\nThe BANKING DETAILS block is mandatory on SA commercial invoices — look in the footer. Extract bankName, bankBranch, accountNumber AND branchCode whenever any of them are present.\n\n${pdfText}`,
});

// ----- Merge parsed JSON into form, skipping dirty fields -----
// Returns { mergedForm, filledPaths, skipped } where:
//   filledPaths — dotted paths actually written (used to flash UI)
//   skipped — diagnostic record of paths that were NOT written, with the reason
const mergeParsedIntoForm = (form, parsed, dirtyPaths) => {
  const filled = [];
  const skipped = [];
  const isDirty = (path) => dirtyPaths.has(path);
  const next = { ...form };

  const capitalise = (v) => (typeof v === 'string' ? v.toUpperCase() : v);

  const setIfBlank = (objPath, key, value) => {
    const fullPath = `${objPath}.${key}`;
    if (value == null || value === '') { skipped.push({ path: fullPath, reason: 'parsed value is empty', value }); return; }
    if (isDirty(fullPath)) { skipped.push({ path: fullPath, reason: 'field marked dirty (user edited)', value }); return; }
    const parts = objPath.split('.');
    let ref = next;
    for (let i = 0; i < parts.length; i++) {
      ref[parts[i]] = { ...ref[parts[i]] };
      ref = ref[parts[i]];
    }
    const current = ref[key];
    const isEmpty = current === '' || current === 0 || current == null || current === 'N/A' || current === 'TBA';
    if (!isEmpty) { skipped.push({ path: fullPath, reason: 'field already has a value', current, value }); return; }
    ref[key] = capitalise(value);
    filled.push(fullPath);
  };

  const walk = (parsedObj, prefix) => {
    if (!parsedObj || typeof parsedObj !== 'object') return;
    for (const [key, value] of Object.entries(parsedObj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, prefix ? `${prefix}.${key}` : key);
      } else {
        setIfBlank(prefix, key, value);
      }
    }
  };

  walk(parsed, '');

  // Special case: Year 1 rent maps into monthlyRental.years[0].basicRentExVat
  // (numbers stored as strings; no uppercase needed for digits)
  if (parsed?.monthlyRental?.yearOneRent != null && !isDirty('monthlyRental.years.0.basicRentExVat')) {
    const yrs = [...(next.monthlyRental.years || [])];
    if (yrs[0]) {
      yrs[0] = { ...yrs[0], basicRentExVat: String(parsed.monthlyRental.yearOneRent) };
      next.monthlyRental = { ...next.monthlyRental, years: yrs };
      filled.push('monthlyRental.years.0.basicRentExVat');
    }
  }

  return { mergedForm: next, filledPaths: filled, skipped };
};

// Pure function: form state → docxtemplater token object matching the
// lease-template.docx in public/. Every token is a pre-formatted string,
// except `sureties` (array) and `rentalSchedule` (array of sub-objects).
const buildLeaseData = (form) => {
  const naOr = (v) => {
    if (v == null) return 'N/A';
    const s = String(v).trim();
    return s === '' ? 'N/A' : s;
  };
  const upper = (v) => (v || '').toString().toUpperCase();
  // Recursively uppercase every string in an object/array.
  // Numbers, booleans, null, and already-uppercase content pass through unchanged.
  const deepUpper = (val) => {
    if (val == null) return val;
    if (typeof val === 'string') return val.toUpperCase();
    if (Array.isArray(val)) return val.map(deepUpper);
    if (typeof val === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(val)) out[k] = deepUpper(v);
      return out;
    }
    return val;
  };

  // Money: "R " + space-grouped thousands + dot decimal + 2dp
  const fmtR = (n) => {
    const num = Number(n);
    if (!isFinite(num)) return 'R 0.00';
    const [int, dec] = num.toFixed(2).split('.');
    return `R ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${dec}`;
  };
  const fmtSlash = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };
  const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

  // Rental schedule: escalate Year 1 rent annually; each row's From = previous
  // row's To + 1 day; To = +12 months − 1 day, capped at termination.
  const escalation = (Number(form.monthlyRental?.escalationRate) || 0) / 100;
  const year1Rent = Number(form.monthlyRental?.years?.[0]?.basicRentExVat) || 0;
  const initialYears = Number(form.initialPeriod?.years) || 0;
  const initialMonths = Number(form.initialPeriod?.months) || 0;
  const totalMonths = initialYears * 12 + initialMonths;
  const numYears = Math.max(1, Math.ceil(totalMonths / 12));
  const commencement = form.initialPeriod?.commencementDate ? new Date(form.initialPeriod.commencementDate) : null;
  const termination = form.initialPeriod?.terminationDate ? new Date(form.initialPeriod.terminationDate) : null;

  const rentalSchedule = [];
  let cursor = commencement ? new Date(commencement) : null;
  for (let i = 0; i < numYears; i++) {
    const rent = year1Rent ? Math.round(year1Rent * Math.pow(1 + escalation, i) * 100) / 100 : 0;
    const vat = Math.round(rent * 0.15 * 100) / 100;
    const inc = Math.round((rent + vat) * 100) / 100;
    let fromDate = cursor ? new Date(cursor) : null;
    let toDate = null;
    if (fromDate) {
      toDate = new Date(fromDate);
      toDate.setFullYear(toDate.getFullYear() + 1);
      toDate.setDate(toDate.getDate() - 1);
      if (termination && toDate > termination) toDate = new Date(termination);
      cursor = addDays(toDate, 1);
    }
    rentalSchedule.push({
      basicRentExclVat: fmtR(rent),
      vatAmount: fmtR(vat),
      basicRentInclVat: fmtR(inc),
      refuse: '–',
      rates: '–',
      fromDate: fromDate ? fmtSlash(fromDate.toISOString()) : '',
      toDate: toDate ? fmtSlash(toDate.toISOString()) : '',
    });
  }

  const annexuresList = (form.annexures || [])
    .filter(a => form.annexureSelected?.[a])
    .map(a => `"${a}"`)
    .join(';');

  // Each surety carries both Part A field names (name / idNumber / address)
  // AND Part B alias names (suretyName / suretyIdNumber) so the same array
  // works in both templates' {#sureties} loops without renaming.
  const suretyMap = (s) => ({
    name: upper(s.name),
    idNumber: s.idNumber || '',
    address: s.address || '',
    suretyName: upper(s.name),
    suretyIdNumber: s.idNumber || '',
  });
  const sureties = !form.suretyRequired
    ? [{ ...suretyMap({ name: 'N/A', idNumber: 'N/A', address: 'N/A' }) }]
    : [form.surety]
        .filter(s => s && (s.name || s.idNumber || s.address))
        .map(suretyMap);

  const depositNum = Number(form.deposit?.amount) || 0;
  const depositText = depositNum > 0
    ? `${fmtR(depositNum)} – DEPOSIT PAYABLE UPON SIGNATURE OF LEASE AGREEMENT`
    : 'N/A';

  // Beneficial Occupation — only include if explicitly enabled by the user.
  // When disabled, both the `beneficialOccupation` row (conditional in the
  // template) and the `beneficialOccupationPeriod` label render as N/A.
  const bo = form.beneficialOccupation;
  const boEnabled = !!bo?.enabled;
  const boExVat = Number(bo?.amountExVat) || 0;
  const boVat = boExVat * 0.15;
  const boIncVat = boExVat + boVat;
  const beneficialOccupation = boEnabled ? {
    boExclVat: fmtR(boExVat),
    boVat: fmtR(boVat),
    boInclVat: fmtR(boIncVat),
    boRefuse: '–',
    boRates: '–',
    boFromDate: fmtSlash(bo.fromDate),
    boToDate: fmtSlash(bo.toDate),
  } : null;
  const beneficialOccupationPeriod = boEnabled && (bo.fromDate || bo.toDate)
    ? `${fmtSlash(bo.fromDate) || '__/__/____'} – ${fmtSlash(bo.toDate) || '__/__/____'}`
    : 'N/A';

  const measurement = form.premises?.rentableArea
    ? `${upper(form.premises?.permittedUse || form.premises?.unitNumber || 'PREMISES')} = ${Number(form.premises.rentableArea).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}m²`
    : 'N/A';

  const result = deepUpper({
    landlordName: upper(form.landlord?.name),
    landlordTel: form.landlord?.phone || '',
    landlordFax: form.landlord?.fax || '',
    landlordRegNo: form.landlord?.registrationNumber || '',
    landlordVatNo: form.landlord?.vatNumber || '',
    landlordBankDetails: `${form.landlord?.bankName || ''}, A/C NO: ${form.landlord?.accountNumber || ''}, BRANCH NO: ${form.landlord?.branchCode || ''}, ${form.landlord?.bankBranch || ''}`.replace(/^,\s*/, '').trim(),

    tenantName: upper(form.tenant?.companyName),
    tenantRegNo: form.tenant?.registrationNumber || '',
    tenantVatNo: form.tenant?.vatNumber || 'TBA',
    tenantPostalAddress: form.tenant?.address || '',
    tenantPhysicalAddress: form.tenant?.address || '',
    tenantKnownAs: upper(form.tenant?.companyName),

    // ---- Part B (Standard Conditions + Annexures) tokens ----
    // Entity type determines the resolution wording (DIRECTORS / MEMBERS / TRUSTEES)
    tenantEntityHolders: (() => {
      const t = (form.tenant?.entityType || 'Company').toLowerCase();
      if (t === 'cc' || t.includes('close')) return 'MEMBERS';
      if (t === 'trust' || t.includes('trust')) return 'TRUSTEES';
      return 'DIRECTORS';
    })(),
    signatoryName: upper(form.tenant?.signatoryName),
    signatoryIdNumber: form.tenant?.signatoryIdNumber || '',
    signatoryRole: form.tenant?.signatoryRole || 'Director',
    signatoryPronoun: form.tenant?.signatoryPronoun || 'his',

    premisesDescription: upper(form.premises?.permittedUse || form.premises?.unitNumber),
    buildingName: upper(form.premises?.buildingName),
    buildingAddress: upper(form.premises?.buildingAddress),
    premisesMeasurement: measurement,
    proportionateShare: form.premises?.parkingRatio
      ? `${Number(form.premises.parkingRatio).toFixed(3)}%`
      : '0.000%',
    permittedUse: upper(form.premises?.permittedUse),

    initialYears: String(initialYears),
    initialMonths: String(initialMonths),
    beneficialOccupationPeriod,
    commencementDate: fmtSlash(form.initialPeriod?.commencementDate),
    terminationDate: fmtSlash(form.initialPeriod?.terminationDate),

    optionExerciseBy: fmtSlash(form.optionPeriod?.exerciseBy),
    optionYears: String(form.optionPeriod?.years || 0),
    optionMonths: String(form.optionPeriod?.months || 0),

    depositText,
    turnoverPercentage: naOr(form.turnover?.percentage),
    financialYearEnd: naOr(form.turnover?.financialYearEnd),
    minTurnover: naOr(form.turnover?.minimumTurnoverRequirement),
    advertisingContribution: naOr(form.advertising?.contribution),
    tenantBankDetails: naOr(form.tenantBankDetails),
    stampDuty: 'N/A',
    leaseFees: fmtR(form.leaseFees?.amount),
    annexures: annexuresList,

    sureties,
    rentalSchedule,
    // beneficialOccupation: present (object) → conditional row renders;
    //                       null            → conditional row is stripped.
    ...(beneficialOccupation ? { beneficialOccupation } : {}),
  });

  // DocuSign anchor strings — these get embedded LITERALLY at signature spots
  // in the lease template via docxtemplater placeholders. Kept outside the
  // deepUpper call so the anchors survive verbatim — DocuSign matches them
  // byte-for-byte to locate signature fields.
  //
  // Required template placeholders (add to lease-template.docx / part-b-template.docx
  // at every signature spot):
  //   {landlord_sig_anchor}   {landlord_date_anchor}   {landlord_name_anchor}   {landlord_init_anchor}
  //   {tenant_sig_anchor}     {tenant_date_anchor}     {tenant_name_anchor}     {tenant_init_anchor}
  //   {surety_1_sig_anchor}   {surety_1_date_anchor}   {surety_1_name_anchor}   {surety_1_init_anchor}
  //   {witness_1_sig_anchor}  {witness_1_date_anchor}  {witness_1_name_anchor}
  //
  // The placeholder text in the rendered DOCX will be e.g. "\sig_landlord\".
  // DocuSign finds that string and places a sign-here field at that location.
  Object.assign(result, {
    landlord_sig_anchor:   DOCUSIGN_ANCHORS.landlord.signature,
    landlord_date_anchor:  DOCUSIGN_ANCHORS.landlord.date,
    landlord_name_anchor:  DOCUSIGN_ANCHORS.landlord.name,
    landlord_init_anchor:  DOCUSIGN_ANCHORS.landlord.initials,
    tenant_sig_anchor:     DOCUSIGN_ANCHORS.tenant.signature,
    tenant_date_anchor:    DOCUSIGN_ANCHORS.tenant.date,
    tenant_name_anchor:    DOCUSIGN_ANCHORS.tenant.name,
    tenant_init_anchor:    DOCUSIGN_ANCHORS.tenant.initials,
  });
  for (let i = 0; i < sureties.length; i++) {
    const s = DOCUSIGN_ANCHORS.surety(i + 1);
    result[`surety_${i + 1}_sig_anchor`]   = s.signature;
    result[`surety_${i + 1}_date_anchor`]  = s.date;
    result[`surety_${i + 1}_name_anchor`]  = s.name;
    result[`surety_${i + 1}_init_anchor`]  = s.initials;
  }
  // Two witness slots (typical lease) — present even if not used so the
  // template renders blank text in their place.
  for (let i = 1; i <= 2; i++) {
    const w = DOCUSIGN_ANCHORS.witness(i);
    result[`witness_${i}_sig_anchor`]  = w.signature;
    result[`witness_${i}_date_anchor`] = w.date;
    result[`witness_${i}_name_anchor`] = w.name;
  }

  return result;
};

// Dropzone for Lease Control / Invoice PDFs. Supports drag-and-drop and
// click-to-browse. Renders loading / success / error states inline.
const PdfDropzone = ({ kind, state, error, filename, aiReady, onFile, onNavigateToSettings }) => {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(kind, file);
  };
  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (file) onFile(kind, file);
    e.target.value = ''; // allow re-selecting the same file
  };

  const baseStyle = {
    border: `2px dashed ${state === 'error' ? brand.danger : over ? brand.gold : brand.border}`,
    backgroundColor: state === 'success' ? brand.successLight : state === 'error' ? brand.dangerLight : '#FAFAF6',
    cursor: aiReady ? 'pointer' : 'not-allowed',
    transition: 'border-color 150ms, background-color 150ms',
  };

  return (
    <div
      onClick={() => aiReady && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (aiReady) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => aiReady && onDrop(e)}
      className="rounded p-4 text-center"
      style={baseStyle}
    >
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onPick} />
      {state === 'loading' ? (
        <>
          <RefreshCw size={20} style={{ color: brand.gold }} className="mx-auto mb-1 animate-spin" />
          <p className="text-[11px]" style={{ color: brand.text }}>Parsing {filename || 'PDF'}…</p>
        </>
      ) : state === 'success' ? (
        <>
          <CheckCircle2 size={20} style={{ color: brand.success }} className="mx-auto mb-1" />
          <p className="text-[11px] font-medium" style={{ color: brand.success }}>{filename}</p>
          <p className="text-[10px] mt-1" style={{ color: brand.textMuted }}>Drop another to re-fill</p>
        </>
      ) : state === 'error' ? (
        <>
          <AlertCircle size={20} style={{ color: brand.danger }} className="mx-auto mb-1" />
          <p className="text-[11px] font-medium" style={{ color: brand.danger }}>{filename}</p>
          <p className="text-[10px] mt-1" style={{ color: brand.danger }}>{(error || '').slice(0, 80)}</p>
          <p className="text-[10px] mt-1" style={{ color: brand.textMuted }}>Drop again to retry</p>
        </>
      ) : aiReady ? (
        <>
          <Upload size={20} style={{ color: brand.textMuted }} className="mx-auto mb-1" />
          <p className="text-[11px]" style={{ color: brand.textMuted }}>Drop PDF here or click to browse</p>
          <span className="inline-block mt-2 px-2 py-0.5 text-[10px] rounded font-medium" style={{ backgroundColor: brand.successLight, color: brand.success }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: brand.success, verticalAlign: 'middle' }} />
            Live
          </span>
        </>
      ) : (
        <>
          <Lock size={20} style={{ color: brand.textMuted }} className="mx-auto mb-1" />
          <p className="text-[11px]" style={{ color: brand.textMuted }}>Configure Claude API to enable</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNavigateToSettings?.(); }}
            className="inline-block mt-2 px-2 py-0.5 text-[10px] rounded font-medium underline"
            style={{ color: brand.gold }}
          >
            Open Settings → Integrations
          </button>
        </>
      )}
    </div>
  );
};

const LeaseDrafter = ({ open, onClose, currentUser, showToast, logAction, integrations, debtors = [], onNavigateToSettings }) => {
  const [form, setForm] = useState(() => blankLeaseForm());
  const [dirtyPaths, setDirtyPaths] = useState(() => new Set());
  const [flashPaths, setFlashPaths] = useState(() => new Set());
  const [uploadState, setUploadState] = useState({ leaseControl: 'idle', invoice: 'idle', cipc: 'idle', id: 'idle', tax: 'idle' }); // idle | loading | success | error
  const [uploadError, setUploadError] = useState({ leaseControl: null, invoice: null, cipc: null, id: null, tax: null });
  const [uploadedName, setUploadedName] = useState({ leaseControl: null, invoice: null, cipc: null, id: null, tax: null });
  const anthropicCfg = integrations?.anthropic || {};
  // API key lives in the server vault — query it to decide if AI is available.
  const [anthropicHasKey, setAnthropicHasKey] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.secrets.get('anthropic')
      .then(rows => { if (!cancelled) setAnthropicHasKey(!!rows.find(r => r.key === 'apiKey' && r.hasValue)); })
      .catch(() => { if (!cancelled) setAnthropicHasKey(false); });
    return () => { cancelled = true; };
  }, []);
  const aiReady = anthropicHasKey;

  // Bad-payer lookup: compare the tenant company name typed into 1.2 against
  // the imported debtors list. Triggers a warning banner above section 1.2.
  const badPayerMatch = useMemo(() => {
    const match = findDebtorByTenant(debtors, form.tenant?.companyName);
    if (!match) return null;
    const flag = computeDebtorFlag(match);
    return flag === 'OK' ? null : { debtor: match, flag };
  }, [debtors, form.tenant?.companyName]);
  const [badPayerAcknowledged, setBadPayerAcknowledged] = useState(false);

  // Reset acknowledgement if the tenant name changes
  useEffect(() => { setBadPayerAcknowledged(false); }, [form.tenant?.companyName]);

  // Log when a bad-payer warning is first shown for the current tenant
  const lastWarnedTenantRef = useRef(null);
  useEffect(() => {
    if (badPayerMatch && lastWarnedTenantRef.current !== form.tenant?.companyName) {
      lastWarnedTenantRef.current = form.tenant?.companyName;
      logAction(`Bad-payer warning shown for tenant "${form.tenant?.companyName}" (${badPayerMatch.flag})`);
    }
  }, [badPayerMatch, form.tenant?.companyName]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drafts, setDrafts] = useStoredState('ep:leaseDrafts', []);
  const [history, setHistory] = useStoredState('ep:leaseHistory', []);
  const [savedLeases, setSavedLeases] = useStoredState('ep:leaseSaved', []);
  const [landlordDefaults, setLandlordDefaults] = useStoredState('ep:landlordDefaults', null);

  // Modal state
  const [draftsModalOpen, setDraftsModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [generating, setGenerating] = useState(null); // null | 'pdf' | 'word'

  // On open, optionally seed landlord from defaults if landlord is blank
  useEffect(() => {
    if (open && landlordDefaults && !form.landlord.name) {
      setForm(f => ({ ...f, landlord: { ...landlordDefaults, saveAsDefault: false } }));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resize year cards when initialPeriod.years changes
  useEffect(() => {
    const targetYears = Math.max(1, Number(form.initialPeriod.years) || 1);
    if (form.monthlyRental.years.length === targetYears) return;
    setForm(f => {
      const cur = f.monthlyRental.years;
      let next;
      if (cur.length < targetYears) {
        next = [...cur, ...Array.from({ length: targetYears - cur.length }, (_, i) => blankYearRental(cur.length + i + 1))];
      } else {
        next = cur.slice(0, targetYears);
      }
      return { ...f, monthlyRental: { ...f.monthlyRental, years: next } };
    });
  }, [form.initialPeriod.years]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-calculate termination date when commencement / years / months change
  useEffect(() => {
    const { commencementDate, years, months, terminationOverride } = form.initialPeriod;
    if (terminationOverride || !commencementDate) return;
    const totalMonths = (Number(years) || 0) * 12 + (Number(months) || 0);
    const calc = addMonths(commencementDate, totalMonths);
    if (calc !== form.initialPeriod.terminationDate) {
      setForm(f => ({ ...f, initialPeriod: { ...f.initialPeriod, terminationDate: calc } }));
    }
  }, [form.initialPeriod.commencementDate, form.initialPeriod.years, form.initialPeriod.months, form.initialPeriod.terminationOverride]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-calculate From / To dates per year
  useEffect(() => {
    const start = form.initialPeriod.commencementDate;
    if (!start) return;
    setForm(f => {
      const updated = f.monthlyRental.years.map((y, idx) => {
        const from = addYearsToDate(start, idx);
        const to = addMonths(from, 12);
        if (y.from === from && y.to === to) return y;
        return { ...y, from, to };
      });
      return { ...f, monthlyRental: { ...f.monthlyRental, years: updated } };
    });
  }, [form.initialPeriod.commencementDate, form.monthlyRental.years.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helpers to update nested form state. Every manual edit marks its path
  // as dirty so PDF auto-populate won't overwrite it.
  const upd = (path, value) => {
    setForm(f => {
      const next = { ...f };
      const keys = path.split('.');
      let ref = next;
      for (let i = 0; i < keys.length - 1; i++) {
        ref[keys[i]] = { ...ref[keys[i]] };
        ref = ref[keys[i]];
      }
      ref[keys[keys.length - 1]] = value;
      return next;
    });
    setDirtyPaths(prev => { const n = new Set(prev); n.add(path); return n; });
  };

  const updYear = (idx, field, value) => {
    setForm(f => {
      const years = f.monthlyRental.years.map((y, i) => {
        if (i !== idx) return y;
        return { ...y, [field]: value, overridden: { ...y.overridden, [field]: true } };
      });
      return { ...f, monthlyRental: { ...f.monthlyRental, years } };
    });
    setDirtyPaths(prev => { const n = new Set(prev); n.add(`monthlyRental.years.${idx}.${field}`); return n; });
  };

  // Auto-escalate Year 2+ rent and security from Year 1 unless overridden
  useEffect(() => {
    const esc = Number(form.monthlyRental.escalationRate) || 0;
    const factor = 1 + esc / 100;
    const y1 = form.monthlyRental.years[0];
    if (!y1) return;
    const y1Rent = Number(y1.basicRentExVat) || 0;
    const y1Sec = Number(y1.securityExVat) || 0;
    setForm(f => {
      const years = f.monthlyRental.years.map((y, idx) => {
        if (idx === 0) return y;
        const newRent = y.overridden.basicRentExVat ? y.basicRentExVat : (y1Rent ? (y1Rent * Math.pow(factor, idx)).toFixed(2) : '');
        const newSec = y.overridden.securityExVat ? y.securityExVat : (y1Sec ? (y1Sec * Math.pow(factor, idx)).toFixed(2) : '');
        return { ...y, basicRentExVat: newRent, securityExVat: newSec };
      });
      return { ...f, monthlyRental: { ...f.monthlyRental, years } };
    });
  }, [form.monthlyRental.years[0]?.basicRentExVat, form.monthlyRental.years[0]?.securityExVat, form.monthlyRental.escalationRate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Actions ----
  const handleSaveDraft = () => {
    const id = form.meta.draftId || `draft-${Date.now()}`;
    const nameLabel = form.tenant.companyName || form.premises.buildingName || 'Untitled lease';
    const updatedForm = { ...form, meta: { ...form.meta, draftId: id, updatedAt: new Date().toISOString(), createdAt: form.meta.createdAt || new Date().toISOString() } };
    setForm(updatedForm);
    setDrafts(prev => {
      const existing = prev.findIndex(d => d.id === id);
      const entry = { id, label: nameLabel, savedAt: new Date().toISOString(), form: updatedForm };
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = entry;
        return next;
      }
      return [entry, ...prev];
    });
    if (form.landlord.saveAsDefault) {
      const { saveAsDefault, ...rest } = form.landlord;
      setLandlordDefaults(rest);
    }
    logAction(`Saved lease draft: ${nameLabel}`);
    showToast('Draft saved', 'success');
  };

  const handleRestoreDraft = (draft) => {
    setForm(draft.form);
    setDraftsModalOpen(false);
    showToast(`Restored draft: ${draft.label}`, 'success');
  };

  const handleDeleteDraft = (id) => {
    setDrafts(prev => prev.filter(d => d.id !== id));
    showToast('Draft deleted', 'success');
  };

  const handleClear = () => {
    setForm(blankLeaseForm());
    setClearConfirmOpen(false);
    logAction('Cleared lease draft form');
    showToast('Form cleared', 'success');
  };

  const handleSaveLease = () => {
    const id = `lease-${Date.now()}`;
    const label = form.tenant.companyName || form.premises.buildingName || 'Untitled lease';
    const entry = { id, label, savedAt: new Date().toISOString(), form: { ...form, meta: { ...form.meta, updatedAt: new Date().toISOString() } } };
    setSavedLeases(prev => [entry, ...prev]);
    setHistory(prev => [{ id: `h-${Date.now()}`, action: 'Finalised lease', label, at: new Date().toISOString() }, ...prev].slice(0, 100));
    logAction(`Finalised lease: ${label}`);
    showToast('Lease saved', 'success');
  };

  const handleRestoreSaved = (saved) => {
    setForm(saved.form);
    setSavedModalOpen(false);
    showToast(`Loaded lease: ${saved.label}`, 'success');
  };

  const filename = () => {
    const sanitize = (s) => (s || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    const tenant = sanitize(form.tenant.companyName) || 'Tenant';
    const building = sanitize(form.premises.buildingName) || 'Building';
    const d = form.initialPeriod.commencementDate ? new Date(form.initialPeriod.commencementDate) : new Date();
    const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `Lease_${tenant}_${building}_${yyyymmdd}`;
  };

  // PDF generation removed — DOCX is the single source of truth now.
  // Open the generated .docx in Word and Print-to-PDF if a PDF is needed.

  // Convenience: render + download a single template as its own .docx.
  // Used by the debug "Part A only" / "Part B only" buttons.
  const generateSinglePart = async (which) => {
    setGenerating(which);
    try {
      const { saveAs } = await import('file-saver');
      const data = buildLeaseData(form);
      const dataPartB = { ...data, sureties: form.suretyRequired ? data.sureties : [] };

      let blob;
      let suffix;
      if (which === 'partA') {
        blob = await renderPart('/lease-template.docx', data, { patchRentalSchedule: true });
        suffix = 'PartA';
      } else {
        blob = await renderPart('/part-b-template.docx', dataPartB, {
          postProcess: form.suretyRequired ? null : stripSuretyAnnexureFromXml,
        });
        suffix = 'PartB';
      }
      saveAs(blob, `${filename()}_${suffix}.docx`);
      logAction(`Generated lease ${suffix} (debug): ${form.tenant.companyName || 'Unnamed'}`);
      showToast(`${suffix} downloaded`, 'success');
    } catch (err) {
      const msg = err?.properties?.errors
        ? err.properties.errors.map(e => `${e.id || ''} ${e.message || e}`).join('; ')
        : err.message || String(err);
      // eslint-disable-next-line no-console
      console.error(`[Lease gen ${which}] failed:`, err);
      showToast(`${which === 'partA' ? 'Part A' : 'Part B'} failed: ${msg.slice(0, 100)}`, 'error');
    } finally {
      setGenerating(null);
    }
  };

  // Post-process Part B's rendered XML when surety isn't required:
  // 1. Strip the orphaned "ANNEXURE A — DEED OF SURETYSHIP" title section
  //    AND the index entry for it (both contain "DEED OF SURETYSHIP" or are
  //    paragraphs equal to just "ANNEXURE A").
  // 2. Shift every remaining "ANNEXURE [B-G]" reference down by 1 — using a
  //    text-node mapping so the shift works even when Word has split the
  //    "ANNEXURE" word and the letter across separate <w:r> runs.
  const stripSuretyAnnexureFromXml = (xml) => {
    const _initialLen = xml.length;
    const _initialDeed = (xml.match(/deed/gi) || []).length;
    const _initialSurety = (xml.match(/suretyship/gi) || []).length;
    // ---- Step A: strip paragraphs that belong to the Suretyship section ----
    // Normalise paragraph text: replace nbsp + collapse whitespace + uppercase.
    const getParaText = (para) =>
      para
        .replace(/<[^>]+>/g, ' ')
        .replace(/ /g, ' ')
        .replace(/[“”‘’]/g, '"')   // curly quotes → straight
        .replace(/\s+/g, ' ')
        .toUpperCase()
        .trim();
    // Markers that identify a Suretyship-related paragraph (title or index entry).
    // The template uses "Annexure \"A\" – Suretyship" with curly quotes in the
    // index, and "Annexure \"A\"" as a standalone title. Body of the deed has
    // many "Deed of Suretyship" / "Suretyship" mentions.
    const isSuretyParagraph = (text) =>
      /SURETYSHIP/i.test(text) ||
      /\bDEED\b/i.test(text) ||
      /\bSURETY\b/i.test(text) ||
      /ANNEXURE\s*["“"']?\s*A\s*["”"']?/i.test(text);

    xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
      const text = getParaText(para);
      return isSuretyParagraph(text) ? '' : para;
    });

    // ---- Step B: shift remaining annexure letters using <w:t> text mapping ----
    // 1. Collect every <w:t> element with its XML position
    // 2. Concatenate their text to a single string + remember which character
    //    came from which <w:t>
    // 3. Match "ANNEXURE [B-G]" in the joined text and shift the letter down
    // 4. Rewrite each affected <w:t> in place

    const wtRe = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g;
    const tNodes = [];
    let m;
    while ((m = wtRe.exec(xml)) !== null) {
      tNodes.push({
        xmlStart: m.index,
        xmlLength: m[0].length,
        attrs: m[1] || '',
        text: m[2] || '',
      });
    }

    // Build joined text + position-to-tNode map
    let joined = '';
    const map = []; // map[charIndex] = { nodeIndex, posInNode }
    tNodes.forEach((node, i) => {
      for (let p = 0; p < node.text.length; p++) {
        map.push({ nodeIndex: i, posInNode: p });
      }
      joined += node.text;
    });

    // Match the template format: Annexure "B" with straight or curly quotes,
    // also bare "Annexure B". Case-insensitive. The captured letter is the
    // LAST capital letter in the matched substring so we find its xml position
    // via the joined-text → tNode map.
    const annexureRe = /annexure[\s\u00a0]*["\u201c\u201d\u2018\u2019']?[\s\u00a0]*([B-G])/gi;
    const newTexts = tNodes.map(n => n.text);
    let am;
    while ((am = annexureRe.exec(joined)) !== null) {
      const oldLetter = am[1];
      const newLetter = String.fromCharCode(oldLetter.charCodeAt(0) - 1);
      const m0 = am[0];
      const letterRel = m0.lastIndexOf(oldLetter);
      const letterPos = am.index + letterRel;
      const entry = map[letterPos];
      if (!entry) continue;
      const t = newTexts[entry.nodeIndex];
      if ((t[entry.posInNode] || '').toUpperCase() === oldLetter.toUpperCase()) {
        const replacement = oldLetter === oldLetter.toUpperCase() ? newLetter.toUpperCase() : newLetter.toLowerCase();
        newTexts[entry.nodeIndex] = t.slice(0, entry.posInNode) + replacement + t.slice(entry.posInNode + 1);
      }
    }

    // ---- Step C: insert a hard page break before the (post-shift) "Annexure A"
    // heading so the renamed-first annexure starts on a new page at the top. ----
    // After Step B, the heading that was "Annexure B" has been renamed to
    // "Annexure A". We re-extract paragraphs from the in-memory xml (with
    // the new letters), find the first paragraph whose text is JUST
    // "Annexure A" (heading style — no extra text), and inject a page-break
    // paragraph before it.

    // Re-serialise xml with shifted texts so paragraph text reflects new letters
    let xmlForC = '';
    let cursorC = 0;
    tNodes.forEach((n, i) => {
      xmlForC += xml.slice(cursorC, n.xmlStart);
      xmlForC += `<w:t${n.attrs}>${newTexts[i]}</w:t>`;
      cursorC = n.xmlStart + n.xmlLength;
    });
    xmlForC += xml.slice(cursorC);

    const isHeadingForA = (text) => /^ANNEXURE\s*["“”‘’']?\s*A\s*["“”‘’']?\s*$/i.test(text);
    const pbParagraph = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    const paraIt = xmlForC.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g);
    let insertAt = -1;
    for (const m of paraIt) {
      const t = getParaText(m[0]);
      if (isHeadingForA(t)) { insertAt = m.index; break; }
    }
    if (insertAt >= 0) {
      xmlForC = xmlForC.slice(0, insertAt) + pbParagraph + xmlForC.slice(insertAt);
    }

    // ---- Step D: nuclear text-node scrub ----
    // Even if any paragraph somehow survived the strip, replace the literal
    // surety/deed phrases inside every <w:t> element so they can never appear
    // in the rendered document body. Order matters — replace longer phrases
    // first so we don't leave fragments behind.
    xmlForC = xmlForC.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (full, attrs, content) => {
      const cleaned = content
        .replace(/Deed\s+of\s+Suretyship/gi, '')
        .replace(/Suretyship/gi, '')
        .replace(/\bDeed\b/gi, '');
      return '<w:t' + attrs + '>' + cleaned + '</w:t>';
    });

    const _finalDeed = (xmlForC.match(/deed/gi) || []).length;
    const _finalSurety = (xmlForC.match(/suretyship/gi) || []).length;
    // eslint-disable-next-line no-console
    console.log('[stripSuretyAnnexureFromXml]', {
      initialLen: _initialLen,
      finalLen: xmlForC.length,
      initialDeed: _initialDeed,
      finalDeed: _finalDeed,
      initialSurety: _initialSurety,
      finalSurety: _finalSurety,
    });

    return xmlForC;
  };

  // Render a single template into a docx Blob. Each Part can be tested
  // independently by changing `path` and inspecting the returned blob.
  const renderPart = async (path, data, { patchRentalSchedule = false, postProcess = null } = {}) => {
    const pizzipMod = await import('pizzip');
    const docxtemplaterMod = await import('docxtemplater');
    const PizZip = pizzipMod.default || pizzipMod;
    const Docxtemplater = docxtemplaterMod.default || docxtemplaterMod;

    const res = await fetch(path);
    if (!res.ok) {
      throw new Error(`${path.replace(/^\//, '')} not found in public/. Drop the template file into the public/ folder.`);
    }
    const buf = await res.arrayBuffer();
    const zip = new PizZip(buf);

    // Part A's template has an unclosed {-w:tr rentalSchedule} loop — patch
    // it before docxtemplater compiles. Skip for Part B (no such loop).
    if (patchRentalSchedule) {
      const docXmlPath = 'word/document.xml';
      let xml = zip.file(docXmlPath).asText();
      if (xml.includes('rentalSchedule}') && !xml.includes('{/rentalSchedule}')) {
        const tokenIdx = xml.indexOf('rentalSchedule}');
        const trEnd = xml.indexOf('</w:tr>', tokenIdx);
        if (trEnd > tokenIdx) {
          const closer = '<w:p><w:r><w:t xml:space="preserve">{/rentalSchedule}</w:t></w:r></w:p>';
          xml = xml.slice(0, trEnd) + closer + xml.slice(trEnd);
          zip.file(docXmlPath, xml);
        }
      }
    }

    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render(data);
    // Optional post-process step: rewrite document.xml after templating.
    // Used for the no-surety annexure cleanup in Part B.
    if (postProcess) {
      const renderedZip = doc.getZip();
      const docXmlPath = 'word/document.xml';
      const renderedXml = renderedZip.file(docXmlPath).asText();
      const next = postProcess(renderedXml);
      renderedZip.file(docXmlPath, next);
      return renderedZip.generate({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
    }
    return doc.getZip().generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  };

  const handleGenerateWord = async () => {
    setGenerating('word');
    try {
      const data = buildLeaseData(form);

      // Part A keeps a single "N/A" surety placeholder when surety isn't
      // required (so section 1.11 shows the heading with N/A).
      // Part B should NOT render the Deed-of-Suretyship annexure at all when
      // surety isn't required — feed it an empty sureties array so the
      // template's {#sureties}…{/sureties} loop iterates zero times.
      const dataPartB = {
        ...data,
        sureties: form.suretyRequired ? data.sureties : [],
      };

      // Render Part A independently
      const partA = await renderPart('/lease-template.docx', data, { patchRentalSchedule: true });

      // Try Part B — optional. If the template is missing, fall back to A-only
      // with a warning so the user knows Part B wasn't merged.
      let partB = null;
      try {
        partB = await renderPart('/part-b-template.docx', dataPartB, {
          // If surety isn't required, strip the orphaned annexure title and
          // shift remaining annexure letters down by one.
          postProcess: form.suretyRequired ? null : stripSuretyAnnexureFromXml,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[Lease gen] Part B skipped:', err.message);
      }

      const { saveAs } = await import('file-saver');

      let finalBlob;
      if (partB) {
        // Merge the two DOCX buffers with docx-merger.
        //   pageBreak: true → wraps each document with its own section break.
        //     This preserves Part A's page size, margins and section properties
        //     independently from Part B's so Part A's tables/header don't get
        //     remangled by Part B's styles.
        const DocxMergerMod = await import('docx-merger');
        const DocxMerger = DocxMergerMod.default || DocxMergerMod;
        const [aBuf, bBuf] = await Promise.all([partA.arrayBuffer(), partB.arrayBuffer()]);
        const merger = new DocxMerger({ pageBreak: true }, [aBuf, bBuf]);
        finalBlob = await new Promise((resolve, reject) => {
          try {
            merger.save('blob', (out) => {
              if (!out) reject(new Error('docx-merger returned empty output'));
              else resolve(out);
            });
          } catch (e) { reject(e); }
        });
      } else {
        finalBlob = partA;
        showToast('Part B template missing — only Part A was generated', 'error');
      }

      saveAs(finalBlob, `${filename()}.docx`);
      setHistory(prev => [{ id: `h-${Date.now()}`, action: 'Generated Word', label: form.tenant.companyName || 'Lease', at: new Date().toISOString() }, ...prev].slice(0, 100));
      logAction(`Generated lease Word doc: ${form.tenant.companyName || 'Unnamed'}`);
      showToast(partB ? 'Word document downloaded (Part A + Part B)' : 'Part A only — see toast above', 'success');
    } catch (err) {
      const msg = err?.properties?.errors
        ? err.properties.errors.map(e => `${e.id || ''} ${e.message || e}`).join('; ')
        : err.message || String(err);
      // eslint-disable-next-line no-console
      console.error('[Lease gen] failed:', err);
      showToast('Word generation failed: ' + msg, 'error');
    } finally {
      setGenerating(null);
    }
  };

  // Render the current lease form to a single in-memory DOCX blob (no save).
  // Reuses the same template/merge logic as handleGenerateWord. Read-only.
  const buildLeaseBlob = async () => {
    const data = buildLeaseData(form);
    const dataPartB = { ...data, sureties: form.suretyRequired ? data.sureties : [] };
    const partA = await renderPart('/lease-template.docx', data, { patchRentalSchedule: true });
    let partB = null;
    try {
      partB = await renderPart('/part-b-template.docx', dataPartB, {
        postProcess: form.suretyRequired ? null : stripSuretyAnnexureFromXml,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Lease blob] Part B skipped:', err.message);
    }
    if (!partB) return partA;
    const DocxMergerMod = await import('docx-merger');
    const DocxMerger = DocxMergerMod.default || DocxMergerMod;
    const [aBuf, bBuf] = await Promise.all([partA.arrayBuffer(), partB.arrayBuffer()]);
    const merger = new DocxMerger({ pageBreak: true }, [aBuf, bBuf]);
    return new Promise((resolve, reject) => {
      try {
        merger.save('blob', (out) => out ? resolve(out) : reject(new Error('docx-merger returned empty output')));
      } catch (e) { reject(e); }
    });
  };

  // Send the rendered lease to DocuSign as a new envelope.
  // Creates ONE envelope per click. Never modifies an existing one.
  // Recipients are derived from the form (landlord, tenant signatory, sureties).
  const handleSendToDocuSign = async () => {
    const ds = integrations?.docusign || {};
    if (!ds.connected || !ds.accountId || !ds.baseUri) {
      showToast('DocuSign isn\'t connected. Go to Settings → Integrations → DocuSign and click Connect.', 'error');
      onNavigateToSettings?.();
      return;
    }
    // Need at least one signer email — the tenant signatory is the primary signer.
    const tenantEmail = form.tenant?.signatoryEmail || form.tenant?.email;
    const tenantName = form.tenant?.signatoryName || form.tenant?.companyName;
    if (!tenantEmail || !tenantName) {
      showToast('Add a tenant signatory name and email before sending to DocuSign.', 'error');
      return;
    }
    const landlordEmail = form.landlord?.email;
    const landlordName = form.landlord?.signatoryName || form.landlord?.name;

    setGenerating('docusign');
    try {
      // 1. Get a fresh access token (auto-refresh if needed).
      const { accessToken, updates } = await docusignAPI.ensureAccessToken(ds);
      if (updates) setIntegrations({ ...integrations, docusign: { ...ds, ...updates } });

      // 2. Build the DOCX in memory.
      const blob = await buildLeaseBlob();
      const documentBase64 = await blobToBase64(blob);

      // 3. Compose recipients with anchor-based tabs. Routing order:
      //    1 = tenant signs first, 2 = landlord countersigns, 3+ = sureties.
      //    Each signer gets only the tabs that match their anchor namespace.
      const signers = [];
      let recipientId = 1;
      let routingOrder = 1;

      signers.push({
        recipientId: String(recipientId++),
        routingOrder: String(routingOrder++),
        name: String(tenantName).slice(0, 100),
        email: tenantEmail,
        tabs: buildSignerTabs(DOCUSIGN_ANCHORS.tenant),
      });

      if (landlordEmail && landlordName) {
        signers.push({
          recipientId: String(recipientId++),
          routingOrder: String(routingOrder++),
          name: String(landlordName).slice(0, 100),
          email: landlordEmail,
          tabs: buildSignerTabs(DOCUSIGN_ANCHORS.landlord),
        });
      }

      if (form.suretyRequired && Array.isArray(form.surety)) {
        form.surety.forEach((s, idx) => {
          if (!s?.email || !s?.name) return;
          signers.push({
            recipientId: String(recipientId++),
            routingOrder: String(routingOrder++),
            name: String(s.name).slice(0, 100),
            email: s.email,
            tabs: buildSignerTabs(DOCUSIGN_ANCHORS.surety(idx + 1)),
          });
        });
      }

      // 4. POST the envelope. status:'sent' triggers immediate emails;
      //    status:'created' would save as draft on DocuSign.
      const envelopeRequest = {
        emailSubject: `Lease Agreement — ${form.premises?.buildingName || form.tenant?.companyName || 'Exceed Properties'}`,
        emailBlurb: `Please review and sign the attached lease agreement.\n\nIf you have any questions, contact the landlord directly.`,
        status: 'sent',
        documents: [{
          documentBase64,
          name: `${form.tenant?.companyName || 'Lease'}.docx`.replace(/[\/\\:*?"<>|]/g, '_'),
          fileExtension: 'docx',
          documentId: '1',
        }],
        recipients: { signers },
      };
      const env = await docusignAPI.createEnvelope({
        baseUri: ds.baseUri,
        accountId: ds.accountId,
        envelope: envelopeRequest,
        accessToken,
      });

      // 5. Persist the envelope ID for later status lookup.
      setIntegrations(prev => ({
        ...prev,
        docusign: {
          ...(prev.docusign || {}),
          lastEnvelopeId: env.envelopeId,
          lastSync: new Date().toISOString(),
          lastSyncStatus: 'success',
          lastSyncError: null,
        },
      }));

      setHistory(prev => [{
        id: `h-${Date.now()}`,
        action: 'Sent to DocuSign',
        label: `${form.tenant?.companyName || 'Lease'} → ${env.envelopeId}`,
        at: new Date().toISOString(),
      }, ...prev].slice(0, 100));
      logAction(`Sent lease "${form.tenant?.companyName || 'Unnamed'}" to DocuSign — envelope ${env.envelopeId}`);
      showToast(`Sent to DocuSign — ${signers.length} signer${signers.length === 1 ? '' : 's'} · envelope ${env.envelopeId}`, 'success');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[DocuSign] send failed:', err);
      setIntegrations(prev => ({
        ...prev,
        docusign: {
          ...(prev.docusign || {}),
          lastSync: new Date().toISOString(),
          lastSyncStatus: 'error',
          lastSyncError: err.message,
        },
      }));
      showToast('DocuSign send failed: ' + (err.message || 'unknown'), 'error');
    } finally {
      setGenerating(null);
    }
  };

  // ----- Handle the Quick Start PDF uploads -----
  const handlePdfUpload = async (kind, file) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      showToast(`${file.name} — must be a PDF`, 'error');
      return;
    }
    if (!aiReady) {
      showToast('Configure your Anthropic API key in Settings → Integrations first', 'error');
      return;
    }
    setUploadState(s => ({ ...s, [kind]: 'loading' }));
    setUploadError(e => ({ ...e, [kind]: null }));
    setUploadedName(n => ({ ...n, [kind]: file.name }));
    try {
      const text = await extractPdfText(file);
      if (!text || text.trim().length < 20) {
        throw new Error('Could not extract text from this PDF — it may be scanned/image-only.');
      }
      let parsed;
      if (kind === 'leaseControl') parsed = await parseLeaseControlPdf(text, anthropicCfg.model);
      else if (kind === 'invoice') parsed = await parseInvoicePdf(text, anthropicCfg.model);
      else if (kind === 'cipc')    parsed = await parseCipcPdf(text, anthropicCfg.model);
      else if (kind === 'id')      parsed = await parseIdPdf(text, anthropicCfg.model);
      else if (kind === 'tax')     parsed = await parseTaxPdf(text, anthropicCfg.model);
      else throw new Error(`Unknown PDF kind: ${kind}`);

      // Remap Claude's natural-shape output to match the form's path schema.
      // CIPC/ID/Tax responses don't use the same nesting the form uses.
      if (kind === 'id') {
        const s = parsed?.signatory || {};
        const fullName = s.fullName || [s.givenNames, s.surname].filter(Boolean).join(' ').trim();
        parsed = {
          tenant: {
            signatoryName: fullName || null,
            signatoryIdNumber: s.idNumber || null,
          },
        };
      } else if (kind === 'tax') {
        const t = parsed?.tenant || {};
        parsed = {
          tenant: {
            vatNumber: t.vatNumber || null,
            taxNumber: t.taxNumber || null,
            companyName: t.taxpayerName || null,
          },
        };
      } else if (kind === 'cipc') {
        const t = parsed?.tenant || {};
        const dir = (parsed?.directors || [])[0];
        parsed = {
          tenant: {
            companyName: t.companyName || null,
            registrationNumber: t.registrationNumber || null,
            entityType: t.entityType || null,
            address: t.principalAddress || t.postalAddress || null,
            ...(dir ? {
              signatoryName: dir.name || null,
              signatoryIdNumber: dir.idNumber || null,
              signatoryRole: dir.role || null,
            } : {}),
          },
        };
      }
      // eslint-disable-next-line no-console
      console.log(`[Lease PDF Parse · ${kind}] Claude returned:`, parsed);
      const { mergedForm, filledPaths, skipped } = mergeParsedIntoForm(form, parsed, dirtyPaths);
      // eslint-disable-next-line no-console
      console.log(`[Lease PDF Parse · ${kind}] Filled (${filledPaths.length}):`, filledPaths);
      // eslint-disable-next-line no-console
      console.log(`[Lease PDF Parse · ${kind}] Skipped (${skipped.length}):`, skipped);
      const skippedByReason = skipped.reduce((acc, s) => { acc[s.reason] = (acc[s.reason] || 0) + 1; return acc; }, {});
      // eslint-disable-next-line no-console
      console.log(`[Lease PDF Parse · ${kind}] Skip summary:`, skippedByReason);
      setForm(mergedForm);
      // Flash filled fields green for ~2s
      if (filledPaths.length > 0) {
        setFlashPaths(prev => { const n = new Set(prev); filledPaths.forEach(p => n.add(p)); return n; });
        setTimeout(() => {
          setFlashPaths(prev => { const n = new Set(prev); filledPaths.forEach(p => n.delete(p)); return n; });
        }, 2000);
      }
      setUploadState(s => ({ ...s, [kind]: 'success' }));
      logAction(`Auto-populated lease from ${kind === 'leaseControl' ? 'Lease Control Schedule' : 'Invoice'} PDF (${filledPaths.length} filled, ${skipped.length} skipped)`);
      const blockedByExisting = skipped.filter(s => s.reason === 'field already has a value').length;
      const blockedByDirty = skipped.filter(s => s.reason === 'field marked dirty (user edited)').length;
      const summary = blockedByExisting + blockedByDirty > 0
        ? ` · ${blockedByExisting + blockedByDirty} skipped (already filled — check DevTools console)`
        : '';
      showToast(`${filledPaths.length} field${filledPaths.length === 1 ? '' : 's'} auto-filled${summary}`, 'success');
    } catch (err) {
      const msg = err.message || String(err);
      setUploadState(s => ({ ...s, [kind]: 'error' }));
      setUploadError(e => ({ ...e, [kind]: msg }));
      showToast(`PDF parse failed: ${msg.slice(0, 100)}`, 'error');
    }
  };

  // Annexures
  const toggleAnnexure = (letter) => {
    setForm(f => ({ ...f, annexureSelected: { ...f.annexureSelected, [letter]: !f.annexureSelected[letter] } }));
  };
  const addAnnexure = () => {
    setForm(f => {
      const last = f.annexures[f.annexures.length - 1];
      const next = String.fromCharCode(last.charCodeAt(0) + 1);
      return {
        ...f,
        annexures: [...f.annexures, next],
        annexureSelected: { ...f.annexureSelected, [next]: true },
      };
    });
  };

  const selectedAnnexures = form.annexures.filter(a => form.annexureSelected[a]).join(', ');
  const depositAmount = Number(form.deposit.amount) || 0;

  // No longer a modal overlay — renders inline inside the main content area
  // so the sidebar stays visible. `open` is kept as a no-op prop for backwards
  // compatibility with the old call site that mounted this in a Modal-style way.

  // Lease-type chooser — blocks the form until the user picks one. Triggered
  // on first load (blank form) and again whenever the user clicks the pill
  // in the header to change their mind. We intentionally do not let the
  // user dismiss the chooser without picking, because every downstream
  // section (escalation defaults, addendum-only sections, etc.) depends on it.
  const leaseTypeOptions = [
    { id: 'New Lease', label: 'New Lease', desc: 'A brand-new agreement between landlord and tenant for a previously un-leased premises (or with a new tenant).', icon: Sparkles },
    { id: 'Renewal',   label: 'Renewal',   desc: 'The current tenant is staying on. Carries forward most landlord/premises details — only term, rent and escalation typically change.', icon: RefreshCw },
    { id: 'Addendum',  label: 'Addendum',  desc: 'A short amendment to an existing lease (e.g. variation of rent, change in premises area, deposit top-up). Not a full lease document.', icon: FileText },
  ];
  const pickLeaseType = (id) => {
    upd('meta.leaseType', id);
    logAction(`Lease type selected: ${id}`);
    showToast(`Drafting as ${id}`, 'success');
  };

  return (
    <div className="animate-fade-in-up">
      {/* Lease-type chooser — appears whenever meta.leaseType is null. */}
      {!form.meta.leaseType && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15, 30, 46, 0.7)' }}
        >
          <div className="w-full max-w-2xl rounded-lg" style={{ backgroundColor: brand.ivory, border: `1px solid ${brand.borderDark}` }}>
            <div className="px-6 py-4" style={{ borderBottom: `1px solid ${brand.border}` }}>
              <p className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: brand.gold }}>Before we start</p>
              <h3 className="text-lg font-semibold tracking-tight" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>
                What are you drafting today?
              </h3>
              <p className="text-xs mt-1" style={{ color: brand.textMuted }}>
                Pick one so we can show the right defaults and the right document template.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-6">
              {leaseTypeOptions.map(opt => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => pickLeaseType(opt.id)}
                    className="text-left rounded p-4 transition-all hover:-translate-y-0.5"
                    style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, boxShadow: '0 1px 2px rgba(15,30,46,0.04)' }}
                  >
                    <div className="w-9 h-9 rounded flex items-center justify-center mb-2" style={{ backgroundColor: brand.goldPale, color: brand.gold }}>
                      <Icon size={18} />
                    </div>
                    <p className="font-semibold text-sm mb-1" style={{ color: brand.navy }}>{opt.label}</p>
                    <p className="text-[11px] leading-snug" style={{ color: brand.textMuted }}>{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Header banner — matches the app's navy + gold theme */}
      <div className="px-4 md:px-6 py-4 -mx-4 md:-mx-8 -mt-4 md:-mt-6 mb-0" style={{ backgroundColor: brand.navy }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded" style={{ backgroundColor: brand.gold }}>
              <Sparkles size={18} style={{ color: brand.navy }} />
            </div>
            <div>
              <p className="text-xs tracking-[0.2em] uppercase" style={{ color: brand.gold }}>Tools</p>
              <h1 className="text-xl" style={{ color: '#fff', fontFamily: 'Georgia, serif', fontWeight: 600 }}>Automated Lease Drafting</h1>
            </div>
            {form.meta.leaseType && (
              <button
                type="button"
                onClick={() => upd('meta.leaseType', null)}
                className="text-[11px] px-2 py-1 rounded uppercase tracking-wider hover:opacity-80"
                style={{ backgroundColor: brand.gold, color: brand.navy, fontWeight: 600 }}
                title="Change lease type"
              >
                {form.meta.leaseType}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold" style={{ backgroundColor: brand.gold, color: brand.navy }}>
                {currentUser?.firstName?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="text-xs">
                <p className="font-medium" style={{ color: '#fff' }}>{currentUser?.firstName} {currentUser?.lastName}</p>
                <p style={{ color: brand.gold }}>{ROLES[currentUser?.systemRole]?.label || 'User'}</p>
              </div>
            </div>
            {onClose && (
              <button onClick={onClose} className="px-3 py-1.5 text-xs rounded hover:bg-white/10 transition-colors" style={{ color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }} title="Back to Leasing">
                ← Back
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="px-4 md:px-6 py-3 -mx-4 md:-mx-8" style={{ backgroundColor: '#fff', borderBottom: `1px solid ${brand.border}` }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" icon={FileText} onClick={() => setDraftsModalOpen(true)}>Drafts ({drafts.length})</Button>
          <Button size="sm" variant="ghost" icon={History} onClick={() => setHistoryModalOpen(true)}>History</Button>
          <Button size="sm" variant="ghost" icon={Eye} onClick={() => setPreviewOpen(true)}>Preview</Button>
          <Button size="sm" variant="primary" icon={Download} onClick={handleGenerateWord} disabled={generating !== null}>
            {generating === 'word' ? 'Generating…' : 'Generate Word'}
          </Button>
          <Button
            size="sm"
            variant="gold"
            icon={Send}
            onClick={handleSendToDocuSign}
            disabled={generating !== null || !integrations?.docusign?.connected}
            title={integrations?.docusign?.connected ? 'Send for e-signature' : 'Connect DocuSign in Settings first'}
          >
            {generating === 'docusign' ? 'Sending…' : 'Send via DocuSign'}
          </Button>
          <Button size="sm" variant="ghost" icon={FileText} onClick={() => generateSinglePart('partA')} disabled={generating !== null}>
            {generating === 'partA' ? 'Part A…' : 'Part A only'}
          </Button>
          <Button size="sm" variant="ghost" icon={FileText} onClick={() => generateSinglePart('partB')} disabled={generating !== null}>
            {generating === 'partB' ? 'Part B…' : 'Part B only'}
          </Button>
          <Button size="sm" variant="primary" icon={Save} onClick={handleSaveDraft}>Save Draft</Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => setClearConfirmOpen(true)}>Clear</Button>
          <Button size="sm" variant="ghost" icon={FileCheck} onClick={() => setSavedModalOpen(true)}>Saved ({savedLeases.length})</Button>
          <div className="ml-auto">
            <Button size="sm" variant="gold" icon={CheckCircle2} onClick={handleSaveLease}>Finalise Lease</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 p-4 md:p-6">
        {/* Quick-start sidebar */}
        <aside className="space-y-4">
          <Card className="p-4">
            <p className="text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: brand.navy }}>Quick Start</p>
            <p className="text-[11px] mb-2" style={{ color: brand.textMuted }}>Lease Control Schedule</p>
            <PdfDropzone
              kind="leaseControl"
              state={uploadState.leaseControl}
              error={uploadError.leaseControl}
              filename={uploadedName.leaseControl}
              aiReady={aiReady}
              onFile={handlePdfUpload}
              onNavigateToSettings={onNavigateToSettings}
            />
          </Card>

          <Card className="p-4">
            <p className="text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: brand.navy }}>Upload Invoice</p>
            <PdfDropzone
              kind="invoice"
              state={uploadState.invoice}
              error={uploadError.invoice}
              filename={uploadedName.invoice}
              aiReady={aiReady}
              onFile={handlePdfUpload}
              onNavigateToSettings={onNavigateToSettings}
            />
          </Card>

          <Card className="p-4">
            <p className="text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: brand.navy }}>Tenant CIPC</p>
            <p className="text-[11px] mb-2" style={{ color: brand.textMuted }}>Company registration certificate (CoR 14.3, Disclosure)</p>
            <PdfDropzone
              kind="cipc"
              state={uploadState.cipc}
              error={uploadError.cipc}
              filename={uploadedName.cipc}
              aiReady={aiReady}
              onFile={handlePdfUpload}
              onNavigateToSettings={onNavigateToSettings}
            />
          </Card>

          <Card className="p-4">
            <p className="text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: brand.navy }}>Signatory ID</p>
            <p className="text-[11px] mb-2" style={{ color: brand.textMuted }}>SA ID book, smart card, or passport</p>
            <PdfDropzone
              kind="id"
              state={uploadState.id}
              error={uploadError.id}
              filename={uploadedName.id}
              aiReady={aiReady}
              onFile={handlePdfUpload}
              onNavigateToSettings={onNavigateToSettings}
            />
          </Card>

          <Card className="p-4">
            <p className="text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: brand.navy }}>Tax Documents</p>
            <p className="text-[11px] mb-2" style={{ color: brand.textMuted }}>SARS Tax Clearance / TCS PIN letter</p>
            <PdfDropzone
              kind="tax"
              state={uploadState.tax}
              error={uploadError.tax}
              filename={uploadedName.tax}
              aiReady={aiReady}
              onFile={handlePdfUpload}
              onNavigateToSettings={onNavigateToSettings}
            />
          </Card>

        </aside>

        {/* Main form */}
        <div>
          {/* 1.1 Landlord */}
          <LeaseSection
            number="1.1" title="The Landlord" icon={Building2} color={brand.navy}
            headerExtra={
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={form.landlord.saveAsDefault} onChange={(e) => upd('landlord.saveAsDefault', e.target.checked)} />
                <span style={{ color: brand.textMuted }}>Save as Default</span>
              </label>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              <Field label="Landlord Name"><Input value={form.landlord.name} onChange={(e) => upd('landlord.name', e.target.value)} /></Field>
              <Field label="Phone"><Input value={form.landlord.phone || ''} onChange={(e) => upd('landlord.phone', e.target.value)} /></Field>
              <Field label="Address"><Input value={form.landlord.address || ''} onChange={(e) => upd('landlord.address', e.target.value)} /></Field>
              <Field label="Registration Number"><Input value={form.landlord.registrationNumber} onChange={(e) => upd('landlord.registrationNumber', e.target.value)} /></Field>
              <Field label="VAT Number"><Input value={form.landlord.vatNumber} onChange={(e) => upd('landlord.vatNumber', e.target.value)} /></Field>
              <Field label="Bank Name"><Input value={form.landlord.bankName} onChange={(e) => upd('landlord.bankName', e.target.value)} /></Field>
              <Field label="Bank Branch"><Input value={form.landlord.bankBranch} onChange={(e) => upd('landlord.bankBranch', e.target.value)} /></Field>
              <Field label="Account Number"><Input value={form.landlord.accountNumber} onChange={(e) => upd('landlord.accountNumber', e.target.value)} /></Field>
              <Field label="Branch Code"><Input value={form.landlord.branchCode} onChange={(e) => upd('landlord.branchCode', e.target.value)} /></Field>
            </div>
          </LeaseSection>

          {/* 1.2 Tenant */}
          <LeaseSection number="1.2" title="The Tenant" icon={User} color={brand.gold}>
            {badPayerMatch && (() => {
              const d = badPayerMatch.debtor;
              const isBad = badPayerMatch.flag === 'BAD';
              const balance = Number(d.currentBalance ?? d.outstandingBalance ?? 0);
              const arrears = Number(d.arrearsBroughtForward ?? 0);
              const ratio = d.paymentRatio != null ? d.paymentRatio : computePaymentRatio(d);
              const ratioPct = isFinite(ratio) ? Math.round(ratio * 100) : null;
              const reason = computeDebtorReason(d);
              return (
                <div
                  className="mb-4 p-3 rounded flex items-start gap-3"
                  style={{
                    backgroundColor: isBad ? brand.dangerLight : brand.warningLight,
                    border: `1px solid ${isBad ? brand.danger : brand.warning}`,
                  }}
                >
                  <AlertCircle size={18} className="flex-shrink-0 mt-0.5" style={{ color: isBad ? brand.danger : brand.warning }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: isBad ? brand.danger : brand.warning }}>
                      {isBad ? 'BAD payer flagged' : 'WARNING — known overdue tenant'}
                    </p>
                    <p className="text-xs mt-1" style={{ color: brand.text }}>
                      <strong>{d.tenant || d.tenantName}</strong>
                      {d.accountNumber ? <> · acct <strong>{d.accountNumber}</strong></> : null}
                      {d.property ? <> · {d.property} {d.unit ? `· ${d.unit}` : ''}</> : null}
                    </p>
                    <p className="text-xs mt-1" style={{ color: brand.text }}>
                      Current balance: <strong>R {balance.toLocaleString()}</strong>
                      {arrears > 0 ? <> · Arrears b/f: <strong>R {arrears.toLocaleString()}</strong></> : null}
                      {ratioPct != null ? <> · Payment ratio: <strong>{ratioPct}%</strong></> : null}
                    </p>
                    {reason && (
                      <p className="text-[11px] mt-1" style={{ color: brand.textMuted }}>Reason: {reason}</p>
                    )}
                    {d.notes && (
                      <p className="text-[11px] mt-1 italic" style={{ color: brand.textMuted }}>Note: {d.notes}</p>
                    )}
                  </div>
                  {!badPayerAcknowledged && (
                    <button
                      onClick={() => { setBadPayerAcknowledged(true); logAction(`User acknowledged ${badPayerMatch.flag} warning for "${form.tenant?.companyName}" — proceed anyway`); }}
                      className="text-xs px-3 py-1 rounded btn-press flex-shrink-0"
                      style={{ color: isBad ? brand.danger : brand.warning, border: `1px solid ${isBad ? brand.danger : brand.warning}` }}
                    >
                      Proceed anyway
                    </button>
                  )}
                  {badPayerAcknowledged && (
                    <span className="text-[11px] flex-shrink-0 self-center px-2 py-0.5 rounded" style={{ backgroundColor: '#fff', color: brand.textMuted }}>Acknowledged</span>
                  )}
                </div>
              );
            })()}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              <Field label="Company Name"><Input value={form.tenant.companyName} onChange={(e) => upd('tenant.companyName', e.target.value)} /></Field>
              <Field label="ID Number"><Input value={form.tenant.idNumber} onChange={(e) => upd('tenant.idNumber', e.target.value)} /></Field>
              <Field label="Registration Number"><Input value={form.tenant.registrationNumber} onChange={(e) => upd('tenant.registrationNumber', e.target.value)} /></Field>
              <Field label="VAT Number"><Input value={form.tenant.vatNumber} onChange={(e) => upd('tenant.vatNumber', e.target.value)} /></Field>
              <Field label="Address"><Input value={form.tenant.address} onChange={(e) => upd('tenant.address', e.target.value)} /></Field>
              <Field label="Phone"><Input value={form.tenant.phone} onChange={(e) => upd('tenant.phone', e.target.value)} /></Field>
              <Field label="Email"><Input type="email" value={form.tenant.email} onChange={(e) => upd('tenant.email', e.target.value)} /></Field>
              <Field label="Contact Person"><Input value={form.tenant.contactPerson} onChange={(e) => upd('tenant.contactPerson', e.target.value)} /></Field>
            </div>
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
              <p className="text-[11px] tracking-wider uppercase mb-3" style={{ color: brand.gold }}>Tenant Resolution (Part B)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                <Field label="Entity Type" hint="Determines DIRECTORS / MEMBERS / TRUSTEES in the resolution">
                  <Select value={form.tenant.entityType || 'Company'} onChange={(e) => upd('tenant.entityType', e.target.value)}>
                    <option value="Company">Company (Pty) Ltd</option>
                    <option value="CC">Close Corporation</option>
                    <option value="Trust">Trust</option>
                  </Select>
                </Field>
                <Field label="Signatory Role" hint="Title used in the resolution and signature block">
                  <Select value={form.tenant.signatoryRole || 'Director'} onChange={(e) => upd('tenant.signatoryRole', e.target.value)}>
                    <option value="Director">Director</option>
                    <option value="Member">Member</option>
                    <option value="Trustee">Trustee</option>
                  </Select>
                </Field>
                <Field label="Signatory Full Name"><Input value={form.tenant.signatoryName || ''} onChange={(e) => upd('tenant.signatoryName', e.target.value)} /></Field>
                <Field label="Signatory ID Number"><Input value={form.tenant.signatoryIdNumber || ''} onChange={(e) => upd('tenant.signatoryIdNumber', e.target.value)} /></Field>
                <Field label="Signatory Pronoun" hint="Used in the resolution body text">
                  <Select value={form.tenant.signatoryPronoun || 'his'} onChange={(e) => upd('tenant.signatoryPronoun', e.target.value)}>
                    <option value="his">his</option>
                    <option value="her">her</option>
                    <option value="their">their</option>
                  </Select>
                </Field>
              </div>
            </div>
          </LeaseSection>

          {/* 1.3-1.8 Premises */}
          <LeaseSection number="1.3 – 1.8" title="The Premises" icon={MapPin} color={brand.success}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              <Field label="Unit Number"><Input value={form.premises.unitNumber} onChange={(e) => upd('premises.unitNumber', e.target.value)} /></Field>
              <Field label="Building Name"><Input value={form.premises.buildingName} onChange={(e) => upd('premises.buildingName', e.target.value)} /></Field>
              <Field label="Building Address"><Input value={form.premises.buildingAddress} onChange={(e) => upd('premises.buildingAddress', e.target.value)} /></Field>
              <Field label="Rentable Area (m²)" hint="e.g. 361.00"><Input type="number" step="0.01" value={form.premises.rentableArea} onChange={(e) => upd('premises.rentableArea', e.target.value)} /></Field>
              <Field label="Parking Ratio" hint="bays per 100m²"><Input type="number" step="0.001" value={form.premises.parkingRatio} onChange={(e) => upd('premises.parkingRatio', e.target.value)} /></Field>
              <Field label="Permitted Use"><Input value={form.premises.permittedUse} onChange={(e) => upd('premises.permittedUse', e.target.value)} /></Field>
            </div>
          </LeaseSection>

          {/* 1.9 Initial Period */}
          <LeaseSection number="1.9" title="Initial Period of Lease" icon={Calendar} color={brand.warning}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4">
              <Field label="Years"><Input type="number" min="0" value={form.initialPeriod.years} onChange={(e) => upd('initialPeriod.years', Number(e.target.value))} /></Field>
              <Field label="Months"><Input type="number" min="0" max="11" value={form.initialPeriod.months} onChange={(e) => upd('initialPeriod.months', Number(e.target.value))} /></Field>
              <Field label="Commencement Date"><Input type="date" value={form.initialPeriod.commencementDate} onChange={(e) => upd('initialPeriod.commencementDate', e.target.value)} /></Field>
              <Field label="Termination Date" hint={form.initialPeriod.terminationOverride ? 'manual override' : 'auto-calculated'}>
                <Input type="date" value={form.initialPeriod.terminationDate} onChange={(e) => { upd('initialPeriod.terminationDate', e.target.value); upd('initialPeriod.terminationOverride', true); }} />
              </Field>
            </div>
          </LeaseSection>

          {/* B/O — Beneficial Occupation (optional, between Initial and Option Periods) */}
          <LeaseSection
            number="B/O" title="Beneficial Occupation" icon={Calendar} color={brand.gold}
            subtitle="Optional. Only appears in the generated lease when enabled."
            headerExtra={
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={!!form.beneficialOccupation?.enabled} onChange={(e) => upd('beneficialOccupation.enabled', e.target.checked)} />
                <span style={{ color: brand.textMuted }}>Beneficial occupation applies</span>
              </label>
            }
          >
            {form.beneficialOccupation?.enabled ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
                <Field label="From Date">
                  <Input type="date" value={form.beneficialOccupation.fromDate} onChange={(e) => upd('beneficialOccupation.fromDate', e.target.value)} />
                </Field>
                <Field label="To Date">
                  <Input type="date" value={form.beneficialOccupation.toDate} onChange={(e) => upd('beneficialOccupation.toDate', e.target.value)} />
                </Field>
                <Field label="Amount Ex VAT (R)" hint="Usually 0 for rent-free B/O">
                  <Input type="number" step="0.01" value={form.beneficialOccupation.amountExVat} onChange={(e) => upd('beneficialOccupation.amountExVat', e.target.value)} />
                </Field>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded" style={{ backgroundColor: brand.cream }}>
                <span className="text-xs font-medium" style={{ color: brand.textMuted }}>Status:</span>
                <span className="px-2 py-0.5 text-xs font-semibold rounded" style={{ backgroundColor: '#fff', color: brand.navy }}>N/A</span>
                <span className="text-xs ml-2" style={{ color: brand.textMuted }}>Tick the checkbox to add a beneficial-occupation period to this lease.</span>
              </div>
            )}
          </LeaseSection>

          {/* 1.10 Option Period */}
          <LeaseSection
            number="1.10" title="Option Period of Lease" icon={Calendar} color={brand.warning}
            subtitle="(To be exercised by a specific date) Option period is to be mutually determined by the parties."
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
              <Field label="Years"><Input type="number" min="0" value={form.optionPeriod.years} onChange={(e) => upd('optionPeriod.years', Number(e.target.value))} /></Field>
              <Field label="Months"><Input type="number" min="0" max="11" value={form.optionPeriod.months} onChange={(e) => upd('optionPeriod.months', Number(e.target.value))} /></Field>
              <Field label="Option to be Exercised By"><Input type="date" value={form.optionPeriod.exerciseBy} onChange={(e) => upd('optionPeriod.exerciseBy', e.target.value)} /></Field>
            </div>
          </LeaseSection>

          {/* 1.11 Surety — optional, toggled via checkbox */}
          <LeaseSection
            number="1.11" title="Surety" icon={Shield} color={brand.navy}
            headerExtra={
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={!!form.suretyRequired} onChange={(e) => upd('suretyRequired', e.target.checked)} />
                <span style={{ color: brand.textMuted }}>Surety required</span>
              </label>
            }
          >
            {form.suretyRequired ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
                <Field label="Name"><Input value={form.surety.name} onChange={(e) => upd('surety.name', e.target.value)} /></Field>
                <Field label="ID Number"><Input value={form.surety.idNumber} onChange={(e) => upd('surety.idNumber', e.target.value)} /></Field>
                <Field label="Address"><Input value={form.surety.address} onChange={(e) => upd('surety.address', e.target.value)} /></Field>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded" style={{ backgroundColor: brand.cream }}>
                <span className="text-xs font-medium" style={{ color: brand.textMuted }}>Status:</span>
                <span className="px-2 py-0.5 text-xs font-semibold rounded" style={{ backgroundColor: '#fff', color: brand.navy }}>N/A</span>
                <span className="text-xs ml-2" style={{ color: brand.textMuted }}>Tick "Surety required" above to add a surety to this lease.</span>
              </div>
            )}
          </LeaseSection>

          {/* 1.12 Monthly Rental */}
          <LeaseSection
            number="1.12" title="Monthly Rental and Other Monthly Charges" icon={DollarSign} color={brand.success}
            headerExtra={
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: brand.textMuted }}>Annual Escalation</span>
                <input
                  type="number"
                  step="0.1"
                  value={form.monthlyRental.escalationRate}
                  onChange={(e) => upd('monthlyRental.escalationRate', Number(e.target.value))}
                  className="w-16 px-2 py-1 text-xs rounded outline-none"
                  style={{ border: `1px solid ${brand.border}` }}
                />
                <span className="text-xs" style={{ color: brand.text }}>%</span>
              </div>
            }
          >
            <div className="space-y-3">
              {form.monthlyRental.years.map((y, idx) => {
                const incVat = (Number(y.basicRentExVat) || 0) * (1 + VAT_RATE);
                const escLabel = idx > 0 ? ` (Auto-escalated ${form.monthlyRental.escalationRate}%)` : '';
                return (
                  <div key={idx} className="p-3 rounded" style={{ backgroundColor: idx === 0 ? brand.cream : '#FAFAF6', border: `1px solid ${brand.border}` }}>
                    <p className="text-xs font-semibold tracking-wider uppercase mb-3" style={{ color: brand.navy }}>
                      Year {idx + 1}<span style={{ color: brand.textMuted, fontWeight: 400 }}>{escLabel}</span>
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-3 gap-y-0">
                      <Field label="Basic Rent Ex VAT (R)"><Input type="number" step="0.01" value={y.basicRentExVat} onChange={(e) => updYear(idx, 'basicRentExVat', e.target.value)} /></Field>
                      <Field label="Basic Rent Inc VAT (R)"><Input type="text" value={fmtMoney(incVat).replace('R ', '')} readOnly style={{ backgroundColor: brand.cream }} /></Field>
                      <Field label="Security Ex VAT (R)"><Input type="number" step="0.01" value={y.securityExVat} onChange={(e) => updYear(idx, 'securityExVat', e.target.value)} /></Field>
                      <Field label="Electricity Ex VAT (R)">
                        <Input type="number" step="0.01" value={y.electricityExVat} onChange={(e) => updYear(idx, 'electricityExVat', e.target.value)} />
                      </Field>
                      <Field label="Sewerage & Water Ex VAT (R)">
                        <Input type="number" step="0.01" value={y.sewerageExVat} onChange={(e) => updYear(idx, 'sewerageExVat', e.target.value)} />
                      </Field>
                      <Field label={`Refuse Ex VAT (R)`}>
                        <Input type="number" step="0.01" value={y.refuseExVat} onChange={(e) => updYear(idx, 'refuseExVat', e.target.value)} />
                      </Field>
                      <Field label="Refuse As At"><Input type="date" value={y.refuseAsAt} onChange={(e) => updYear(idx, 'refuseAsAt', e.target.value)} /></Field>
                      <Field label="Rates Ex VAT (R)">
                        <Input type="number" step="0.01" value={y.ratesExVat} onChange={(e) => updYear(idx, 'ratesExVat', e.target.value)} />
                      </Field>
                      <Field label="Rates As At"><Input type="date" value={y.ratesAsAt} onChange={(e) => updYear(idx, 'ratesAsAt', e.target.value)} /></Field>
                      <Field label="From"><Input type="date" value={y.from} readOnly style={{ backgroundColor: brand.cream }} /></Field>
                      <Field label="To"><Input type="date" value={y.to} readOnly style={{ backgroundColor: brand.cream }} /></Field>
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] italic" style={{ color: brand.textMuted }}>
                Increases as per relevant municipal authority/contractor in rates and refuse to apply on a proportionate basis.
              </p>
            </div>
          </LeaseSection>

          {/* 1.13 Deposit */}
          <LeaseSection number="1.13" title="Deposit" icon={DollarSign} color={brand.gold}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
              <Field label="Deposit Amount (R)"><Input type="number" step="0.01" value={form.deposit.amount} onChange={(e) => upd('deposit.amount', e.target.value)} /></Field>
              <div className="mt-4 md:mt-7">
                {depositAmount > 0 ? (
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium" style={{ backgroundColor: brand.successLight, color: brand.success }}>
                    <CheckCircle2 size={12} /> Deposit captured · {fmtMoney(depositAmount)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium" style={{ backgroundColor: brand.cream, color: brand.textMuted }}>
                    No deposit — Status: N/A
                  </span>
                )}
                {depositAmount === 0 && <p className="text-[11px] mt-1" style={{ color: brand.textMuted }}>Enter deposit amount to set status.</p>}
              </div>
            </div>
          </LeaseSection>

          {/* 1.14 Turnover */}
          <LeaseSection number="1.14" title="Turnover Provisions" icon={TrendingUp} color={brand.navy}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4">
              <Field label="1.14.1 Turnover Percentage"><Input value={form.turnover.percentage} onChange={(e) => upd('turnover.percentage', e.target.value)} /></Field>
              <Field label="1.14.2 Tenant's Financial Year End"><Input value={form.turnover.financialYearEnd} onChange={(e) => upd('turnover.financialYearEnd', e.target.value)} /></Field>
              <Field label="1.14.3 Minimum Turnover Requirement"><Input value={form.turnover.minimumTurnoverRequirement} onChange={(e) => upd('turnover.minimumTurnoverRequirement', e.target.value)} /></Field>
            </div>
          </LeaseSection>

          {/* 1.15 Advertising */}
          <LeaseSection
            number="1.15" title="Tenant's Advertising and Promotional Contribution" icon={Star} color={brand.gold}
            subtitle="% age of tenant's net monthly rental plus attributable VAT thereon."
          >
            <Field label="Contribution"><Input value={form.advertising.contribution} onChange={(e) => upd('advertising.contribution', e.target.value)} /></Field>
          </LeaseSection>

          {/* 1.16 Tenant's Bank Account Details */}
          <LeaseSection number="1.16" title="Tenant's Bank Account Details" icon={Briefcase} color={brand.gold}>
            <Field label="Bank Account Details" hint="Multi-line; default N/A">
              <textarea
                rows={3}
                value={form.tenantBankDetails}
                onChange={(e) => setForm(f => ({ ...f, tenantBankDetails: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded outline-none"
                style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, color: brand.text, fontFamily: 'inherit' }}
              />
            </Field>
          </LeaseSection>

          {/* 1.17 Lease Fees */}
          <LeaseSection number="1.17" title="Lease Fees Payable by Tenant on Signature (Ex VAT)" icon={DollarSign} color={brand.success}>
            <Field label="Amount (R)"><Input type="number" step="0.01" value={form.leaseFees.amount} onChange={(e) => upd('leaseFees.amount', e.target.value)} /></Field>
          </LeaseSection>

          {/* 1.18 Annexures */}
          <LeaseSection number="1.18" title="Annexures" icon={Layers} color={brand.navy}>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {form.annexures.map(letter => (
                <label key={letter} className="inline-flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer" style={{ backgroundColor: form.annexureSelected[letter] ? brand.goldPale : brand.cream, border: `1px solid ${form.annexureSelected[letter] ? brand.gold : brand.border}` }}>
                  <input type="checkbox" checked={!!form.annexureSelected[letter]} onChange={() => toggleAnnexure(letter)} />
                  <span className="text-xs font-medium" style={{ color: brand.text }}>{letter}</span>
                </label>
              ))}
              <button onClick={addAnnexure} className="px-3 py-1.5 text-xs font-medium rounded btn-press" style={{ color: brand.gold, border: `1px solid ${brand.border}` }}>
                + Add
              </button>
            </div>
            <p className="text-xs" style={{ color: brand.textMuted }}>
              Selected: <span style={{ color: brand.navy, fontWeight: 600 }}>{selectedAnnexures || '—'}</span>
            </p>
          </LeaseSection>
        </div>
      </div>

      {/* ===== Modals ===== */}
      <Modal open={draftsModalOpen} onClose={() => setDraftsModalOpen(false)} title={`Saved Drafts (${drafts.length})`} size="md">
        {drafts.length === 0 ? (
          <p className="text-sm italic py-6 text-center" style={{ color: brand.textMuted }}>No drafts saved yet.</p>
        ) : (
          <div className="space-y-2">
            {drafts.map(d => (
              <div key={d.id} className="flex items-center justify-between p-3 rounded" style={{ border: `1px solid ${brand.border}` }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: brand.text }}>{d.label}</p>
                  <p className="text-xs" style={{ color: brand.textMuted }}>Saved {timeAgo(d.savedAt)}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleRestoreDraft(d)} className="text-xs px-3 py-1 rounded" style={{ color: brand.success, border: `1px solid ${brand.success}` }}>Restore</button>
                  <button onClick={() => handleDeleteDraft(d.id)} className="text-xs px-3 py-1 rounded" style={{ color: brand.danger, border: `1px solid ${brand.danger}` }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={historyModalOpen} onClose={() => setHistoryModalOpen(false)} title="Activity History" size="md">
        {history.length === 0 ? (
          <p className="text-sm italic py-6 text-center" style={{ color: brand.textMuted }}>No history yet.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {history.map(h => (
              <div key={h.id} className="p-2 rounded text-xs" style={{ border: `1px solid ${brand.border}` }}>
                <p style={{ color: brand.text }}><strong>{h.action}</strong> — {h.label}</p>
                <p style={{ color: brand.textMuted }}>{new Date(h.at).toLocaleString('en-ZA')}</p>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={savedModalOpen} onClose={() => setSavedModalOpen(false)} title={`Saved Leases (${savedLeases.length})`} size="md">
        {savedLeases.length === 0 ? (
          <p className="text-sm italic py-6 text-center" style={{ color: brand.textMuted }}>No finalised leases yet.</p>
        ) : (
          <div className="space-y-2">
            {savedLeases.map(s => (
              <div key={s.id} className="flex items-center justify-between p-3 rounded" style={{ border: `1px solid ${brand.border}` }}>
                <div>
                  <p className="text-sm font-medium" style={{ color: brand.text }}>{s.label}</p>
                  <p className="text-xs" style={{ color: brand.textMuted }}>Finalised {timeAgo(s.savedAt)}</p>
                </div>
                <button onClick={() => handleRestoreSaved(s)} className="text-xs px-3 py-1 rounded" style={{ color: brand.gold, border: `1px solid ${brand.gold}` }}>Open</button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={clearConfirmOpen}
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={handleClear}
        title="Clear lease form"
        message="This will reset every field in the lease draft. Your saved drafts won't be affected."
        confirmText="Clear Form"
        danger
      />

      {/* Preview — also serves as the source for PDF generation */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto p-6" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="max-w-4xl mx-auto rounded-lg" style={{ backgroundColor: '#fff' }}>
            <div className="sticky top-0 flex items-center justify-between px-6 py-3 z-10" style={{ backgroundColor: '#fff', borderBottom: `1px solid ${brand.border}` }}>
              <p className="text-sm font-semibold" style={{ color: brand.navy }}>Lease Preview</p>
              <button onClick={() => setPreviewOpen(false)} className="p-1.5 rounded"><X size={16} /></button>
            </div>
            <div id="lease-preview-render" style={{ padding: '40px', fontFamily: 'Arial, sans-serif', color: '#111', fontSize: '12px', lineHeight: 1.5 }}>
              <LeasePreviewBody form={form} />
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// Body of the lease preview — single bordered table matching the SA commercial
// lease schedule format. On-screen preview only; document generation is
// driven by public/lease-template.docx + docxtemplater.
const LeasePreviewBody = ({ form }) => {
  const annexuresList = form.annexures.filter(a => form.annexureSelected[a]).map(a => `"${a}"`).join('; ');
  const sureties = !form.suretyRequired
    ? []
    : [form.surety].filter(s => s && (s.name || s.idNumber || s.address));
  const tenantBank = form.tenantBankDetails || 'N/A';
  const depositNum = Number(form.deposit.amount) || 0;
  const depositText = depositNum > 0
    ? `${fmtMoney(depositNum)} - DEPOSIT PAYABLE UPON SIGNATURE OF LEASE AGREEMENT`
    : 'N/A';

  const cell = (content, opts = {}) => ({ content, ...opts });

  return (
    <>
      <style>{`
        .lease-doc { font-family: Arial, sans-serif; color: #000; font-size: 9pt; line-height: 1.35; }
        .lease-doc .title { text-align: center; font-size: 12pt; font-weight: bold; padding: 6pt 0 2pt; }
        .lease-doc .part { font-weight: bold; padding-top: 4pt; padding-bottom: 2pt; }
        .lease-doc .intro { padding-bottom: 6pt; }
        table.lease { width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 9pt; }
        table.lease td, table.lease th { border: 0.5pt solid #000; padding: 3pt 5pt; vertical-align: top; }
        table.lease .label { font-weight: bold; text-transform: uppercase; width: 32%; }
        table.lease .center { text-align: center; }
        table.lease .money { text-align: center; white-space: nowrap; }
        table.lease tr { page-break-inside: avoid; }
        table.lease .full { width: 100%; border-collapse: collapse; }
        table.lease .full td, table.lease .full th { border: 0.5pt solid #000; padding: 3pt 5pt; }
        table.lease .full th { font-weight: bold; text-align: center; text-transform: uppercase; }
        table.lease .nested { width: 100%; border-collapse: collapse; }
        table.lease .nested td { border: 0.5pt solid #000; padding: 2pt 4pt; }
        table.lease .sub { font-size: 8pt; font-weight: normal; }
        table.lease .footnote { font-size: 8pt; font-weight: bold; padding-top: 4pt; }
      `}</style>

      <div className="lease-doc">
        <div className="title">AGREEMENT OF LEASE</div>
        <div className="part">PART A</div>
        <div className="intro">
          THE PREMISES ARE HIRED BY THE <strong>TENANT</strong> FROM THE <strong>LANDLORD</strong> SUBJECT TO THE TERMS AND CONDITIONS SET OUT HEREIN AND IN ANY ANNEXURE HERETO:
        </div>

        <table className="lease">
          {/* 1.1 LANDLORD */}
          <tbody>
            <tr>
              <td className="label">1.1 THE LANDLORD:</td>
              <td>
                <div><strong>{(form.landlord.name || '').toUpperCase()}</strong></div>
                <div>TEL: {form.landlord.phone || ''}</div>
              </td>
            </tr>
            <tr>
              <td className="label">REGISTRATION NO:</td>
              <td>{form.landlord.registrationNumber || ''}</td>
            </tr>
            <tr>
              <td className="label">VAT REGISTRATION NO:</td>
              <td>{form.landlord.vatNumber || ''}</td>
            </tr>
            <tr>
              <td className="label">BANKING DETAILS:</td>
              <td>
                <div>BANK : {form.landlord.bankName || ''}, {form.landlord.bankBranch || ''}</div>
                <div>A/C NO: {form.landlord.accountNumber || ''} , BRANCH CODE: {form.landlord.branchCode || ''}</div>
              </td>
            </tr>

            {/* 1.2 TENANT */}
            <tr>
              <td className="label">1.2 THE TENANT:</td>
              <td><strong>{(form.tenant.companyName || '').toUpperCase()}</strong></td>
            </tr>
            <tr>
              <td className="label">REGISTRATION NO:</td>
              <td>{form.tenant.registrationNumber || ''}</td>
            </tr>
            <tr>
              <td className="label">VAT REGISTRATION NO:</td>
              <td>{form.tenant.vatNumber || 'TBA'}</td>
            </tr>
            <tr>
              <td className="label">ADDRESSES:</td>
              <td style={{ padding: 0 }}>
                <table className="nested">
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 'bold', width: '50%' }}>POSTAL:</td>
                      <td style={{ fontWeight: 'bold' }}>PHYSICAL:</td>
                    </tr>
                    <tr>
                      <td style={{ whiteSpace: 'pre-line' }}>{form.tenant.address || ''}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>{form.tenant.address || ''}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td className="label">KNOWN AS:</td>
              <td>{(form.tenant.companyName || '').toUpperCase()}</td>
            </tr>

            {/* 1.3 - 1.8 PREMISES */}
            <tr>
              <td className="label">1.3 THE PREMISES:</td>
              <td>{(form.premises.permittedUse || form.premises.unitNumber || '').toUpperCase()}</td>
            </tr>
            <tr>
              <td className="label">1.4 BUILDING NAME:</td>
              <td>{(form.premises.buildingName || '').toUpperCase()}</td>
            </tr>
            <tr>
              <td className="label">1.5 BUILDING ADDRESS:</td>
              <td>{(form.premises.buildingAddress || '').toUpperCase()}</td>
            </tr>
            <tr>
              <td className="label">1.6 PREMISES MEASUREMENTS (APPROX):</td>
              <td>
                {(form.premises.permittedUse || form.premises.unitNumber || '').toUpperCase()} = {form.premises.rentableArea ? `${form.premises.rentableArea}m²` : 'N/A'}
              </td>
            </tr>
            <tr>
              <td className="label">
                1.7 TENANT'S PERCENTAGE PROPORTIONATE SHARE OF BUILDING AND/OR PROPERTY EXCLUDING PARKING AND FACILITY AREAS
              </td>
              <td>{form.premises.parkingRatio ? `${Number(form.premises.parkingRatio).toFixed(2)}%` : '0.00%'}</td>
            </tr>
            <tr>
              <td className="label">
                1.8 PERMITTED USE OF PREMISES:
                <div className="sub" style={{ fontWeight: 'normal' }}>TO BE USED BY THE TENANT FOR THESE PURPOSES AND FOR NO OTHER PURPOSES WHATSOEVER</div>
              </td>
              <td>{(form.premises.permittedUse || '').toUpperCase()} AND FOR NO OTHER PURPOSE WHATSOEVER.</td>
            </tr>

            {/* 1.9 INITIAL PERIOD */}
            <tr>
              <td className="label">1.9 INITIAL PERIOD OF LEASE:</td>
              <td style={{ padding: 0 }}>
                <table className="nested">
                  <tbody>
                    <tr>
                      <td className="center" style={{ fontWeight: 'bold' }}>YEARS</td>
                      <td className="center" style={{ fontWeight: 'bold' }}>MONTHS</td>
                    </tr>
                    <tr>
                      <td className="center">{form.initialPeriod.years || 0}</td>
                      <td className="center">{form.initialPeriod.months || 0}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td className="label">COMMENCEMENT DATE:</td>
              <td>{fmtDateLong(form.initialPeriod.commencementDate)}</td>
            </tr>
            <tr>
              <td className="label">TERMINATION DATE:</td>
              <td>{fmtDateLong(form.initialPeriod.terminationDate)}</td>
            </tr>

            {/* 1.10 OPTION PERIOD */}
            <tr>
              <td className="label">
                1.10 OPTION PERIOD OF LEASE
                <div className="sub" style={{ fontWeight: 'normal', textTransform: 'none' }}>
                  (TO BE EXERCISED BY {fmtDateShort(form.optionPeriod.exerciseBy) || '__/__/____'}) OPTION PERIOD IS TO BE MUTUALLY DETERMINED BY THE PARTIES. IF BUSINESS SOLD LEASE TO BE RENEWED SUBJECT TO APPROVAL OF NEW TENANT BY LANDLORD.
                </div>
              </td>
              <td style={{ padding: 0 }}>
                <table className="nested">
                  <tbody>
                    <tr>
                      <td className="center" style={{ fontWeight: 'bold' }}>YEARS</td>
                      <td className="center" style={{ fontWeight: 'bold' }}>MONTHS</td>
                    </tr>
                    <tr>
                      <td className="center">{form.optionPeriod.years || 0}</td>
                      <td className="center">{form.optionPeriod.months || 0}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            {/* 1.11 SURETIES */}
            {form.suretyRequired ? (
              <>
                <tr>
                  <td className="label" colSpan={2}>1.11 SURETIES</td>
                </tr>
                {sureties.length > 0 ? sureties.map((s, i) => (
                  <React.Fragment key={i}>
                    <tr><td className="label">NAME:</td><td>{(s.name || '').toUpperCase()}</td></tr>
                    <tr><td className="label">ID NUMBER:</td><td>{s.idNumber || ''}</td></tr>
                    <tr><td className="label">ADDRESS:</td><td style={{ whiteSpace: 'pre-line' }}>{s.address || ''}</td></tr>
                  </React.Fragment>
                )) : (
                  <>
                    <tr><td className="label">NAME:</td><td></td></tr>
                    <tr><td className="label">ID NUMBER:</td><td></td></tr>
                    <tr><td className="label">ADDRESS:</td><td></td></tr>
                  </>
                )}
              </>
            ) : (
              <tr>
                <td className="label">1.11 SURETIES</td>
                <td>N/A</td>
              </tr>
            )}

            {/* 1.12 RENTAL SCHEDULE */}
            <tr>
              <td className="label" colSpan={2}>1.12 MONTHLY RENTAL AND OTHER MONTHLY CHARGES</td>
            </tr>
            <tr>
              <td colSpan={2} style={{ padding: 0 }}>
                <table className="full">
                  <thead>
                    <tr>
                      <th>BASIC RENT EXCL. VAT</th>
                      <th>VAT @ 15%</th>
                      <th>BASIC RENT INCL. VAT</th>
                      <th>ELECTRICITY<br/>SEWERAGE &amp; WATER</th>
                      <th>FROM</th>
                      <th>TO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.monthlyRental.years.map((y, i) => {
                      const exVat = Number(y.basicRentExVat) || 0;
                      const vat = exVat * VAT_RATE;
                      const incVat = exVat + vat;
                      return (
                        <tr key={i}>
                          <td className="money">{fmtMoney(exVat)}</td>
                          <td className="money">{fmtMoney(vat)}</td>
                          <td className="money">{fmtMoney(incVat)}</td>
                          <td className="center">METERED OR % AGE OF EXPENSE</td>
                          <td className="center">{y.from ? fmtDateShort(y.from) : ''}</td>
                          <td className="center">{y.to ? fmtDateShort(y.to) : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="footnote">*INCREASES AS PER RELEVANT MUNICIPAL AUTHORITY IN RATES AND REFUSE TO APPLY ON A PROPORTIONATE BASIS.</div>
              </td>
            </tr>

            {/* 1.13 DEPOSIT */}
            <tr>
              <td className="label">1.13 DEPOSIT -</td>
              <td><strong>{depositText}</strong></td>
            </tr>

            {/* 1.14 TURNOVER */}
            <tr>
              <td className="label">1.14.1 TURNOVER PERCENTAGE</td>
              <td>{form.turnover.percentage || 'N/A'}</td>
            </tr>
            <tr>
              <td className="label">1.14.2 TENANT'S FINANCIAL YEAR END:</td>
              <td>{form.turnover.financialYearEnd || 'N/A'}</td>
            </tr>
            <tr>
              <td className="label">1.14.3 MINIMUM TURNOVER REQUIREMENT ESCALATING ANNUALLY</td>
              <td>{form.turnover.minimumTurnoverRequirement || 'N/A'}</td>
            </tr>

            {/* 1.15 ADVERTISING */}
            <tr>
              <td className="label">
                1.15 TENANT'S ADVERTISING AND PROMOTIONAL CONTRIBUTION
                <div className="sub" style={{ fontWeight: 'normal', textTransform: 'none' }}>% AGE OF TENANT'S NET MONTHLY RENTAL PLUS ATTRIBUTABLE VALUE ADDED TAX THEREON</div>
              </td>
              <td>{form.advertising.contribution || 'N/A'}</td>
            </tr>

            {/* 1.16 TENANT BANK */}
            <tr>
              <td className="label">1.16 TENANT'S BANK ACCOUNT DETAILS:</td>
              <td style={{ whiteSpace: 'pre-line' }}>{tenantBank}</td>
            </tr>

            {/* 1.17 LEASE FEES */}
            <tr>
              <td className="label">1.17 THE FOLLOWING LEASE FEES SHALL BE PAYABLE BY THE TENANT ON SIGNATURE OF THIS LEASE (EXCL. VAT)</td>
              <td>{fmtMoney(form.leaseFees.amount)}</td>
            </tr>

            {/* 1.18 ANNEXURES */}
            <tr>
              <td className="label">1.18 THE FOLLOWING ANNEXURES SHALL FORM PART OF THIS AGREEMENT OF LEASE:</td>
              <td>{annexuresList || ''}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
};

// Compute a financial + renewal summary for a single lease.
// Pure function. Looks at the whole leases array to detect renewals — defined
// as a prior lease that ended within 90 days before THIS lease started AND
// either shares the same tenant name OR the same property+unit.
const computeLeaseSummary = (lease, allLeases) => {
  if (!lease) return null;
  const monthlyRent = Number(lease.monthlyRent) || 0;
  const start = lease.startDate ? new Date(lease.startDate) : null;
  const end = lease.endDate ? new Date(lease.endDate) : null;
  const escalation = Number(lease.escalationPercent) || 0; // optional annual %

  // Term length in whole months
  let monthsTotal = 0;
  if (start && end && end > start) {
    monthsTotal = (end.getFullYear() - start.getFullYear()) * 12
                + (end.getMonth() - start.getMonth())
                + (end.getDate() >= start.getDate() ? 0 : -1)
                + 1;
    monthsTotal = Math.max(0, monthsTotal);
  }

  // Total revenue without escalation: rent × months
  const totalRevenueFlat = monthlyRent * monthsTotal;

  // Total revenue with annual escalation applied on each anniversary
  let totalRevenueEscalated = 0;
  if (monthsTotal > 0) {
    for (let i = 0; i < monthsTotal; i++) {
      const yearIdx = Math.floor(i / 12);
      totalRevenueEscalated += monthlyRent * Math.pow(1 + escalation / 100, yearIdx);
    }
  }

  // Renewal detection: prior lease ending shortly before this one starts,
  // matching tenant OR property+unit.
  const normName = (s) => String(s || '').toLowerCase().replace(/\s*\(renewal\)\s*$/i, '').replace(/\s+/g, ' ').trim();
  let priorLease = null;
  if (start) {
    const candidates = allLeases.filter(l => {
      if (l.id === lease.id) return false;
      if (!l.endDate) return false;
      const lEnd = new Date(l.endDate);
      const daysGap = (start - lEnd) / 86400000;
      if (daysGap < -30 || daysGap > 90) return false; // within 90 days (or 30 overlap)
      const sameTenant = normName(l.tenant) === normName(lease.tenant);
      const sameSpace = normName(l.property) === normName(lease.property) && normName(l.unit) === normName(lease.unit);
      return sameTenant || sameSpace;
    });
    // Pick the most recently-ended prior lease.
    candidates.sort((a, b) => new Date(b.endDate) - new Date(a.endDate));
    priorLease = candidates[0] || null;
  }

  let rentChangePercent = null;
  let rentChangeDirection = null;
  let rentChangeAbsolute = null;
  if (priorLease) {
    const priorRent = Number(priorLease.monthlyRent) || 0;
    if (priorRent > 0) {
      rentChangeAbsolute = monthlyRent - priorRent;
      rentChangePercent = (rentChangeAbsolute / priorRent) * 100;
      rentChangeDirection = rentChangeAbsolute > 0.5 ? 'up' : rentChangeAbsolute < -0.5 ? 'down' : 'flat';
    }
  }

  return {
    monthlyRent,
    monthsTotal,
    yearsTotal: monthsTotal / 12,
    totalRevenueFlat,
    totalRevenueEscalated,
    escalation,
    deposit: Number(lease.deposit) || 0,
    start, end,
    isRenewal: !!priorLease,
    priorLease,
    rentChangePercent,
    rentChangeDirection,
    rentChangeAbsolute,
  };
};

const LeasingSection = ({ leases, setLeases, properties, employees, debtors, integrations, setIntegrations, showToast, logAction, currentUser, onNavigateToSettings, onNavigate }) => {
  // Top-level tab: pipeline view vs Lease Learner. Lease Drafter now lives
  // at its own nav target ('leaseDrafter') so the sidebar stays visible.
  const [subTab, setSubTab] = useState('pipeline');
  const [activeCategory, setActiveCategory] = useState('all'); // 'all' | 'commercial' | 'residential'
  const [viewMode, setViewMode] = useState('pipeline'); // 'pipeline' | 'table'
  const [stageFilter, setStageFilter] = useState('All');
  const [expandedStages, setExpandedStages] = useState({}); // stageKey -> bool, default all collapsed
  const toggleStage = (k) => setExpandedStages(p => ({ ...p, [k]: !p[k] }));
  const [leaseDrafterOpen, setLeaseDrafterOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    type: 'commercial', tenant: '', property: '', unit: '',
    startDate: '', endDate: '', monthlyRent: '', deposit: '',
    assignedTo: '', pipelineStage: 'offer',
  });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  // DocuSign-related state
  const [docusignModalOpen, setDocusignModalOpen] = useState(false);
  const [docusignLease, setDocusignLease] = useState(null);
  const [docusignEmail, setDocusignEmail] = useState('');
  const [docusignDocFile, setDocusignDocFile] = useState(null);
  const [summaryLease, setSummaryLease] = useState(null);
  const [docusignSending, setDocusignSending] = useState(false);

  const docusignConnected = integrations?.docusign?.connected;

  const schema = {
    tenant: [validators.required],
    property: [validators.required],
    unit: [validators.required],
    startDate: [validators.required],
    endDate: [validators.required],
    monthlyRent: [validators.positiveNumber],
    deposit: [validators.positiveNumber],
    assignedTo: [validators.required],
  };

  const handleField = (f, v) => {
    setForm({ ...form, [f]: v });
    if (touched[f]) setErrors(validateForm({ ...form, [f]: v }, schema));
  };
  const handleBlur = (f) => {
    setTouched({ ...touched, [f]: true });
    setErrors(validateForm(form, schema));
  };

  // Filter leases based on active category
  const categoryFilteredLeases = useMemo(() => {
    if (activeCategory === 'all') return leases;
    return leases.filter(l => l.type === activeCategory);
  }, [leases, activeCategory]);

  // Group leases by pipeline stage
  const leasesByStage = useMemo(() => {
    const groups = {};
    LEASE_STAGE_ORDER.forEach(s => groups[s] = []);
    categoryFilteredLeases.forEach(l => {
      const stage = l.pipelineStage || 'active';
      if (groups[stage]) groups[stage].push(l);
    });
    return groups;
  }, [categoryFilteredLeases]);

  // Tab counts
  const commercialCount = leases.filter(l => l.type === 'commercial').length;
  const residentialCount = leases.filter(l => l.type === 'residential').length;

  // Stats
  const activeLeases = categoryFilteredLeases.filter(l => l.pipelineStage === 'active').length;
  const inPipeline = categoryFilteredLeases.filter(l => ['offer', 'draft', 'docusign'].includes(l.pipelineStage)).length;

  // Resolve "assignedTo" employee options based on category
  const eligibleStaff = useMemo(() => {
    if (form.type === 'commercial') {
      return employees.filter(e => e.department === 'Commercial Leasing' || e.systemRole === 'director');
    }
    if (form.type === 'residential') {
      return employees.filter(e => e.department === 'Residential Leasing' || e.systemRole === 'director');
    }
    return employees;
  }, [employees, form.type]);

  const openCreate = (category = 'commercial') => {
    setEditingId(null);
    setForm({
      type: category, tenant: '', property: '', unit: '',
      startDate: '', endDate: '', monthlyRent: '', deposit: '',
      assignedTo: '', pipelineStage: 'offer',
    });
    setErrors({}); setTouched({}); setModalOpen(true);
  };

  const openEdit = (lease) => {
    setEditingId(lease.id);
    setForm({ ...lease });
    setErrors({}); setTouched({}); setModalOpen(true);
  };

  const handleSubmit = () => {
    const allTouched = Object.keys(schema).reduce((a, k) => ({ ...a, [k]: true }), {});
    setTouched(allTouched);
    const newErrors = validateForm(form, schema);
    if (form.startDate && form.endDate && new Date(form.endDate) <= new Date(form.startDate)) {
      newErrors.endDate = 'End date must be after start date';
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      showToast('Please fix the errors before saving', 'error');
      return;
    }
    if (editingId) {
      setLeases(leases.map(l => l.id === editingId ? {
        ...l, ...form,
        monthlyRent: Number(form.monthlyRent),
        deposit: Number(form.deposit),
      } : l));
      logAction(`Updated lease: ${form.tenant}`);
      showToast('Lease updated', 'success');
    } else {
      const newId = Math.max(0, ...leases.map(l => l.id)) + 1;
      const status = form.pipelineStage === 'active' ? 'Active'
        : form.pipelineStage === 'expiring' ? 'Expiring Soon'
        : 'Pending';
      setLeases([...leases, {
        ...form, id: newId, status,
        monthlyRent: Number(form.monthlyRent),
        deposit: Number(form.deposit),
        stageEntered: todayISO(),
      }]);
      logAction(`Created ${form.type} lease for ${form.tenant} (${LEASE_STAGES[form.pipelineStage].label})`);
      showToast('Lease created', 'success');
    }
    setModalOpen(false);
  };

  const advanceStage = (lease) => {
    const currentIdx = LEASE_STAGE_ORDER.indexOf(lease.pipelineStage);
    if (currentIdx === -1 || currentIdx === LEASE_STAGE_ORDER.length - 1) return;
    const nextStage = LEASE_STAGE_ORDER[currentIdx + 1];

    // Special case: draft → docusign should open DocuSign modal
    if (lease.pipelineStage === 'draft' && nextStage === 'docusign') {
      setDocusignLease(lease);
      setDocusignEmail('');
      setDocusignModalOpen(true);
      return;
    }

    const newStatus = nextStage === 'active' ? 'Active'
      : nextStage === 'expiring' ? 'Expiring Soon'
      : 'Pending';
    setLeases(leases.map(l => l.id === lease.id ? {
      ...l, pipelineStage: nextStage, status: newStatus, stageEntered: todayISO(),
    } : l));
    logAction(`Advanced lease "${lease.tenant}" to ${LEASE_STAGES[nextStage].label}`);
    showToast(`Moved to ${LEASE_STAGES[nextStage].label}`, 'success');
  };

  const moveBackStage = (lease) => {
    const currentIdx = LEASE_STAGE_ORDER.indexOf(lease.pipelineStage);
    if (currentIdx <= 0) return;
    const prevStage = LEASE_STAGE_ORDER[currentIdx - 1];
    setLeases(leases.map(l => l.id === lease.id ? {
      ...l, pipelineStage: prevStage, status: 'Pending', stageEntered: todayISO(),
    } : l));
    logAction(`Moved lease "${lease.tenant}" back to ${LEASE_STAGES[prevStage].label}`);
    showToast(`Moved back to ${LEASE_STAGES[prevStage].label}`, 'success');
  };

  const sendToDocuSign = async () => {
    if (!docusignEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(docusignEmail)) {
      showToast('Enter a valid email address', 'error');
      return;
    }
    setDocusignSending(true);

    const ds = integrations?.docusign || {};
    let envelopeId = null;
    let realEnvelope = false;

    // If DocuSign is connected AND the user has uploaded a DOCX for this lease
    // (docusignDocFile state from the modal), create a real envelope. Otherwise
    // mark the lease as on-DocuSign with a tracking placeholder (no real call).
    if (ds.connected && ds.accountId && ds.baseUri && docusignDocFile) {
      try {
        const { accessToken, updates } = await docusignAPI.ensureAccessToken(ds);
        if (updates) setIntegrations({ ...integrations, docusign: { ...ds, ...updates } });

        const documentBase64 = await blobToBase64(docusignDocFile);
        const envelopeRequest = {
          emailSubject: `Lease Agreement — ${docusignLease.tenant}`,
          emailBlurb: 'Please review and sign the attached lease agreement.',
          status: 'sent',
          documents: [{
            documentBase64,
            name: docusignDocFile.name || `${docusignLease.tenant}.docx`,
            fileExtension: (docusignDocFile.name || 'x.docx').split('.').pop().toLowerCase() || 'docx',
            documentId: '1',
          }],
          recipients: {
            signers: [{
              recipientId: '1',
              routingOrder: '1',
              name: docusignLease.tenant,
              email: docusignEmail,
              tabs: buildSignerTabs(DOCUSIGN_ANCHORS.tenant),
            }],
          },
        };
        const env = await docusignAPI.createEnvelope({
          baseUri: ds.baseUri,
          accountId: ds.accountId,
          envelope: envelopeRequest,
          accessToken,
        });
        envelopeId = env.envelopeId;
        realEnvelope = true;
      } catch (err) {
        showToast('DocuSign send failed: ' + err.message, 'error');
        setDocusignSending(false);
        return;
      }
    } else {
      // No real send — generate a tracking placeholder
      envelopeId = `ENV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`;
    }

    setLeases(leases.map(l => l.id === docusignLease.id ? {
      ...l,
      pipelineStage: 'docusign',
      status: 'Pending',
      stageEntered: todayISO(),
      docusignEnvelopeId: envelopeId,
      docusignRecipient: docusignEmail,
      docusignSentAt: new Date().toISOString(),
    } : l));
    logAction(`Sent lease "${docusignLease.tenant}" to DocuSign (${envelopeId})${realEnvelope ? ' [real]' : ' [placeholder]'}`);
    showToast(realEnvelope ? `Sent to DocuSign · envelope ${envelopeId}` : (docusignConnected ? `Marked as sent — upload the lease DOCX in this modal to create a real envelope` : `Marked as sent (DocuSign not connected — configure in Settings)`), 'success');
    setDocusignSending(false);
    setDocusignModalOpen(false);
    setDocusignDocFile(null);
  };

  const markDocuSignSigned = (lease) => {
    setLeases(leases.map(l => l.id === lease.id ? {
      ...l,
      pipelineStage: 'active',
      status: 'Active',
      stageEntered: todayISO(),
      docusignSignedAt: new Date().toISOString(),
    } : l));
    logAction(`Marked lease "${lease.tenant}" as signed via DocuSign`);
    showToast('Lease marked as signed and activated', 'success');
  };

  // Render a single lease card
  const LeaseCard = ({ lease, stageIdx, cardIdx }) => {
    const stage = LEASE_STAGES[lease.pipelineStage] || LEASE_STAGES.active;
    const daysInStage = lease.stageEntered ?
      Math.floor((Date.now() - new Date(lease.stageEntered).getTime()) / 86400000) : null;
    const canAdvance = LEASE_STAGE_ORDER.indexOf(lease.pipelineStage) < LEASE_STAGE_ORDER.length - 1
                      && lease.pipelineStage !== 'docusign';
    const isDocuSign = lease.pipelineStage === 'docusign';
    const isExpiring = lease.pipelineStage === 'expiring';
    // Show summary once the lease has completed the workflow (signed → active).
    const isCompleted = lease.pipelineStage === 'active' || lease.pipelineStage === 'expiring';
    const summary = isCompleted ? computeLeaseSummary(lease, leases) : null;

    return (
      <Card className={`p-3 mb-2 card-lift animate-fade-in-up stagger-${Math.min(cardIdx + 1, 8)}`} style={{ borderLeft: `3px solid ${stage.color}` }}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: brand.text }}>{lease.tenant}</p>
            <p className="text-xs truncate" style={{ color: brand.textMuted }}>{lease.property} · {lease.unit}</p>
          </div>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium ml-2 flex-shrink-0" style={{
            backgroundColor: lease.type === 'commercial' ? brand.goldPale : '#D8E8DE',
            color: lease.type === 'commercial' ? brand.gold : brand.success,
          }}>
            {lease.type === 'commercial' ? 'C' : 'R'}
          </span>
        </div>

        <div className="flex items-center gap-2 mb-2 text-xs flex-wrap">
          <span className="font-semibold" style={{ color: brand.navy }}>R {Number(lease.monthlyRent).toLocaleString()}</span>
          <span style={{ color: brand.textMuted }}>/ mo</span>
          {daysInStage !== null && (
            <span className="ml-auto text-[11px]" style={{ color: daysInStage > 14 ? brand.danger : brand.textMuted }}>
              {daysInStage === 0 ? 'Today' : `${daysInStage}d in stage`}
            </span>
          )}
        </div>

        {lease.assignedTo && (
          <p className="text-xs mb-2" style={{ color: brand.textMuted }}>
            <span style={{ color: brand.text }}>{lease.assignedTo}</span>
          </p>
        )}

        {lease.docusignEnvelopeId && (
          <div className="text-xs p-1.5 rounded mb-2 flex items-center gap-1" style={{ backgroundColor: '#F0EBFA', color: '#7B61FF' }}>
            <FileSignature size={11} /> {lease.docusignEnvelopeId}
          </div>
        )}

        {/* Inline lease summary — shown once the workflow has completed (active/expiring). */}
        {summary && summary.monthsTotal > 0 && (
          <div className="text-xs p-2 rounded mb-2" style={{ backgroundColor: brand.cream, border: `1px solid ${brand.border}` }}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span style={{ color: brand.textMuted }}>Term · Total</span>
              <span style={{ color: brand.navy, fontWeight: 600 }}>
                {summary.monthsTotal}mo · R {Math.round((summary.escalation > 0 ? summary.totalRevenueEscalated : summary.totalRevenueFlat) / 1000).toLocaleString()}k
              </span>
            </div>
            {summary.isRenewal && summary.rentChangePercent != null && (
              <div className="flex items-center justify-between gap-2 mt-1.5 pt-1.5" style={{ borderTop: `1px dashed ${brand.borderDark}` }}>
                <span style={{ color: brand.textMuted }}>Renewal</span>
                <span
                  className="inline-flex items-center gap-1 font-semibold"
                  style={{
                    color: summary.rentChangeDirection === 'up' ? brand.success
                         : summary.rentChangeDirection === 'down' ? brand.danger
                         : brand.textMuted,
                  }}
                >
                  {summary.rentChangeDirection === 'up' ? <TrendingUp size={11} />
                   : summary.rentChangeDirection === 'down' ? <TrendingDown size={11} />
                   : null}
                  {summary.rentChangePercent > 0 ? '+' : ''}{summary.rentChangePercent.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-1 flex-wrap pt-2" style={{ borderTop: `1px solid ${brand.border}` }}>
          {isDocuSign ? (
            <button
              onClick={() => markDocuSignSigned(lease)}
              className="flex-1 text-xs px-2 py-1 rounded btn-press"
              style={{ color: brand.success, border: `1px solid ${brand.success}` }}
            >
              Mark Signed
            </button>
          ) : canAdvance ? (
            <button
              onClick={() => advanceStage(lease)}
              className="flex-1 text-xs px-2 py-1 rounded btn-press transition-all"
              style={{
                backgroundColor: lease.pipelineStage === 'draft' ? '#7B61FF' : brand.navy,
                color: '#fff',
              }}
            >
              {lease.pipelineStage === 'offer' ? 'Start Draft →' :
               lease.pipelineStage === 'draft' ? 'Send to DocuSign →' :
               lease.pipelineStage === 'active' && isExpiring ? '' :
               'Advance →'}
            </button>
          ) : null}
          {isCompleted && (
            <button
              onClick={() => setSummaryLease(lease)}
              className="text-xs px-2 py-1 rounded btn-press flex-1"
              style={{ color: brand.gold, border: `1px solid ${brand.gold}` }}
              title="Lease summary"
            >
              Summary
            </button>
          )}
          <button
            onClick={() => openEdit(lease)}
            className="text-xs px-2 py-1 rounded btn-press"
            style={{ color: brand.textMuted, border: `1px solid ${brand.border}` }}
            title="Edit"
          >
            <Edit2 size={11} />
          </button>
          {LEASE_STAGE_ORDER.indexOf(lease.pipelineStage) > 0 && (
            <button
              onClick={() => moveBackStage(lease)}
              className="text-xs px-2 py-1 rounded btn-press"
              style={{ color: brand.textMuted, border: `1px solid ${brand.border}` }}
              title="Move back"
            >
              ←
            </button>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Tenants & Contracts</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Leasing</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>
            {subTab === 'learner'
              ? 'Feed in existing Word lease templates and Claude extracts the patterns. Learned patterns inform future drafts.'
              : 'Track leases from offer through DocuSign signing to active. Separate workflows for commercial and residential.'}
          </p>
        </div>
        <div className="flex gap-2">
          {subTab === 'pipeline' && (
            <>
              <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${brand.border}` }}>
                <button onClick={() => setViewMode('pipeline')} className="px-3 py-1.5 text-xs font-medium transition-all" style={{ backgroundColor: viewMode === 'pipeline' ? brand.navy : '#fff', color: viewMode === 'pipeline' ? '#fff' : brand.text }}>Pipeline</button>
                <button onClick={() => setViewMode('table')} className="px-3 py-1.5 text-xs font-medium transition-all" style={{ backgroundColor: viewMode === 'table' ? brand.navy : '#fff', color: viewMode === 'table' ? '#fff' : brand.text }}>Table</button>
              </div>
              <Button variant="gold" icon={Sparkles} onClick={() => onNavigate?.('leaseDrafter')}>Draft Lease</Button>
              <Button variant="primary" icon={Plus} onClick={() => openCreate(activeCategory === 'residential' ? 'residential' : 'commercial')}>New Lease</Button>
            </>
          )}
        </div>
      </div>

      {/* Top-level sub-tab strip — Pipeline vs Lease Learner */}
      <div className="flex gap-1 mb-5" style={{ borderBottom: `1px solid ${brand.border}` }}>
        {[
          { id: 'pipeline', label: 'Lease Pipeline', icon: FileSignature },
          { id: 'learner', label: 'Lease Learner', icon: Sparkles },
        ].map(t => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className="px-4 py-2 text-sm font-medium tracking-wide transition-all flex items-center gap-2"
              style={{
                color: active ? brand.navy : brand.textMuted,
                borderBottom: `2px solid ${active ? brand.gold : 'transparent'}`,
                marginBottom: '-1px',
              }}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Lease Learner pane — reuses the standalone component */}
      {subTab === 'learner' && (
        <LeaseLearnerSection
          integrations={integrations}
          showToast={showToast}
          logAction={logAction}
          onNavigateToSettings={onNavigateToSettings}
          onNavigateToLeasing={() => setSubTab('pipeline')}
        />
      )}

      {subTab === 'pipeline' && (
        <>

      {/* Category tabs */}
      <div className="flex gap-1 mb-4" style={{ borderBottom: `1px solid ${brand.border}` }}>
        {[
          { id: 'all', label: 'All Leases', count: leases.length, color: brand.navy },
          { id: 'commercial', label: 'Commercial', count: commercialCount, color: brand.gold },
          { id: 'residential', label: 'Residential', count: residentialCount, color: brand.success },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveCategory(t.id)}
            className="px-4 py-3 text-sm font-medium transition-all relative btn-press"
            style={{
              color: activeCategory === t.id ? t.color : brand.textMuted,
              fontWeight: activeCategory === t.id ? 600 : 500,
            }}
          >
            {t.label}
            <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{
              backgroundColor: activeCategory === t.id ? t.color : brand.cream,
              color: activeCategory === t.id ? '#fff' : brand.textMuted,
            }}>{t.count}</span>
            {activeCategory === t.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />
            )}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {[
          { label: 'Active Leases', value: activeLeases, color: brand.success, icon: CheckCircle2 },
          { label: 'In Pipeline', value: inPipeline, color: brand.gold, icon: Activity },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className={`p-4 card-lift animate-fade-in-up stagger-${i + 1}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>{s.label}</p>
                <Icon size={14} style={{ color: s.color }} />
              </div>
              <p className="text-2xl font-semibold stat-number" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{s.value}</p>
            </Card>
          );
        })}
      </div>

      {/* DocuSign connection status banner */}
      {!docusignConnected && (
        <Card className="mb-4 p-3 animate-fade-in-up" style={{ backgroundColor: brand.warningLight, borderColor: brand.warning }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs" style={{ color: brand.warning }}>
              <AlertCircle size={14} />
              <span>DocuSign is not connected. "Send to DocuSign" actions will be marked as sent but won't create real envelopes. Configure in Settings → Integrations.</span>
            </div>
          </div>
        </Card>
      )}

      {/* PIPELINE VIEW */}
      {viewMode === 'pipeline' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {LEASE_STAGE_ORDER.map((stageKey, stageIdx) => {
            const stage = LEASE_STAGES[stageKey];
            const stageLeases = leasesByStage[stageKey] || [];
            const isExpanded = !!expandedStages[stageKey];
            return (
              <div key={stageKey} className={`animate-fade-in-up stagger-${Math.min(stageIdx + 1, 8)}`}>
                <button
                  type="button"
                  onClick={() => toggleStage(stageKey)}
                  aria-expanded={isExpanded}
                  className="w-full mb-2 px-2 py-2 rounded flex items-center justify-between btn-press transition-colors"
                  style={{ backgroundColor: brand.cream }}
                >
                  <div className="flex items-center gap-2">
                    <ChevronRight
                      size={12}
                      style={{
                        color: brand.textMuted,
                        transform: isExpanded ? 'rotate(90deg)' : 'none',
                        transition: 'transform 150ms',
                      }}
                    />
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                    <p className="text-xs font-semibold tracking-wider uppercase" style={{ color: brand.navy }}>{stage.label}</p>
                  </div>
                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: '#fff', color: stage.color }}>
                    {stageLeases.length}
                  </span>
                </button>
                {isExpanded && (
                  <div className="min-h-[100px]">
                    {stageLeases.length === 0 ? (
                      <div className="text-center py-6 px-3 rounded text-xs italic" style={{ color: brand.textMuted, backgroundColor: '#FAFAF6', border: `1px dashed ${brand.border}` }}>
                        No leases at this stage
                      </div>
                    ) : (
                      stageLeases.map((lease, cardIdx) => (
                        <LeaseCard key={lease.id} lease={lease} stageIdx={stageIdx} cardIdx={cardIdx} />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        // TABLE VIEW
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                  {['Tenant', 'Type', 'Property / Unit', 'Stage', 'Lease Period', 'Monthly Rent', 'Assigned To', ''].map(h => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categoryFilteredLeases.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-8" style={{ color: brand.textMuted }}>No leases in this category.</td></tr>
                )}
                {categoryFilteredLeases.map((l, idx) => {
                  const stage = LEASE_STAGES[l.pipelineStage] || LEASE_STAGES.active;
                  return (
                    <tr key={l.id} className={`animate-fade-in-up stagger-${Math.min(idx + 1, 8)}`} style={{ borderBottom: `1px solid ${brand.border}` }}>
                      <td className="px-5 py-4 font-medium" style={{ color: brand.text }}>{l.tenant}</td>
                      <td className="px-5 py-4">
                        <span className="text-xs px-2 py-1 rounded font-medium" style={{
                          backgroundColor: l.type === 'commercial' ? brand.goldPale : '#D8E8DE',
                          color: l.type === 'commercial' ? brand.gold : brand.success,
                        }}>
                          {l.type === 'commercial' ? 'Commercial' : 'Residential'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <p style={{ color: brand.text }}>{l.property}</p>
                        <p className="text-xs" style={{ color: brand.textMuted }}>{l.unit}</p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="inline-flex items-center gap-1.5 text-xs">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                          <span style={{ color: brand.text }}>{stage.label}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-xs" style={{ color: brand.textMuted }}>
                        {formatDate(l.startDate)} → {formatDate(l.endDate)}
                      </td>
                      <td className="px-5 py-4 font-semibold" style={{ color: brand.navy }}>R {Number(l.monthlyRent).toLocaleString()}</td>
                      <td className="px-5 py-4 text-xs" style={{ color: brand.text }}>{l.assignedTo || '—'}</td>
                      <td className="px-5 py-4 text-right">
                        <button onClick={() => openEdit(l)} className="text-xs px-2 py-1 rounded btn-press" style={{ color: brand.gold }}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Rental Escalation Calculator */}
      <LeasingCalculator />

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Lease' : 'New Lease'} size="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Lease Category" required>
            <Select value={form.type} onChange={(e) => handleField('type', e.target.value)}>
              <option value="commercial">Commercial</option>
              <option value="residential">Residential</option>
            </Select>
          </Field>
          <Field label="Pipeline Stage" required>
            <Select value={form.pipelineStage} onChange={(e) => handleField('pipelineStage', e.target.value)}>
              {LEASE_STAGE_ORDER.map(s => <option key={s} value={s}>{LEASE_STAGES[s].label}</option>)}
            </Select>
          </Field>
          <Field label="Tenant Name" required error={touched.tenant && errors.tenant}>
            <Input value={form.tenant} onChange={(e) => handleField('tenant', e.target.value)} onBlur={() => handleBlur('tenant')} error={touched.tenant && errors.tenant} placeholder="Individual or company name" />
          </Field>
          <Field label="Property" required error={touched.property && errors.property}>
            {form.type === 'commercial' ? (
              <Select value={form.property} onChange={(e) => handleField('property', e.target.value)} error={touched.property && errors.property}>
                <option value="">Select property...</option>
                {properties.map(p => <option key={p.id} value={p.address.split(',')[0]}>{p.address.split(',')[0]}</option>)}
              </Select>
            ) : (
              <Input value={form.property} onChange={(e) => handleField('property', e.target.value)} onBlur={() => handleBlur('property')} error={touched.property && errors.property} placeholder="e.g. Riverside Estate" />
            )}
          </Field>
          <Field label="Unit / Suite" required error={touched.unit && errors.unit}>
            <Input value={form.unit} onChange={(e) => handleField('unit', e.target.value)} onBlur={() => handleBlur('unit')} error={touched.unit && errors.unit} placeholder="e.g. Shop 12 or Unit 4B" />
          </Field>
          <Field label="Assigned To" required error={touched.assignedTo && errors.assignedTo} hint={`From ${form.type === 'commercial' ? 'Commercial Leasing' : 'Residential Leasing'} team`}>
            <Select value={form.assignedTo} onChange={(e) => handleField('assignedTo', e.target.value)} error={touched.assignedTo && errors.assignedTo}>
              <option value="">Select agent...</option>
              {eligibleStaff.map(emp => <option key={emp.id} value={fullName(emp)}>{fullName(emp)} · {emp.role}</option>)}
            </Select>
          </Field>
          <Field label="Monthly Rent (ZAR)" required error={touched.monthlyRent && errors.monthlyRent}>
            <Input type="number" value={form.monthlyRent} onChange={(e) => handleField('monthlyRent', e.target.value)} onBlur={() => handleBlur('monthlyRent')} error={touched.monthlyRent && errors.monthlyRent} />
          </Field>
          <Field label="Security Deposit (ZAR)" required error={touched.deposit && errors.deposit} hint="Typically 1-3x monthly rent">
            <Input type="number" value={form.deposit} onChange={(e) => handleField('deposit', e.target.value)} onBlur={() => handleBlur('deposit')} error={touched.deposit && errors.deposit} />
          </Field>
          <Field label="Lease Start Date" required error={touched.startDate && errors.startDate}>
            <Input type="date" value={form.startDate} onChange={(e) => handleField('startDate', e.target.value)} onBlur={() => handleBlur('startDate')} error={touched.startDate && errors.startDate} />
          </Field>
          <Field label="Lease End Date" required error={touched.endDate && errors.endDate}>
            <Input type="date" value={form.endDate} onChange={(e) => handleField('endDate', e.target.value)} onBlur={() => handleBlur('endDate')} error={touched.endDate && errors.endDate} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" icon={Save} onClick={handleSubmit}>{editingId ? 'Save Changes' : 'Create Lease'}</Button>
        </div>
      </Modal>

      {/* DocuSign Send Modal */}
      {/* Lease Summary Modal — full financial breakdown + renewal comparison */}
      <Modal open={!!summaryLease} onClose={() => setSummaryLease(null)} title="Lease Summary" size="md">
        {summaryLease && (() => {
          const s = computeLeaseSummary(summaryLease, leases);
          const fmtR = (n) => `R ${Math.round(n || 0).toLocaleString('en-ZA')}`;
          const totalRevenue = s.escalation > 0 ? s.totalRevenueEscalated : s.totalRevenueFlat;
          return (
            <>
              <div className="mb-4 p-3 rounded" style={{ backgroundColor: brand.cream }}>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <p className="text-sm font-semibold" style={{ color: brand.navy, fontFamily: 'Georgia, serif' }}>{summaryLease.tenant}</p>
                  <span className="text-xs px-2 py-0.5 rounded" style={{
                    backgroundColor: summaryLease.type === 'commercial' ? brand.goldPale : '#D8E8DE',
                    color: summaryLease.type === 'commercial' ? brand.gold : brand.success,
                  }}>
                    {summaryLease.type === 'commercial' ? 'Commercial' : 'Residential'}
                  </span>
                </div>
                <p className="text-xs" style={{ color: brand.textMuted }}>{summaryLease.property} · {summaryLease.unit}</p>
                <p className="text-xs mt-1" style={{ color: brand.textMuted }}>
                  {s.start ? formatDate(s.start) : '—'} → {s.end ? formatDate(s.end) : '—'} · {s.monthsTotal} months ({s.yearsTotal.toFixed(1)} yrs)
                </p>
              </div>

              {/* Headline numbers */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded" style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}>
                  <p className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>Monthly rent</p>
                  <p className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{fmtR(s.monthlyRent)}</p>
                </div>
                <div className="p-3 rounded" style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}>
                  <p className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>Deposit held</p>
                  <p className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{fmtR(s.deposit)}</p>
                </div>
                <div className="p-3 rounded" style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}>
                  <p className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>Total revenue</p>
                  <p className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.success }}>{fmtR(totalRevenue)}</p>
                </div>
                <div className="p-3 rounded" style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}>
                  <p className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>Escalation</p>
                  <p className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{s.escalation > 0 ? `${s.escalation}% / yr` : '—'}</p>
                </div>
              </div>

              {s.escalation > 0 && (
                <div className="p-3 rounded mb-4 text-xs" style={{ backgroundColor: brand.goldPale, color: brand.text }}>
                  <p>
                    Without escalation, this lease would generate <strong>{fmtR(s.totalRevenueFlat)}</strong>.
                    With {s.escalation}% annual increases applied on each anniversary, the projected total is <strong>{fmtR(s.totalRevenueEscalated)}</strong> —
                    an uplift of <strong>{fmtR(s.totalRevenueEscalated - s.totalRevenueFlat)}</strong>.
                  </p>
                </div>
              )}

              {/* Renewal section */}
              {s.isRenewal ? (
                <div className="mb-4 p-4 rounded" style={{
                  backgroundColor: s.rentChangeDirection === 'up' ? brand.successLight
                                 : s.rentChangeDirection === 'down' ? brand.dangerLight
                                 : brand.cream,
                  border: `1px solid ${s.rentChangeDirection === 'up' ? brand.success
                                     : s.rentChangeDirection === 'down' ? brand.danger
                                     : brand.border}`,
                }}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold" style={{
                      color: s.rentChangeDirection === 'up' ? brand.success
                           : s.rentChangeDirection === 'down' ? brand.danger
                           : brand.text,
                    }}>
                      {s.rentChangeDirection === 'up' && <>↑ Renewal escalation</>}
                      {s.rentChangeDirection === 'down' && <>↓ Renewal at lower rent</>}
                      {s.rentChangeDirection === 'flat' && <>Renewal at same rent</>}
                    </p>
                    <p className="text-lg font-semibold" style={{
                      color: s.rentChangeDirection === 'up' ? brand.success
                           : s.rentChangeDirection === 'down' ? brand.danger
                           : brand.text,
                      fontFamily: 'Georgia, serif',
                    }}>
                      {s.rentChangePercent > 0 ? '+' : ''}{s.rentChangePercent.toFixed(1)}%
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p style={{ color: brand.textMuted }} className="mb-1">Prior lease</p>
                      <p style={{ color: brand.text }}><strong>{s.priorLease.tenant}</strong></p>
                      <p style={{ color: brand.textMuted }}>{fmtR(s.priorLease.monthlyRent)}/mo</p>
                      <p style={{ color: brand.textMuted }}>{formatDate(s.priorLease.startDate)} → {formatDate(s.priorLease.endDate)}</p>
                    </div>
                    <div>
                      <p style={{ color: brand.textMuted }} className="mb-1">Current lease</p>
                      <p style={{ color: brand.text }}><strong>{summaryLease.tenant}</strong></p>
                      <p style={{ color: brand.textMuted }}>{fmtR(s.monthlyRent)}/mo</p>
                      <p style={{ color: brand.textMuted }}>{formatDate(summaryLease.startDate)} → {formatDate(summaryLease.endDate)}</p>
                    </div>
                  </div>
                  <p className="text-xs mt-3" style={{ color: brand.textMuted }}>
                    Monthly difference: <strong style={{ color: brand.text }}>{s.rentChangeAbsolute > 0 ? '+' : ''}{fmtR(s.rentChangeAbsolute)}</strong>
                    {' · '}
                    Over the new term: <strong style={{ color: brand.text }}>{s.rentChangeAbsolute > 0 ? '+' : ''}{fmtR(s.rentChangeAbsolute * s.monthsTotal)}</strong> vs flat
                  </p>
                </div>
              ) : (
                <div className="mb-4 p-3 rounded text-xs flex items-start gap-2" style={{ backgroundColor: brand.cream, color: brand.textMuted }}>
                  <Info size={14} className="flex-shrink-0 mt-0.5" />
                  <span>This lease appears to be <strong>new</strong> — no prior lease was found at this property/unit or for this tenant within the last 90 days.</span>
                </div>
              )}

              {/* Pipeline meta */}
              <div className="p-3 rounded text-xs" style={{ backgroundColor: brand.cream }}>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span style={{ color: brand.textMuted }}>Stage:</span>{' '}
                    <span style={{ color: brand.text }}>{LEASE_STAGES[summaryLease.pipelineStage]?.label || summaryLease.pipelineStage}</span>
                  </div>
                  <div>
                    <span style={{ color: brand.textMuted }}>Assigned:</span>{' '}
                    <span style={{ color: brand.text }}>{summaryLease.assignedTo || '—'}</span>
                  </div>
                  {summaryLease.docusignEnvelopeId && (
                    <div className="col-span-2">
                      <span style={{ color: brand.textMuted }}>DocuSign envelope:</span>{' '}
                      <span style={{ color: brand.text, fontFamily: 'monospace' }}>{summaryLease.docusignEnvelopeId}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
                <Button variant="ghost" onClick={() => setSummaryLease(null)}>Close</Button>
                <Button variant="primary" icon={Edit2} onClick={() => { setSummaryLease(null); openEdit(summaryLease); }}>Edit lease</Button>
              </div>
            </>
          );
        })()}
      </Modal>

      <Modal open={docusignModalOpen} onClose={() => !docusignSending && setDocusignModalOpen(false)} title="Send Lease to DocuSign" size="md">
        {docusignLease && (
          <>
            {/* Lease summary header */}
            <div className="mb-4 p-3 rounded" style={{ backgroundColor: brand.cream }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold" style={{ color: brand.navy }}>{docusignLease.tenant}</p>
                <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: docusignLease.type === 'commercial' ? brand.goldPale : '#D8E8DE', color: docusignLease.type === 'commercial' ? brand.gold : brand.success }}>
                  {docusignLease.type === 'commercial' ? 'Commercial' : 'Residential'}
                </span>
              </div>
              <p className="text-xs" style={{ color: brand.textMuted }}>{docusignLease.property} · {docusignLease.unit}</p>
              <p className="text-xs mt-1" style={{ color: brand.textMuted }}>
                R {Number(docusignLease.monthlyRent).toLocaleString()}/mo · {formatDate(docusignLease.startDate)} → {formatDate(docusignLease.endDate)}
              </p>
            </div>

            {/* Connection status banner */}
            {docusignConnected ? (
              <div className="p-3 rounded mb-4 text-xs flex items-start gap-2" style={{ backgroundColor: brand.successLight, color: brand.success }}>
                <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                <span>
                  <strong>DocuSign connected.</strong> {integrations?.docusign?.environment === 'prod' ? 'Production' : 'Demo'} account · {integrations?.docusign?.userEmail || integrations?.docusign?.accountId}
                </span>
              </div>
            ) : (
              <div className="p-3 rounded mb-4 text-xs flex items-start gap-2" style={{ backgroundColor: brand.warningLight, color: brand.warning }}>
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span><strong>DocuSign isn't connected.</strong> The lease will move to "On DocuSign" with a placeholder tracking ID, but no real envelope is created. Configure in Settings → Integrations.</span>
              </div>
            )}

            <Field label="Signer Email" required hint="The tenant will receive a DocuSign envelope at this address">
              <Input
                type="email"
                value={docusignEmail}
                onChange={(e) => setDocusignEmail(e.target.value)}
                placeholder="signer@example.com"
                autoFocus
              />
            </Field>

            {docusignConnected && (
              <Field label="Lease document (.docx)" hint="Upload the lease — anchor strings inside the doc (\\sig_tenant\\, \\date_tenant\\, etc.) determine where signature fields appear">
                <div
                  className="rounded p-4 text-center cursor-pointer"
                  style={{
                    border: `2px dashed ${docusignDocFile ? brand.gold : brand.border}`,
                    backgroundColor: docusignDocFile ? brand.goldPale : '#FAFAF6',
                  }}
                  onClick={() => document.getElementById('ds-doc-file-input')?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer?.files?.[0];
                    if (f) setDocusignDocFile(f);
                  }}
                >
                  <input
                    id="ds-doc-file-input"
                    type="file"
                    accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setDocusignDocFile(f); e.target.value = ''; }}
                  />
                  {docusignDocFile ? (
                    <>
                      <FileCheck size={20} style={{ color: brand.gold }} className="mx-auto mb-1" />
                      <p className="text-xs font-medium" style={{ color: brand.text }}>{docusignDocFile.name}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: brand.textMuted }}>{Math.round(docusignDocFile.size / 1024)} KB — click to replace</p>
                    </>
                  ) : (
                    <>
                      <Upload size={20} style={{ color: brand.textMuted }} className="mx-auto mb-1" />
                      <p className="text-xs" style={{ color: brand.textMuted }}>Click or drop the lease .docx (or .pdf) here</p>
                      <p className="text-[10px] mt-0.5" style={{ color: brand.textMuted }}>Without a file, this just marks the lease as on-DocuSign locally — no envelope is created</p>
                    </>
                  )}
                </div>
              </Field>
            )}

            {docusignSending && (
              <div className="p-3 rounded mb-3 text-xs flex items-center gap-2" style={{ backgroundColor: brand.cream, color: brand.text }}>
                <RefreshCw size={14} className="animate-spin" style={{ color: brand.gold }} />
                <span>
                  {docusignConnected && docusignDocFile
                    ? 'Encoding document, creating envelope on DocuSign, emailing signer…'
                    : 'Recording on-DocuSign stage…'}
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
              <Button variant="ghost" onClick={() => { setDocusignDocFile(null); setDocusignModalOpen(false); }} disabled={docusignSending}>Cancel</Button>
              <Button variant="primary" icon={docusignSending ? RefreshCw : Send} onClick={sendToDocuSign} disabled={docusignSending || !docusignEmail}>
                {docusignSending ? 'Sending…' : (docusignConnected && docusignDocFile ? 'Send Real Envelope' : 'Send to DocuSign')}
              </Button>
            </div>
          </>
        )}
      </Modal>

        </>
      )}
    </div>
  );
};

// ============================================================
// MAINTENANCE REQUESTS
// ============================================================
const MaintenanceSection = ({ maintenance, setMaintenance, properties, employees, showToast, logAction }) => {
  const [filterStatus, setFilterStatus] = useState('All');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ property: '', unit: '', issueType: 'Plumbing', description: '', priority: 'Medium', status: 'Open', reportedBy: '', assignedTo: '' });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const schema = {
    property: [validators.required],
    unit: [validators.required],
    issueType: [validators.required],
    description: [(v) => !v || v.length < 10 ? 'Please describe the issue in at least 10 characters' : ''],
    priority: [validators.required],
    reportedBy: [validators.required],
  };

  const handleField = (f, v) => {
    setForm({ ...form, [f]: v });
    if (touched[f]) setErrors(validateForm({ ...form, [f]: v }, schema));
  };
  const handleBlur = (f) => {
    setTouched({ ...touched, [f]: true });
    setErrors(validateForm(form, schema));
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ property: '', unit: '', issueType: 'Plumbing', description: '', priority: 'Medium', status: 'Open', reportedBy: '', assignedTo: '' });
    setErrors({}); setTouched({}); setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({ ...item });
    setErrors({}); setTouched({}); setModalOpen(true);
  };

  const handleSubmit = () => {
    const allTouched = Object.keys(schema).reduce((a, k) => ({ ...a, [k]: true }), {});
    setTouched(allTouched);
    const newErrors = validateForm(form, schema);
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      showToast('Please fix the errors before saving', 'error');
      return;
    }
    if (editingId) {
      setMaintenance(maintenance.map(m => m.id === editingId ? { ...form, id: editingId, completedDate: form.status === 'Completed' ? (form.completedDate || todayISO()) : '' } : m));
      logAction && logAction(`Updated maintenance request at ${form.property}`);
      showToast('Maintenance request updated', 'success');
    } else {
      const newId = Math.max(0, ...maintenance.map(m => m.id)) + 1;
      setMaintenance([...maintenance, { ...form, id: newId, reportedDate: todayISO(), completedDate: '' }]);
      logAction && logAction(`Created maintenance request at ${form.property}`);
      showToast('Maintenance request created', 'success');
    }
    setModalOpen(false);
  };

  const updateStatus = (id, status) => {
    setMaintenance(maintenance.map(m => m.id === id ? { ...m, status, completedDate: status === 'Completed' ? todayISO() : m.completedDate } : m));
    const item = maintenance.find(m => m.id === id);
    logAction && logAction(`Marked maintenance "${item?.issueType}" at ${item?.property} as ${status}`);
    showToast(`Status changed to ${status}`, 'success');
  };

  const openCount = maintenance.filter(m => m.status === 'Open').length;
  const inProgressCount = maintenance.filter(m => m.status === 'In Progress').length;
  const completedCount = maintenance.filter(m => m.status === 'Completed').length;
  const highPriorityCount = maintenance.filter(m => m.priority === 'High' && m.status !== 'Completed').length;

  const filtered = maintenance.filter(m => {
    const matchesStatus = filterStatus === 'All' || m.status === filterStatus;
    const matchesSearch = `${m.property} ${m.unit} ${m.issueType} ${m.description} ${m.reportedBy}`.toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Operations</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Maintenance Requests</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Track repair requests, assign technicians, and monitor resolution times.</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={openCreate}>Log Request</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Open', value: openCount, color: brand.danger, icon: AlertCircle },
          { label: 'In Progress', value: inProgressCount, color: brand.warning, icon: Activity },
          { label: 'Completed', value: completedCount, color: brand.success, icon: CheckCircle2 },
          { label: 'High Priority Open', value: highPriorityCount, color: brand.danger, icon: AlertTriangle },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>{s.label}</p>
                <Icon size={14} style={{ color: s.color }} />
              </div>
              <p className="text-2xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{s.value}</p>
            </Card>
          );
        })}
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: brand.textMuted }} />
            <input
              type="text"
              placeholder="Search by property, issue, or reporter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded outline-none"
              style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['All', 'Open', 'In Progress', 'Completed'].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className="px-3 py-1.5 text-xs font-medium rounded transition-all"
                style={{ backgroundColor: filterStatus === s ? brand.navy : 'transparent', color: filterStatus === s ? '#fff' : brand.text, border: `1px solid ${filterStatus === s ? brand.navy : brand.border}` }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wrench}
            title="No maintenance requests"
            message={search || filterStatus !== 'All' ? 'No requests match your filters.' : 'Log a new request to get started.'}
            action={!search && filterStatus === 'All' && <Button variant="primary" icon={Plus} onClick={openCreate}>Log First Request</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((m) => (
            <Card key={m.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusBadge status={m.priority} />
                    <StatusBadge status={m.status} />
                    <span className="text-xs px-2 py-1 rounded font-medium" style={{ backgroundColor: brand.cream, color: brand.navy }}>{m.issueType}</span>
                  </div>
                  <h3 className="text-base font-semibold mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>
                    {m.property} · {m.unit}
                  </h3>
                  <p className="text-sm mb-3" style={{ color: brand.text }}>{m.description}</p>
                  <div className="flex flex-wrap gap-4 text-xs" style={{ color: brand.textMuted }}>
                    <span><span className="font-medium">Reported by:</span> {m.reportedBy}</span>
                    <span><span className="font-medium">Date:</span> {formatDate(m.reportedDate)}</span>
                    {m.assignedTo && <span><span className="font-medium">Assigned:</span> {m.assignedTo}</span>}
                    {m.completedDate && <span><span className="font-medium">Completed:</span> {formatDate(m.completedDate)}</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  {m.status !== 'Completed' && (
                    <>
                      {m.status === 'Open' && (
                        <button onClick={() => updateStatus(m.id, 'In Progress')} className="text-xs px-2 py-1 rounded whitespace-nowrap" style={{ color: brand.warning, border: `1px solid ${brand.warning}` }}>Start Work</button>
                      )}
                      {m.status === 'In Progress' && (
                        <button onClick={() => updateStatus(m.id, 'Completed')} className="text-xs px-2 py-1 rounded whitespace-nowrap" style={{ color: brand.success, border: `1px solid ${brand.success}` }}>Mark Complete</button>
                      )}
                    </>
                  )}
                  <button onClick={() => openEdit(m)} className="text-xs px-2 py-1 rounded whitespace-nowrap" style={{ color: brand.navy, border: `1px solid ${brand.border}` }}>Edit</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Edit Maintenance Request' : 'Log Maintenance Request'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Property" required error={touched.property && errors.property}>
            <Select value={form.property} onChange={(e) => handleField('property', e.target.value)} error={touched.property && errors.property}>
              <option value="">Select property...</option>
              {properties.map(p => <option key={p.id} value={p.address.split(',')[0]}>{p.address.split(',')[0]}</option>)}
            </Select>
          </Field>
          <Field label="Unit / Location" required error={touched.unit && errors.unit}>
            <Input value={form.unit} onChange={(e) => handleField('unit', e.target.value)} onBlur={() => handleBlur('unit')} error={touched.unit && errors.unit} placeholder="e.g. Shop 4 or Common Area" />
          </Field>
          <Field label="Issue Type" required>
            <Select value={form.issueType} onChange={(e) => handleField('issueType', e.target.value)}>
              <option>Plumbing</option><option>Electrical</option><option>HVAC</option><option>Security</option><option>Structural</option><option>Cleaning</option><option>Pest Control</option><option>General</option>
            </Select>
          </Field>
          <Field label="Priority" required>
            <Select value={form.priority} onChange={(e) => handleField('priority', e.target.value)}>
              <option>Low</option><option>Medium</option><option>High</option>
            </Select>
          </Field>
          <Field label="Reported By" required error={touched.reportedBy && errors.reportedBy}>
            <Input value={form.reportedBy} onChange={(e) => handleField('reportedBy', e.target.value)} onBlur={() => handleBlur('reportedBy')} error={touched.reportedBy && errors.reportedBy} placeholder="Tenant or staff name" />
          </Field>
          <Field label="Assigned To">
            <Select value={form.assignedTo} onChange={(e) => handleField('assignedTo', e.target.value)}>
              <option value="">Unassigned</option>
              {employees.filter(e => e.status === 'Active').map(e => <option key={e.id} value={`${e.firstName} ${e.lastName}`}>{e.firstName} {e.lastName}</option>)}
            </Select>
          </Field>
          {editingId && (
            <Field label="Status">
              <Select value={form.status} onChange={(e) => handleField('status', e.target.value)}>
                <option>Open</option><option>In Progress</option><option>Completed</option><option>Cancelled</option>
              </Select>
            </Field>
          )}
        </div>
        <Field label="Description" required error={touched.description && errors.description} hint="Minimum 10 characters">
          <textarea
            value={form.description}
            onChange={(e) => handleField('description', e.target.value)}
            onBlur={() => handleBlur('description')}
            rows={4}
            className="w-full px-3 py-2 text-sm rounded outline-none transition-all resize-none"
            style={{ backgroundColor: '#fff', border: `1px solid ${touched.description && errors.description ? brand.danger : brand.border}`, color: brand.text }}
            placeholder="Describe the issue in detail..."
          />
        </Field>
        <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit}>{editingId ? 'Save Changes' : 'Log Request'}</Button>
        </div>
      </Modal>
    </div>
  );
};

// ============================================================
// REPORTS
// ============================================================
const ReportsSection = ({ properties, leases, debtors, inspections, maintenance, timeEntries, employees }) => {
  const [period, setPeriod] = useState('This Month');

  // Outstanding by property
  const outstandingByProperty = useMemo(() => {
    const map = {};
    debtors.forEach(d => {
      const key = d.property;
      if (!map[key]) map[key] = 0;
      map[key] += d.outstandingBalance;
    });
    return Object.entries(map).map(([name, value]) => ({ name: name.length > 20 ? name.slice(0, 18) + '…' : name, value }));
  }, [debtors]);

  // Payment status distribution
  const paymentStatusData = useMemo(() => {
    const counts = { Paid: 0, Unpaid: 0, Partial: 0, Overdue: 0 };
    debtors.forEach(d => { counts[d.status] = (counts[d.status] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [debtors]);

  // Inspection scores
  const inspectionScores = useMemo(() => {
    return inspections.filter(i => i.score).map(i => ({
      name: i.property.split(',')[0].split(' ').slice(0, 2).join(' '),
      score: i.score,
    }));
  }, [inspections]);

  // Occupancy by property
  const occupancyData = useMemo(() =>
    properties.map(p => ({
      name: p.address.split(',')[0].split(' ').slice(0, 2).join(' '),
      Occupied: p.occupied,
      Vacant: p.units - p.occupied,
    })),
  [properties]);

  // Lease expirations - leases ending in next 12 months
  const upcomingExpirations = useMemo(() => {
    const now = new Date();
    const oneYear = new Date(); oneYear.setFullYear(oneYear.getFullYear() + 1);
    return leases
      .filter(l => {
        const end = new Date(l.endDate);
        return end >= now && end <= oneYear;
      })
      .sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
  }, [leases]);

  const PIE_COLORS = [brand.success, brand.warning, brand.gold, brand.danger];

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Analytics</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Reports</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Portfolio insights, debtor analysis, inspection trends, and lease pipeline.</p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option>This Week</option><option>This Month</option><option>This Quarter</option><option>This Year</option>
          </Select>
          <Button variant="ghost" icon={Download}>Export PDF</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Outstanding by Property */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Outstanding by Property</h3>
              <p className="text-xs" style={{ color: brand.textMuted }}>Total owed per property in ZAR</p>
            </div>
            <BarChart3 size={16} style={{ color: brand.gold }} />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={outstandingByProperty}>
              <CartesianGrid strokeDasharray="3 3" stroke={brand.border} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: brand.textMuted }} />
              <YAxis tick={{ fontSize: 10, fill: brand.textMuted }} tickFormatter={(v) => `R${(v / 1000).toFixed(0)}k`} />
              <RTooltip formatter={(v) => formatCurrency(v)} contentStyle={{ fontSize: 12, border: `1px solid ${brand.border}` }} />
              <Bar dataKey="value" fill={brand.danger} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Payment Status Distribution */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Payment Status</h3>
              <p className="text-xs" style={{ color: brand.textMuted }}>Tenant distribution across statuses</p>
            </div>
            <Activity size={16} style={{ color: brand.gold }} />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={paymentStatusData} dataKey="value" nameKey="name" outerRadius={80} label={(entry) => `${entry.name}: ${entry.value}`} labelLine={false} style={{ fontSize: 11 }}>
                {paymentStatusData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <RTooltip contentStyle={{ fontSize: 12, border: `1px solid ${brand.border}` }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        {/* Occupancy */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Occupancy by Property</h3>
              <p className="text-xs" style={{ color: brand.textMuted }}>Occupied vs vacant units</p>
            </div>
            <Home size={16} style={{ color: brand.gold }} />
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={occupancyData}>
              <CartesianGrid strokeDasharray="3 3" stroke={brand.border} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: brand.textMuted }} />
              <YAxis tick={{ fontSize: 10, fill: brand.textMuted }} />
              <RTooltip contentStyle={{ fontSize: 12, border: `1px solid ${brand.border}` }} />
              <Bar dataKey="Occupied" stackId="a" fill={brand.success} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Vacant" stackId="a" fill={brand.borderDark} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Inspection Scores */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Inspection Scores</h3>
              <p className="text-xs" style={{ color: brand.textMuted }}>Quality scores from completed inspections</p>
            </div>
            <Star size={16} style={{ color: brand.gold }} />
          </div>
          {inspectionScores.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={inspectionScores}>
                <CartesianGrid strokeDasharray="3 3" stroke={brand.border} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: brand.textMuted }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: brand.textMuted }} />
                <RTooltip contentStyle={{ fontSize: 12, border: `1px solid ${brand.border}` }} />
                <Bar dataKey="score" fill={brand.gold} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-sm" style={{ color: brand.textMuted }}>
              No completed inspections yet
            </div>
          )}
        </Card>
      </div>

      {/* Upcoming Lease Expirations */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Upcoming Lease Expirations</h3>
            <p className="text-xs" style={{ color: brand.textMuted }}>Leases ending in the next 12 months</p>
          </div>
          <Calendar size={16} style={{ color: brand.gold }} />
        </div>
        {upcomingExpirations.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: brand.textMuted }}>No lease expirations in the next 12 months.</p>
        ) : (
          <div className="space-y-2">
            {upcomingExpirations.map((l) => {
              const daysUntil = Math.ceil((new Date(l.endDate) - new Date()) / (1000 * 60 * 60 * 24));
              return (
                <div key={l.id} className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${brand.border}` }}>
                  <div>
                    <p className="text-sm font-medium" style={{ color: brand.text }}>{l.tenant}</p>
                    <p className="text-xs" style={{ color: brand.textMuted }}>{l.property} · Unit {l.unit} · {formatCurrency(l.monthlyRent)}/mo</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold" style={{ color: daysUntil < 60 ? brand.danger : brand.text }}>
                      {formatDate(l.endDate)}
                    </p>
                    <p className="text-xs" style={{ color: brand.textMuted }}>{daysUntil} days remaining</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

// ============================================================
// DEBTORS
// ============================================================
// Slide-over with the account's financial snapshot, workflow controls, and
// notes thread. Closes when `debtor` is null. Notes are added via onAddNote
// and the parent persists them keyed on accountNumber.
const DebtorDetailPanel = ({ debtor, onClose, account, notes, onUpdateAccount, onAddNote }) => {
  const [draftBody, setDraftBody] = useState('');
  const [draftAction, setDraftAction] = useState('NOTE');
  const [showForm, setShowForm] = useState(false);
  // Reset form when switching accounts
  useEffect(() => { setDraftBody(''); setDraftAction('NOTE'); setShowForm(false); }, [debtor?.accountNumber]);

  if (!debtor) return null;
  const flag = computeDebtorFlag(debtor);
  const ratio = debtor.paymentRatio != null ? debtor.paymentRatio : computePaymentRatio(debtor);
  const ratioPct = isFinite(ratio) ? Math.round(ratio * 100) : null;
  const reason = computeDebtorReason(debtor);
  const stat = DEBTOR_STATUSES.find(s => s.id === account?.status) || DEBTOR_STATUSES[0];
  const collector = COLLECTORS.find(c => c.id === account?.assignedTo);

  const quickAction = (actionType) => {
    setDraftAction(actionType);
    setDraftBody(ACTION_TEMPLATES[actionType] || '');
    setShowForm(true);
  };

  const submitNote = () => {
    if (!draftBody.trim()) return;
    onAddNote({ actionType: draftAction, body: draftBody });
    setDraftBody('');
    setDraftAction('NOTE');
    setShowForm(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" style={{ backgroundColor: 'rgba(15,30,46,0.4)' }} onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-y-auto animate-slide-in-right"
        style={{ backgroundColor: '#fff', borderLeft: `1px solid ${brand.borderDark}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-5 py-4" style={{ backgroundColor: brand.navy, color: '#fff' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wider rounded" style={{ backgroundColor: flag === 'BAD' ? brand.danger : flag === 'WARNING' ? brand.warning : brand.success, color: '#fff' }}>{flag}</span>
                {account?.pinned && <span className="px-2 py-0.5 text-[10px] rounded" style={{ backgroundColor: brand.gold, color: brand.navy }}>PINNED</span>}
              </div>
              <h2 className="text-lg font-semibold truncate" style={{ fontFamily: 'Georgia, serif' }}>{debtor.tenant || debtor.tenantName}</h2>
              <p className="text-xs" style={{ color: brand.gold }}>
                Account #{debtor.accountNumber || '—'}
                {debtor.property ? <> · {debtor.property}</> : null}
                {debtor.unit ? <> · {debtor.unit}</> : null}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded hover:bg-white/10 transition-colors">
              <X size={18} style={{ color: '#fff' }} />
            </button>
          </div>
        </div>

        {/* Workflow controls */}
        <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-3 gap-3" style={{ borderBottom: `1px solid ${brand.border}` }}>
          <div>
            <p className="text-[10px] tracking-wider uppercase mb-1" style={{ color: brand.textMuted }}>Assigned to</p>
            <select
              value={account?.assignedTo || ''}
              onChange={(e) => onUpdateAccount({ assignedTo: e.target.value || null })}
              className="w-full px-2 py-1.5 text-sm rounded outline-none font-medium"
              style={{ border: `1px solid ${brand.border}`, color: collector ? '#fff' : brand.text, backgroundColor: collector?.color || '#fff' }}
            >
              <option value="">Unassigned</option>
              {COLLECTORS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[10px] tracking-wider uppercase mb-1" style={{ color: brand.textMuted }}>Status</p>
            <select
              value={account?.status || 'NEW'}
              onChange={(e) => onUpdateAccount({ status: e.target.value })}
              className="w-full px-2 py-1.5 text-sm rounded outline-none font-medium"
              style={{ border: `1px solid ${stat.color}`, color: '#fff', backgroundColor: stat.color }}
            >
              {DEBTOR_STATUSES.map(s => <option key={s.id} value={s.id} style={{ color: brand.text, backgroundColor: '#fff' }}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <p className="text-[10px] tracking-wider uppercase mb-1" style={{ color: brand.textMuted }}>Next follow-up</p>
            <input
              type="date"
              value={account?.nextFollowUp || ''}
              onChange={(e) => onUpdateAccount({ nextFollowUp: e.target.value || null })}
              className="w-full px-2 py-1.5 text-sm rounded outline-none"
              style={{ border: `1px solid ${brand.border}`, color: brand.text }}
            />
          </div>
        </div>

        {/* Financial snapshot */}
        <div className="px-5 py-4" style={{ borderBottom: `1px solid ${brand.border}` }}>
          <p className="text-xs font-semibold tracking-wider uppercase mb-3" style={{ color: brand.gold }}>Financial Snapshot</p>
          {[
            ['Arrears B/f', debtor.arrearsBroughtForward],
            ['Rent / Levy', debtor.rentLevy],
            ['Recoveries', debtor.recoveries],
            ['Adjustments', debtor.adjustments],
            ['Receipts', debtor.receipts],
          ].map(([label, val]) => (
            <div key={label} className="flex justify-between py-1 text-sm" style={{ color: brand.text }}>
              <span>{label}</span>
              <span style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{val != null ? `R ${Number(val).toLocaleString()}` : '—'}</span>
            </div>
          ))}
          <div className="flex justify-between py-2 mt-1 text-sm font-semibold" style={{ borderTop: `1px solid ${brand.border}`, color: brand.navy }}>
            <span>Current Balance</span>
            <span style={{ fontFamily: 'ui-monospace, Consolas, monospace', color: Number(debtor.currentBalance ?? debtor.outstandingBalance ?? 0) > 0 ? brand.danger : brand.success }}>
              R {Number(debtor.currentBalance ?? debtor.outstandingBalance ?? 0).toLocaleString()}
            </span>
          </div>
          {ratioPct != null && (
            <div className="flex justify-between py-1 text-xs" style={{ color: brand.textMuted }}>
              <span>Payment Ratio</span>
              <span><strong style={{ color: ratioPct < 50 ? brand.danger : ratioPct < 80 ? brand.warning : brand.success }}>{ratioPct}%</strong></span>
            </div>
          )}
          {reason && (
            <p className="text-[11px] mt-2 italic" style={{ color: brand.textMuted }}>Reason: {reason}</p>
          )}
          {debtor.notes && (
            <p className="text-[11px] mt-2 italic" style={{ color: brand.textMuted }}>MDA note: {debtor.notes}</p>
          )}
        </div>

        {/* Quick actions */}
        <div className="px-5 py-3 flex gap-2 flex-wrap" style={{ borderBottom: `1px solid ${brand.border}` }}>
          <button onClick={() => quickAction('CALL')} className="text-xs px-3 py-1.5 rounded btn-press flex items-center gap-1" style={{ border: `1px solid ${brand.border}`, color: brand.text }}>
            <Phone size={12} /> Log call
          </button>
          <button onClick={() => quickAction('EMAIL')} className="text-xs px-3 py-1.5 rounded btn-press flex items-center gap-1" style={{ border: `1px solid ${brand.border}`, color: brand.text }}>
            <Mail size={12} /> Log email
          </button>
          <button onClick={() => quickAction('SMS')} className="text-xs px-3 py-1.5 rounded btn-press" style={{ border: `1px solid ${brand.border}`, color: brand.text }}>Log SMS</button>
          <button onClick={() => quickAction('PAYMENT_PLAN')} className="text-xs px-3 py-1.5 rounded btn-press" style={{ border: `1px solid ${brand.border}`, color: brand.text }}>Payment plan</button>
          <button onClick={() => { setDraftAction('NOTE'); setDraftBody(''); setShowForm(true); }} className="text-xs px-3 py-1.5 rounded btn-press ml-auto" style={{ backgroundColor: brand.gold, color: '#fff' }}>+ Add note</button>
        </div>

        {/* Note form */}
        {showForm && (
          <div className="px-5 py-3" style={{ backgroundColor: brand.cream, borderBottom: `1px solid ${brand.border}` }}>
            <div className="flex gap-2 mb-2 items-center">
              <span className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>Action</span>
              <select value={draftAction} onChange={(e) => setDraftAction(e.target.value)} className="text-xs px-2 py-1 rounded" style={{ border: `1px solid ${brand.border}` }}>
                {DEBTOR_ACTIONS.filter(a => !['STATUS_CHANGE', 'ASSIGNMENT'].includes(a.id)).map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitNote(); }}
              rows={4}
              autoFocus
              placeholder="Note body…"
              className="w-full px-3 py-2 text-sm rounded outline-none"
              style={{ border: `1px solid ${brand.border}`, color: brand.text, fontFamily: 'inherit' }}
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button onClick={() => { setShowForm(false); setDraftBody(''); }} className="text-xs px-3 py-1 rounded" style={{ border: `1px solid ${brand.border}`, color: brand.text }}>Cancel</button>
              <button onClick={submitNote} className="text-xs px-3 py-1 rounded" style={{ backgroundColor: brand.navy, color: '#fff' }}>Save note (⌘↵)</button>
            </div>
          </div>
        )}

        {/* Notes thread */}
        <div className="px-5 py-4">
          <p className="text-xs font-semibold tracking-wider uppercase mb-3" style={{ color: brand.gold }}>Notes ({notes.length})</p>
          {notes.length === 0 ? (
            <p className="text-sm italic text-center py-8" style={{ color: brand.textMuted }}>No notes yet. Use the quick actions above or click + Add note.</p>
          ) : (
            <div className="space-y-3">
              {notes.map(n => (
                <div key={n.id} className="p-3 rounded" style={{ border: `1px solid ${brand.border}`, backgroundColor: '#fff' }}>
                  <div className="flex items-center gap-2 mb-1 text-[11px]" style={{ color: brand.textMuted }}>
                    <strong style={{ color: brand.text }}>{n.author}</strong>
                    <span>·</span>
                    <span>{new Date(n.timestamp).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <span>·</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: brand.cream, color: brand.navy }}>{n.actionType}</span>
                  </div>
                  <p className="text-sm whitespace-pre-line" style={{ color: brand.text }}>{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const DebtorsSection = ({ debtors, setDebtors, debtorAccounts = {}, setDebtorAccounts, debtorNotes = {}, setDebtorNotes, currentUser, showToast, logAction }) => {
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterFlag, setFilterFlag] = useState('All');
  const [filterProperty, setFilterProperty] = useState('All');
  const [filterMinDays, setFilterMinDays] = useState('');
  const [sortBy, setSortBy] = useState('outstandingDesc'); // outstandingDesc | daysDesc | tenant
  const [search, setSearch] = useState('');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedDebtor, setSelectedDebtor] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [lastImport, setLastImport] = useStoredState('ep:debtorsLastImport', null);
  const uploadInputRef = useRef(null);

  const handleUploadDebtors = async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      showToast('Upload an MDA Tenant/Debtor Financial Summary (.xls or .xlsx)', 'error');
      return;
    }
    setUploading(true);
    try {
      const { period, rows: parsed, grandTotals } = await parseDebtorFinancial(file);
      if (parsed.length === 0) {
        showToast('No debtor rows found — is this the MDA Tenant/Debtor Financial Summary?', 'error');
        return;
      }
      setDebtors(parsed);

      // Upsert DebtorAccount records keyed on accountNumber.
      // - Existing accounts keep their assignment/status/follow-up/pin
      // - New accounts get default state (NEW, unassigned)
      // - tenantName/propertyName refreshed from latest snapshot
      let newAccounts = 0;
      setDebtorAccounts(prev => {
        const next = { ...prev };
        parsed.forEach(d => {
          const key = d.accountNumber;
          if (!key) return;
          if (!next[key]) { next[key] = { ...newDebtorAccount(), tenantName: d.tenantName, propertyName: d.propertyName }; newAccounts++; }
          else { next[key] = { ...next[key], tenantName: d.tenantName, propertyName: d.propertyName }; }
        });
        return next;
      });

      const bad = parsed.filter(d => computeDebtorFlag(d) === 'BAD').length;
      const warn = parsed.filter(d => computeDebtorFlag(d) === 'WARNING').length;
      setLastImport({ at: new Date().toISOString(), source: file.name, count: parsed.length, bad, warn, period, grandTotals });
      logAction && logAction(`Imported ${parsed.length} debtors from ${file.name} — period ${period || 'unknown'} (${bad} BAD, ${warn} WARNING, ${newAccounts} new accounts)`);
      showToast(`Imported ${parsed.length} debtors${period ? ' for ' + period : ''}. ${bad} BAD, ${warn} WARNING. ${newAccounts} new accounts.`, 'success');
    } catch (err) {
      showToast('Import failed: ' + (err.message || String(err)).slice(0, 120), 'error');
      // eslint-disable-next-line no-console
      console.error('[Debtors import]', err);
    } finally {
      setUploading(false);
    }
  };

  // ----- Collections workflow helpers -----
  const getAccount = (d) => d?.accountNumber ? (debtorAccounts[d.accountNumber] || newDebtorAccount()) : newDebtorAccount();
  const getNotes = (d) => d?.accountNumber ? (debtorNotes[d.accountNumber] || []) : [];

  const updateAccount = (accountNumber, patch) => {
    if (!accountNumber) return;
    setDebtorAccounts(prev => ({
      ...prev,
      [accountNumber]: { ...newDebtorAccount(), ...prev[accountNumber], ...patch },
    }));
  };

  const addNote = (accountNumber, { actionType = 'NOTE', body }) => {
    if (!accountNumber || !body?.trim()) return;
    const note = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      accountNumber,
      author: currentUser ? `${currentUser.firstName} ${currentUser.lastName}`.trim() : 'Unknown',
      actionType,
      body: body.trim(),
      timestamp: new Date().toISOString(),
    };
    setDebtorNotes(prev => ({
      ...prev,
      [accountNumber]: [note, ...(prev[accountNumber] || [])],
    }));
    return note;
  };

  // Filter / sidebar state
  const [filterCollector, setFilterCollector] = useState('ALL'); // ALL | UNASSIGNED | OVERDUE | <collectorId>
  const [detailAccount, setDetailAccount] = useState(null); // debtor object opened in slide-over

  const todayISOStr = todayISO();
  // Per-collector counts + special groups
  const counts = useMemo(() => {
    const c = { ALL: debtors.length, UNASSIGNED: 0, OVERDUE: 0 };
    COLLECTORS.forEach(col => { c[col.id] = 0; });
    debtors.forEach(d => {
      const acc = getAccount(d);
      if (!acc.assignedTo) c.UNASSIGNED++;
      else c[acc.assignedTo] = (c[acc.assignedTo] || 0) + 1;
      if (acc.nextFollowUp && acc.nextFollowUp < todayISOStr) c.OVERDUE++;
    });
    return c;
  }, [debtors, debtorAccounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const paidCount = debtors.filter(d => d.status === 'Paid').length;
  const unpaidCount = debtors.filter(d => d.status === 'Unpaid').length;
  const partialCount = debtors.filter(d => d.status === 'Partial').length;
  const overdueCount = debtors.filter(d => d.status === 'Overdue').length;
  const totalOutstanding = debtors.reduce((s, d) => s + d.outstandingBalance, 0);
  const collectionRate = ((paidCount / debtors.length) * 100).toFixed(0);

  const propertyOptions = useMemo(
    () => Array.from(new Set(debtors.map(d => d.property).filter(Boolean))).sort(),
    [debtors]
  );

  const filtered = useMemo(() => {
    const minDays = Number(filterMinDays) || 0;
    const result = debtors.filter(d => {
      // Collector sidebar filter
      const acc = getAccount(d);
      if (filterCollector !== 'ALL') {
        if (filterCollector === 'UNASSIGNED' && acc.assignedTo) return false;
        else if (filterCollector === 'OVERDUE' && !(acc.nextFollowUp && acc.nextFollowUp < todayISOStr)) return false;
        else if (filterCollector !== 'UNASSIGNED' && filterCollector !== 'OVERDUE' && acc.assignedTo !== filterCollector) return false;
      }
      if (filterStatus !== 'All' && d.status !== filterStatus) return false;
      if (filterFlag !== 'All' && computeDebtorFlag(d) !== filterFlag) return false;
      if (filterProperty !== 'All' && d.property !== filterProperty) return false;
      if (minDays > 0 && (Number(d.daysOverdue) || 0) < minDays) return false;
      const q = search.toLowerCase();
      if (q && !`${d.tenant} ${d.property} ${d.unit} ${d.accountNumber || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // Sort
    const sorted = [...result];
    if (sortBy === 'outstandingDesc') sorted.sort((a, b) => (b.outstandingBalance || 0) - (a.outstandingBalance || 0));
    else if (sortBy === 'daysDesc') sorted.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
    else if (sortBy === 'tenant') sorted.sort((a, b) => (a.tenant || '').localeCompare(b.tenant || ''));
    return sorted;
  }, [debtors, filterStatus, filterFlag, filterProperty, filterMinDays, sortBy, search]);

  const badCount = debtors.filter(d => computeDebtorFlag(d) === 'BAD').length;
  const warnCount = debtors.filter(d => computeDebtorFlag(d) === 'WARNING').length;

  const openPayment = (debtor) => {
    setSelectedDebtor(debtor);
    setPaymentAmount(String(debtor.outstandingBalance));
    setPaymentError('');
    setPaymentModalOpen(true);
  };

  const recordPayment = () => {
    const amount = Number(paymentAmount);
    if (!paymentAmount || isNaN(amount)) {
      setPaymentError('Enter a valid amount');
      return;
    }
    if (amount <= 0) {
      setPaymentError('Amount must be greater than zero');
      return;
    }
    if (amount > selectedDebtor.outstandingBalance) {
      setPaymentError(`Amount cannot exceed outstanding balance of R ${selectedDebtor.outstandingBalance.toLocaleString()}`);
      return;
    }
    const newBalance = selectedDebtor.outstandingBalance - amount;
    const newStatus = newBalance === 0 ? 'Paid' : 'Partial';
    setDebtors(debtors.map(d => d.id === selectedDebtor.id ? {
      ...d,
      outstandingBalance: newBalance,
      status: newStatus,
      lastPaymentDate: new Date().toISOString().split('T')[0],
      daysOverdue: newBalance === 0 ? 0 : d.daysOverdue,
    } : d));
    showToast(`Payment of R ${amount.toLocaleString()} recorded for ${selectedDebtor.tenant}`, 'success');
    setPaymentModalOpen(false);
    setSelectedDebtor(null);
    setPaymentAmount('');
  };

  const sendReminder = (debtor) => {
    showToast(`Payment reminder sent to ${debtor.tenant}`, 'success');
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Collections</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Debtors</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>
            {lastImport
              ? `Tenant/Debtor Financial Summary${lastImport.period ? ' — Period: ' + lastImport.period : ''} · imported ${timeAgo(lastImport.at)} from ${lastImport.source} · ${lastImport.count} debtors`
              : 'Track tenant payments, outstanding balances, and overdue accounts.'}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={uploadInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadDebtors(f); e.target.value = ''; }}
          />
          <Button variant="gold" icon={Upload} onClick={() => uploadInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Importing…' : 'Upload Debtor Financial Summary'}
          </Button>
          <Button variant="ghost" icon={Download}>Export Report</Button>
          <Button variant="primary" icon={Mail} onClick={() => showToast('Reminders sent to all unpaid tenants', 'success')}>Send All Reminders</Button>
        </div>
      </div>

      {/* Collector sidebar + main content */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <aside className="space-y-2">
          <Card className="p-3">
            <p className="text-[10px] tracking-wider uppercase mb-2" style={{ color: brand.gold }}>Collections</p>
            {[
              { id: 'ALL', label: 'All Debtors', count: counts.ALL, color: brand.navy },
              { id: 'UNASSIGNED', label: 'Unassigned', count: counts.UNASSIGNED, color: brand.warning },
              { id: 'OVERDUE', label: 'Overdue Follow-ups', count: counts.OVERDUE, color: brand.danger },
            ].map(item => {
              const active = filterCollector === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setFilterCollector(item.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm rounded btn-press transition-colors mb-1"
                  style={{
                    backgroundColor: active ? brand.cream : 'transparent',
                    color: active ? brand.navy : brand.text,
                    fontWeight: active ? 600 : 400,
                    border: `1px solid ${active ? brand.gold : 'transparent'}`,
                  }}
                >
                  <span>{item.label}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: active ? item.color : brand.cream, color: active ? '#fff' : item.color }}>
                    {item.count}
                  </span>
                </button>
              );
            })}
          </Card>
          <Card className="p-3">
            <p className="text-[10px] tracking-wider uppercase mb-2" style={{ color: brand.gold }}>Collectors</p>
            {COLLECTORS.map(c => {
              const active = filterCollector === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setFilterCollector(c.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm rounded btn-press transition-colors mb-1"
                  style={{
                    backgroundColor: active ? c.color : 'transparent',
                    color: active ? '#fff' : brand.text,
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: active ? '#fff' : c.color }} />
                    {c.name}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: active ? 'rgba(255,255,255,0.2)' : brand.cream, color: active ? '#fff' : c.color }}>
                    {counts[c.id] || 0}
                  </span>
                </button>
              );
            })}
          </Card>
        </aside>

        <div className="min-w-0">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        {[
          { label: 'Paid', value: paidCount, color: brand.success, icon: CheckCircle2 },
          { label: 'Unpaid', value: unpaidCount, color: brand.warning, icon: AlertCircle },
          { label: 'Partial', value: partialCount, color: brand.warning, icon: AlertCircle },
          { label: 'Overdue', value: overdueCount, color: brand.danger, icon: AlertCircle },
          { label: 'Collection Rate', value: `${collectionRate}%`, color: brand.navy, icon: TrendingUp },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>{s.label}</p>
                <Icon size={14} style={{ color: s.color }} />
              </div>
              <p className="text-2xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{s.value}</p>
            </Card>
          );
        })}
      </div>

      {/* Outstanding banner */}
      {totalOutstanding > 0 && (
        <Card className="mb-4 p-4" style={{ backgroundColor: brand.dangerLight, borderColor: brand.danger }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle size={20} style={{ color: brand.danger }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: brand.danger }}>
                  Total Outstanding: R {totalOutstanding.toLocaleString()}
                </p>
                <p className="text-xs" style={{ color: brand.textMuted }}>
                  Across {unpaidCount + partialCount + overdueCount} tenant{(unpaidCount + partialCount + overdueCount) !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <Button variant="danger" size="sm" icon={Mail} onClick={() => showToast('Reminders sent', 'success')}>Action Required</Button>
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3">
          {/* Search */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: brand.textMuted }} />
              <input
                type="text"
                placeholder="Search by tenant, property, or unit..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded outline-none"
                style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}
              />
            </div>
            <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="outstandingDesc">Sort: Highest balance first</option>
              <option value="daysDesc">Sort: Most days overdue</option>
              <option value="tenant">Sort: Tenant name A→Z</option>
            </Select>
          </div>

          {/* Flag chips */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[11px] tracking-wider uppercase font-medium" style={{ color: brand.textMuted }}>Flag</span>
            {[
              { id: 'All', label: 'All', count: debtors.length },
              { id: 'BAD', label: 'BAD', count: badCount, color: brand.danger },
              { id: 'WARNING', label: 'WARNING', count: warnCount, color: brand.warning },
              { id: 'OK', label: 'OK', count: debtors.length - badCount - warnCount, color: brand.success },
            ].map(f => {
              const active = filterFlag === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilterFlag(f.id)}
                  className="px-3 py-1.5 text-xs font-semibold rounded btn-press transition-all"
                  style={{
                    backgroundColor: active ? (f.color || brand.navy) : 'transparent',
                    color: active ? '#fff' : f.color || brand.text,
                    border: `1px solid ${active ? (f.color || brand.navy) : brand.border}`,
                  }}
                >
                  {f.label} ({f.count})
                </button>
              );
            })}
          </div>

          {/* Payment status chips + property + days */}
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[11px] tracking-wider uppercase font-medium" style={{ color: brand.textMuted }}>Payment</span>
            {['All', 'Paid', 'Unpaid', 'Partial', 'Overdue'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className="px-3 py-1.5 text-xs font-medium rounded transition-all btn-press"
                style={{
                  backgroundColor: filterStatus === s ? brand.navy : 'transparent',
                  color: filterStatus === s ? '#fff' : brand.text,
                  border: `1px solid ${filterStatus === s ? brand.navy : brand.border}`,
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[11px] tracking-wider uppercase font-medium" style={{ color: brand.textMuted }}>Refine</span>
            <Select value={filterProperty} onChange={(e) => setFilterProperty(e.target.value)}>
              <option value="All">All Properties</option>
              {propertyOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: brand.textMuted }}>Days overdue ≥</span>
              <input
                type="number"
                min="0"
                value={filterMinDays}
                onChange={(e) => setFilterMinDays(e.target.value)}
                placeholder="0"
                className="w-20 px-2 py-1 text-xs rounded outline-none"
                style={{ border: `1px solid ${brand.border}` }}
              />
            </div>
            {(filterFlag !== 'All' || filterStatus !== 'All' || filterProperty !== 'All' || filterMinDays || search) && (
              <button
                onClick={() => { setFilterFlag('All'); setFilterStatus('All'); setFilterProperty('All'); setFilterMinDays(''); setSearch(''); }}
                className="text-xs px-2 py-1 rounded btn-press"
                style={{ color: brand.textMuted, border: `1px solid ${brand.border}` }}
              >
                Clear filters
              </button>
            )}
            <span className="text-xs ml-auto" style={{ color: brand.textMuted }}>
              Showing <strong style={{ color: brand.navy }}>{filtered.length}</strong> of {debtors.length}
            </span>
          </div>
        </div>
      </Card>

      {/* Debtors Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                {['Tenant', 'Flag', 'Property / Unit', 'Outstanding', 'Assigned', 'Workflow', 'Follow-up', 'Last Note'].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8" style={{ color: brand.textMuted }}>No debtors match your filters.</td></tr>
              )}
              {filtered.map((d) => {
                const flag = computeDebtorFlag(d);
                const flagStyle = flag === 'BAD'
                  ? { backgroundColor: brand.dangerLight, color: brand.danger }
                  : flag === 'WARNING'
                  ? { backgroundColor: brand.warningLight, color: brand.warning }
                  : { backgroundColor: brand.successLight, color: brand.success };
                const acc = getAccount(d);
                const notes = getNotes(d);
                const lastNote = notes[0];
                const stat = DEBTOR_STATUSES.find(s => s.id === acc.status) || DEBTOR_STATUSES[0];
                const collector = COLLECTORS.find(c => c.id === acc.assignedTo);
                const followupOverdue = acc.nextFollowUp && acc.nextFollowUp < todayISOStr;
                return (
                <tr key={d.id} onClick={() => setDetailAccount(d)} style={{ borderBottom: `1px solid ${brand.border}`, cursor: 'pointer' }} className="hover:bg-black hover:bg-opacity-[0.02]">
                  <td className="px-3 py-3 font-medium" style={{ color: brand.text }}>
                    {d.tenant}
                    {d.accountNumber && <p className="text-[10px]" style={{ color: brand.textMuted }}>#{d.accountNumber}</p>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold tracking-wider rounded" style={flagStyle}>{flag}</span>
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-sm" style={{ color: brand.text }}>{d.property}</p>
                    <p className="text-[11px]" style={{ color: brand.textMuted }}>{d.unit}</p>
                  </td>
                  <td className="px-3 py-3 font-semibold text-sm" style={{ color: d.outstandingBalance > 0 ? brand.danger : brand.success }}>
                    R {Number(d.outstandingBalance || 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={acc.assignedTo || ''}
                      onChange={(e) => {
                        const newId = e.target.value || null;
                        const prevId = acc.assignedTo;
                        updateAccount(d.accountNumber, { assignedTo: newId });
                        const newName = COLLECTORS.find(c => c.id === newId)?.name || 'Unassigned';
                        const prevName = COLLECTORS.find(c => c.id === prevId)?.name || 'Unassigned';
                        addNote(d.accountNumber, { actionType: 'ASSIGNMENT', body: `Reassigned from ${prevName} → ${newName}` });
                        showToast(`Saved · ${d.tenant} → ${newName}`, 'success');
                      }}
                      className="text-xs px-2 py-1 rounded outline-none"
                      style={{ border: `1px solid ${brand.border}`, color: collector ? '#fff' : brand.text, backgroundColor: collector?.color || '#fff' }}
                    >
                      <option value="">Unassigned</option>
                      {COLLECTORS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={acc.status}
                      onChange={(e) => {
                        const newStatus = e.target.value;
                        const oldLabel = stat.label;
                        const newLabel = DEBTOR_STATUSES.find(s => s.id === newStatus)?.label || newStatus;
                        updateAccount(d.accountNumber, { status: newStatus });
                        addNote(d.accountNumber, { actionType: 'STATUS_CHANGE', body: `Status changed: ${oldLabel} → ${newLabel}` });
                        showToast(`Saved · ${d.tenant} → ${newLabel}`, 'success');
                      }}
                      className="text-xs px-2 py-1 rounded outline-none font-medium"
                      style={{ border: `1px solid ${stat.color}`, color: '#fff', backgroundColor: stat.color }}
                    >
                      {DEBTOR_STATUSES.map(s => <option key={s.id} value={s.id} style={{ color: brand.text, backgroundColor: '#fff' }}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {acc.nextFollowUp ? (
                      <span style={{ color: followupOverdue ? brand.danger : brand.text, fontWeight: followupOverdue ? 600 : 400 }}>
                        {fmtDate(acc.nextFollowUp)}
                      </span>
                    ) : <span style={{ color: brand.textMuted }}>—</span>}
                  </td>
                  <td className="px-3 py-3 text-xs" style={{ color: brand.textMuted, maxWidth: '220px' }}>
                    {lastNote ? (
                      <>
                        <p className="truncate" style={{ color: brand.text }}>{lastNote.body}</p>
                        <p className="text-[10px] mt-0.5">{lastNote.author} · {timeAgo(lastNote.timestamp)}</p>
                      </>
                    ) : <span>No notes</span>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

        </div>{/* /main column */}
      </div>{/* /sidebar+main grid */}

      {/* Slide-over: account detail with notes thread */}
      <DebtorDetailPanel
        debtor={detailAccount}
        onClose={() => setDetailAccount(null)}
        account={detailAccount ? getAccount(detailAccount) : null}
        notes={detailAccount ? getNotes(detailAccount) : []}
        onUpdateAccount={(patch) => detailAccount && updateAccount(detailAccount.accountNumber, patch)}
        onAddNote={(payload) => detailAccount && addNote(detailAccount.accountNumber, payload)}
      />

      {/* Payment Modal */}
      <Modal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title="Record Payment" size="sm">
        {selectedDebtor && (
          <>
            <div className="mb-4 p-3 rounded" style={{ backgroundColor: brand.cream }}>
              <p className="text-sm font-semibold" style={{ color: brand.navy }}>{selectedDebtor.tenant}</p>
              <p className="text-xs" style={{ color: brand.textMuted }}>{selectedDebtor.property} · {selectedDebtor.unit}</p>
              <div className="mt-2 flex justify-between text-xs">
                <span style={{ color: brand.textMuted }}>Outstanding Balance:</span>
                <span className="font-semibold" style={{ color: brand.danger }}>R {selectedDebtor.outstandingBalance.toLocaleString()}</span>
              </div>
            </div>
            <Field label="Payment Amount (ZAR)" required error={paymentError} hint="Cannot exceed outstanding balance">
              <Input
                type="number"
                value={paymentAmount}
                onChange={(e) => { setPaymentAmount(e.target.value); setPaymentError(''); }}
                error={paymentError}
                placeholder="0.00"
              />
            </Field>
            <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
              <Button variant="ghost" onClick={() => setPaymentModalOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={recordPayment}>Record Payment</Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

// ============================================================
// DASHBOARDS — live activity board (one card per person)
// ============================================================
// ============================================================
// MONTHLY ACTIVITY VIEW — used inside Dashboards section
// Shows what every team member did over the past 30 days
// ============================================================
const MonthlyActivityView = ({ employees, activityLog, filterDept, search, expandedEmployeeId, setExpandedEmployeeId, monthlyFilterType, setMonthlyFilterType }) => {
  const thirtyDaysAgo = Date.now() - 30 * 86400000;

  // Filter activity log to last 30 days
  const recentActivity = useMemo(() =>
    activityLog.filter(a => new Date(a.date).getTime() > thirtyDaysAgo),
  [activityLog]);

  // Group by employee
  const employeeActivity = useMemo(() => {
    return employees
      .filter(e => e.status === 'Active')
      .filter(e => filterDept === 'All' || e.department === filterDept)
      .filter(e => {
        if (!search) return true;
        return fullName(e).toLowerCase().includes(search.toLowerCase());
      })
      .map(emp => {
        const entries = recentActivity
          .filter(a => a.employeeId === emp.id)
          .filter(a => monthlyFilterType === 'All' || a.type === monthlyFilterType)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const totalMins = entries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
        const totalHours = (totalMins / 60).toFixed(1);

        // Aggregate type counts
        const typeCounts = {};
        entries.forEach(e => { typeCounts[e.type] = (typeCounts[e.type] || 0) + 1; });

        // Aggregate days worked
        const uniqueDays = new Set(entries.map(e => e.date.split('T')[0])).size;

        return { employee: emp, entries, totalHours, totalMins, typeCounts, uniqueDays };
      });
  }, [employees, recentActivity, filterDept, search, monthlyFilterType]);

  // Top stats
  const totalActivities = recentActivity.length;
  const totalHoursAll = (recentActivity.reduce((s, e) => s + (e.durationMinutes || 0), 0) / 60).toFixed(0);

  // Type-specific totals
  const inspectionsDone = recentActivity.filter(a => a.type === 'inspection_completed').length;
  const leasesAdvanced = recentActivity.filter(a => ['lease_offered', 'lease_drafted', 'lease_sent_docusign', 'lease_signed'].includes(a.type)).length;
  const paymentsCollected = recentActivity.filter(a => a.type === 'payment_collected').length;
  const viewingsConducted = recentActivity.filter(a => a.type === 'viewing_conducted').length;

  return (
    <div className="space-y-4">
      {/* Top-level monthly stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Activities', value: totalActivities, sub: `Across ${employeeActivity.length} people`, color: brand.navy, icon: Activity },
          { label: 'Total Hours Logged', value: `${totalHoursAll}h`, sub: 'Past 30 days', color: brand.gold, icon: Clock },
          { label: 'Inspections', value: inspectionsDone, sub: 'Completed', color: brand.success, icon: ClipboardCheck },
          { label: 'Lease Actions', value: leasesAdvanced, sub: `${viewingsConducted} viewings`, color: brand.warning, icon: FileSignature },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className={`p-4 card-lift animate-fade-in-up stagger-${i + 1}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>{s.label}</p>
                <Icon size={14} style={{ color: s.color }} />
              </div>
              <p className="text-2xl font-semibold stat-number" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{s.value}</p>
              <p className="text-xs mt-1" style={{ color: brand.textMuted }}>{s.sub}</p>
            </Card>
          );
        })}
      </div>

      {/* Activity type filter chips */}
      <Card className="p-4 animate-fade-in-up">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>Filter by activity type</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setMonthlyFilterType('All')}
            className="btn-press px-3 py-1.5 text-xs font-medium rounded transition-all"
            style={{
              backgroundColor: monthlyFilterType === 'All' ? brand.navy : 'transparent',
              color: monthlyFilterType === 'All' ? '#fff' : brand.text,
              border: `1px solid ${monthlyFilterType === 'All' ? brand.navy : brand.border}`,
            }}
          >
            All Activity Types
          </button>
          {Object.entries(ACTIVITY_TYPES).map(([key, def]) => {
            const count = recentActivity.filter(a => a.type === key).length;
            if (count === 0) return null;
            return (
              <button
                key={key}
                onClick={() => setMonthlyFilterType(key)}
                className="btn-press px-3 py-1.5 text-xs font-medium rounded transition-all inline-flex items-center gap-1.5"
                style={{
                  backgroundColor: monthlyFilterType === key ? def.color : 'transparent',
                  color: monthlyFilterType === key ? '#fff' : brand.text,
                  border: `1px solid ${monthlyFilterType === key ? def.color : brand.border}`,
                }}
              >
                {def.label}
                <span className="text-[10px] px-1 rounded" style={{
                  backgroundColor: monthlyFilterType === key ? 'rgba(255,255,255,0.25)' : brand.cream,
                  color: monthlyFilterType === key ? '#fff' : brand.textMuted,
                }}>{count}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Per-employee cards */}
      <div className="space-y-3">
        {employeeActivity.map(({ employee, entries, totalHours, typeCounts, uniqueDays }, idx) => {
          const isExpanded = expandedEmployeeId === employee.id;
          const deptColor = DEPARTMENTS_CONFIG[employee.department]?.color || brand.gold;
          const recentEntries = isExpanded ? entries : entries.slice(0, 3);

          // Top 3 activity types for this person
          const topTypes = Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

          return (
            <Card
              key={employee.id}
              className={`card-lift animate-fade-in-up stagger-${Math.min(idx + 1, 8)}`}
              style={{ borderLeft: `3px solid ${deptColor}` }}
            >
              {/* Header row — always visible */}
              <button
                onClick={() => setExpandedEmployeeId(isExpanded ? null : employee.id)}
                className="w-full p-4 flex items-center gap-4 transition-colors"
                style={{ textAlign: 'left' }}
              >
                {/* Avatar */}
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0" style={{ backgroundColor: brand.goldPale, color: brand.gold }}>
                  {initials(employee)}
                </div>

                {/* Name + role */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate" style={{ color: brand.text }}>{fullName(employee)}</p>
                    {employee.isTeamLead && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: brand.cream, color: brand.navy }}>Lead</span>
                    )}
                  </div>
                  <p className="text-xs truncate" style={{ color: brand.textMuted }}>
                    {employee.role} · <span style={{ color: deptColor }}>{employee.team || employee.department}</span>
                  </p>
                </div>

                {/* Quick stats */}
                <div className="hidden md:flex items-center gap-6 flex-shrink-0">
                  <div className="text-center">
                    <p className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{entries.length}</p>
                    <p className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>Activities</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{totalHours}h</p>
                    <p className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>Logged</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{uniqueDays}</p>
                    <p className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>Days Active</p>
                  </div>
                </div>

                <ChevronRight
                  size={18}
                  style={{
                    color: brand.textMuted,
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease',
                  }}
                />
              </button>

              {/* Top activity type tags */}
              {topTypes.length > 0 && (
                <div className="px-4 pb-3 flex gap-1 flex-wrap">
                  {topTypes.map(([type, count]) => {
                    const def = ACTIVITY_TYPES[type];
                    if (!def) return null;
                    return (
                      <span key={type} className="text-[11px] px-2 py-0.5 rounded flex items-center gap-1" style={{ backgroundColor: brand.cream, color: brand.textMuted }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: def.color }} />
                        {def.label} · {count}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Activity timeline — visible when collapsed (preview) or expanded (full grouped by day) */}
              {entries.length > 0 ? (
                <div className="px-4 pb-4">
                  <div className="pt-3" style={{ borderTop: `1px solid ${brand.border}` }}>
                    <p className="text-[10px] tracking-wider uppercase mb-2" style={{ color: brand.textMuted }}>
                      {isExpanded ? `Daily breakdown · ${entries.length} activities over ${uniqueDays} day${uniqueDays === 1 ? '' : 's'}` : 'Recent Activity'}
                    </p>
                    {isExpanded ? (
                      // GROUPED BY DAY when expanded
                      <div className="space-y-3">
                        {(() => {
                          // Group entries by date (YYYY-MM-DD)
                          const groups = {};
                          entries.forEach(e => {
                            const day = new Date(e.date).toISOString().split('T')[0];
                            if (!groups[day]) groups[day] = [];
                            groups[day].push(e);
                          });
                          // Sort days descending (most recent first)
                          const sortedDays = Object.keys(groups).sort((a, b) => b.localeCompare(a));

                          return sortedDays.map(day => {
                            const dayEntries = groups[day];
                            const dayDate = new Date(day);
                            const dayMins = dayEntries.reduce((s, e) => s + (e.durationMinutes || 0), 0);
                            const dayHours = (dayMins / 60).toFixed(1);
                            const isToday = day === new Date().toISOString().split('T')[0];
                            const daysAgo = Math.floor((Date.now() - dayDate.getTime()) / 86400000);

                            return (
                              <div key={day} className="rounded" style={{ backgroundColor: '#FAFAF6', border: `1px solid ${brand.border}` }}>
                                <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${brand.border}` }}>
                                  <div className="flex items-center gap-2">
                                    <Calendar size={11} style={{ color: brand.gold }} />
                                    <p className="text-xs font-semibold" style={{ color: brand.navy }}>
                                      {dayDate.toLocaleDateString('en-ZA', { weekday: 'long', month: 'short', day: 'numeric' })}
                                    </p>
                                    {isToday && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: brand.goldPale, color: brand.gold }}>Today</span>
                                    )}
                                    {!isToday && daysAgo === 1 && (
                                      <span className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>Yesterday</span>
                                    )}
                                    {!isToday && daysAgo > 1 && (
                                      <span className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>{daysAgo} days ago</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 text-xs" style={{ color: brand.textMuted }}>
                                    <span>{dayEntries.length} action{dayEntries.length !== 1 ? 's' : ''}</span>
                                    <span style={{ color: brand.text, fontWeight: 600 }}>{dayHours}h</span>
                                  </div>
                                </div>
                                <div className="px-3 py-2 space-y-1.5">
                                  {dayEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(entry => {
                                    const def = ACTIVITY_TYPES[entry.type];
                                    const Icon = def?.icon || Activity;
                                    const date = new Date(entry.date);
                                    return (
                                      <div key={entry.id} className="flex items-start gap-2.5 py-1">
                                        <div className="p-1 rounded flex-shrink-0 mt-0.5" style={{ backgroundColor: '#fff' }}>
                                          <Icon size={11} style={{ color: def?.color || brand.textMuted }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm" style={{ color: brand.text, lineHeight: 1.4 }}>{entry.description}</p>
                                          <div className="flex items-center gap-2 mt-0.5 text-xs" style={{ color: brand.textMuted }}>
                                            <span>{def?.label}</span>
                                            <span>·</span>
                                            <span>{date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                                            {entry.durationMinutes && (
                                              <>
                                                <span>·</span>
                                                <span>{entry.durationMinutes < 60 ? `${entry.durationMinutes} min` : `${(entry.durationMinutes / 60).toFixed(1)}h`}</span>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    ) : (
                      // FLAT preview when collapsed
                      <div className="space-y-2">
                        {recentEntries.map((entry, i) => {
                          const def = ACTIVITY_TYPES[entry.type];
                          const Icon = def?.icon || Activity;
                          const date = new Date(entry.date);
                          return (
                            <div key={entry.id} className="flex items-start gap-3 py-1.5">
                              <div className="p-1.5 rounded flex-shrink-0 mt-0.5" style={{ backgroundColor: brand.cream }}>
                                <Icon size={12} style={{ color: def?.color || brand.textMuted }} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm" style={{ color: brand.text, lineHeight: 1.4 }}>{entry.description}</p>
                                <div className="flex items-center gap-3 mt-0.5 text-xs" style={{ color: brand.textMuted }}>
                                  <span>{def?.label}</span>
                                  <span>·</span>
                                  <span>{date.toLocaleDateString('en-ZA', { month: 'short', day: 'numeric' })} at {date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                                  {entry.durationMinutes && (
                                    <>
                                      <span>·</span>
                                      <span>{entry.durationMinutes < 60 ? `${entry.durationMinutes} min` : `${(entry.durationMinutes / 60).toFixed(1)}h`}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {!isExpanded && entries.length > 3 && (
                      <button
                        onClick={() => setExpandedEmployeeId(employee.id)}
                        className="mt-2 text-xs font-medium"
                        style={{ color: brand.gold }}
                      >
                        Show all {entries.length} activities grouped by day →
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="px-4 pb-4">
                  <div className="pt-3 text-center text-xs italic" style={{ borderTop: `1px solid ${brand.border}`, color: brand.textMuted }}>
                    No activity recorded {monthlyFilterType !== 'All' ? `of type "${ACTIVITY_TYPES[monthlyFilterType]?.label}"` : ''} in the past 30 days
                  </div>
                </div>
              )}
            </Card>
          );
        })}

        {employeeActivity.length === 0 && (
          <Card>
            <EmptyState icon={Activity} title="No team members match" message="Adjust your department or search filter." />
          </Card>
        )}
      </div>
    </div>
  );
};

// ============================================================
// DASHBOARDS — live activity board (one card per person)
// ============================================================
const OnDeskSection = ({ employees, deskStatuses, setDeskStatuses, activityLog, currentUser, showToast, logAction }) => {
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterDept, setFilterDept] = useState('All');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('teams'); // 'teams' | 'grid' | 'monthly'
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ employeeId: null, status: 'working', task: '', location: '', expectedDuration: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [now, setNow] = useState(Date.now());
  const [expandedEmployeeId, setExpandedEmployeeId] = useState(null);
  const [monthlyFilterType, setMonthlyFilterType] = useState('All');
  const canEdit = hasPermission(currentUser, PERMISSIONS.EDIT_ONDESK);

  // Tick every minute so time-ago values update live
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Combine employees with their current desk status
  const board = useMemo(() => {
    return employees
      .filter(e => e.status === 'Active')
      .map(emp => {
        const desk = deskStatuses.find(d => d.employeeId === emp.id);
        return { employee: emp, desk: desk || { status: 'off_duty', task: 'Not currently signed in', location: '—', startedAt: null, expectedDuration: '', notes: '' } };
      });
  }, [employees, deskStatuses, now]);

  const filtered = board.filter(({ employee, desk }) => {
    const matchesStatus = filterStatus === 'All' || desk.status === filterStatus;
    const matchesDept = filterDept === 'All' || employee.department === filterDept;
    const matchesSearch = `${employee.firstName} ${employee.lastName} ${desk.task} ${desk.location} ${employee.team || ''}`.toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesDept && matchesSearch;
  });

  // Group filtered results by department → team for the teams view
  const groupedByTeam = useMemo(() => {
    const groups = {};
    filtered.forEach(item => {
      const dept = item.employee.department;
      const team = item.employee.team || 'Unassigned';
      if (!groups[dept]) groups[dept] = {};
      if (!groups[dept][team]) groups[dept][team] = [];
      groups[dept][team].push(item);
    });
    return groups;
  }, [filtered]);

  const openUpdate = (item) => {
    if (!canEdit && item.employee.id !== currentUser.id) {
      showToast("You can only update your own status", 'error');
      return;
    }
    const existing = deskStatuses.find(d => d.employeeId === item.employee.id);
    setEditingId(item.employee.id);
    setForm(existing ? { ...existing } : { employeeId: item.employee.id, status: 'working', task: '', location: '', expectedDuration: '', notes: '' });
    setErrors({});
  };

  const handleSave = () => {
    const newErrors = {};
    if (!form.task || form.task.trim().length < 5) newErrors.task = 'Describe the task in at least 5 characters';
    if (!form.location || form.location.trim().length === 0) newErrors.location = 'Location is required';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      showToast('Please fix the errors before saving', 'error');
      return;
    }
    const existing = deskStatuses.find(d => d.employeeId === editingId);
    if (existing) {
      setDeskStatuses(deskStatuses.map(d => d.employeeId === editingId ? { ...d, ...form, startedAt: existing.startedAt } : d));
    } else {
      const newId = Math.max(0, ...deskStatuses.map(d => d.id)) + 1;
      setDeskStatuses([...deskStatuses, { ...form, id: newId, employeeId: editingId, startedAt: new Date().toISOString() }]);
    }
    const emp = employees.find(e => e.id === editingId);
    logAction && logAction(`Updated dashboard status for ${emp?.firstName} ${emp?.lastName}`);
    showToast('Status updated', 'success');
    setEditingId(null);
  };

  const signOff = (employeeId) => {
    setDeskStatuses(deskStatuses.filter(d => d.employeeId !== employeeId));
    showToast('Signed off', 'success');
  };

  // Stats
  const statusCounts = useMemo(() => {
    const counts = {};
    Object.keys(DESK_STATUSES).forEach(s => counts[s] = 0);
    board.forEach(({ desk }) => { counts[desk.status] = (counts[desk.status] || 0) + 1; });
    return counts;
  }, [board]);

  const activeCount = statusCounts.working + statusCounts.in_meeting + statusCounts.travelling;
  const onBreakCount = statusCounts.on_break;
  const offCount = statusCounts.off_duty + statusCounts.unavailable;

  // Reusable card renderer
  const DeskCard = ({ employee, desk, idx }) => {
    const def = DESK_STATUSES[desk.status];
    const Icon = def.icon;
    const isCurrentUser = employee.id === currentUser.id;
    const elapsedMs = desk.startedAt ? now - new Date(desk.startedAt).getTime() : 0;
    const elapsedMins = Math.floor(elapsedMs / 60000);
    const elapsedHrs = Math.floor(elapsedMins / 60);
    const elapsedLabel = elapsedHrs > 0 ? `${elapsedHrs}h ${elapsedMins % 60}m` : `${elapsedMins}m`;

    return (
      <Card className={`p-5 card-lift animate-fade-in-up stagger-${Math.min((idx || 0) + 1, 8)}`} style={{ borderLeft: `3px solid ${def.color}` }}>
        <div className="flex items-start gap-3 mb-3">
          <div className="relative">
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold" style={{ backgroundColor: brand.goldPale, color: brand.gold }}>
              {employee.firstName[0]}{employee.lastName[0]}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white" style={{ backgroundColor: def.color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold truncate" style={{ color: brand.text }}>
                {employee.firstName} {employee.lastName}
              </p>
              {isCurrentUser && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: brand.goldPale, color: brand.gold }}>You</span>
              )}
              {employee.isTeamLead && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: brand.cream, color: brand.navy }}>Lead</span>
              )}
            </div>
            <p className="text-xs" style={{ color: brand.textMuted }}>{employee.role}</p>
          </div>
          <div className="px-2 py-1 rounded flex items-center gap-1 status-transition" style={{ backgroundColor: def.bg }}>
            <Icon size={11} style={{ color: def.color }} />
            <span className="text-xs font-medium" style={{ color: def.color }}>{def.label}</span>
          </div>
        </div>

        {desk.status !== 'off_duty' ? (
          <>
            <p className="text-sm mb-3" style={{ color: brand.text, lineHeight: 1.5 }}>{desk.task}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-3" style={{ color: brand.textMuted }}>
              <span className="flex items-center gap-1"><MapPin size={11} />{desk.location}</span>
              {desk.startedAt && <span className="flex items-center gap-1"><Clock size={11} />{elapsedLabel} elapsed</span>}
              {desk.expectedDuration && <span className="flex items-center gap-1"><Calendar size={11} />Est: {desk.expectedDuration}</span>}
            </div>
            {desk.notes && (
              <div className="text-xs p-2 rounded mb-3" style={{ backgroundColor: brand.cream, color: brand.textMuted }}>
                <span className="font-medium" style={{ color: brand.text }}>Note:</span> {desk.notes}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs italic mb-3" style={{ color: brand.textMuted }}>Currently signed off</p>
        )}

        {(canEdit || isCurrentUser) && (
          <div className="flex gap-2 pt-3" style={{ borderTop: `1px solid ${brand.border}` }}>
            <button onClick={() => openUpdate({ employee })} className="text-xs px-2.5 py-1 rounded btn-press transition-all" style={{ color: brand.navy, border: `1px solid ${brand.border}` }}>
              Update
            </button>
            {desk.status !== 'off_duty' && (
              <button onClick={() => signOff(employee.id)} className="text-xs px-2.5 py-1 rounded btn-press transition-all" style={{ color: brand.danger, border: `1px solid ${brand.border}` }}>
                Sign Off
              </button>
            )}
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Live Activity</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Dashboards</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Real-time view of what every team member is working on right now, grouped by department and team.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${brand.border}` }}>
            <button onClick={() => setViewMode('teams')} className="px-3 py-1.5 text-xs font-medium transition-all" style={{ backgroundColor: viewMode === 'teams' ? brand.navy : '#fff', color: viewMode === 'teams' ? '#fff' : brand.text }}>By Team</button>
            <button onClick={() => setViewMode('grid')} className="px-3 py-1.5 text-xs font-medium transition-all" style={{ backgroundColor: viewMode === 'grid' ? brand.navy : '#fff', color: viewMode === 'grid' ? '#fff' : brand.text }}>Grid</button>
            <button onClick={() => setViewMode('monthly')} className="px-3 py-1.5 text-xs font-medium transition-all" style={{ backgroundColor: viewMode === 'monthly' ? brand.navy : '#fff', color: viewMode === 'monthly' ? '#fff' : brand.text }}>Monthly Activity</button>
          </div>
          {canEdit && (
            <Button variant="primary" icon={Zap} onClick={() => openUpdate({ employee: currentUser })}>Update My Status</Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Active Now', value: activeCount, color: brand.success, icon: Activity, pulse: true },
          { label: 'In Meetings', value: statusCounts.in_meeting, color: brand.warning, icon: Users },
          { label: 'On Break', value: onBreakCount, color: brand.gold, icon: Coffee },
          { label: 'Off / Unavailable', value: offCount, color: brand.textMuted, icon: Lock },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className={`p-4 card-lift animate-fade-in-up stagger-${i + 1}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>{s.label}</p>
                <div className={s.pulse && s.value > 0 ? 'animate-pulse-soft' : ''}>
                  <Icon size={14} style={{ color: s.color }} />
                </div>
              </div>
              <p className="text-2xl font-semibold stat-number" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{s.value}</p>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card className="mb-4 p-4 animate-fade-in-up">
        <div className="flex flex-col md:flex-row gap-3 mb-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: brand.textMuted }} />
            <input
              type="text"
              placeholder="Search by name, task, location, or team..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded outline-none transition-all"
              style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}
            />
          </div>
          <Select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
            <option value="All">All Departments</option>
            {Object.keys(DEPARTMENTS_CONFIG).map(d => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilterStatus('All')} className="btn-press px-3 py-1.5 text-xs font-medium rounded transition-all"
            style={{ backgroundColor: filterStatus === 'All' ? brand.navy : 'transparent', color: filterStatus === 'All' ? '#fff' : brand.text, border: `1px solid ${filterStatus === 'All' ? brand.navy : brand.border}` }}>
            All
          </button>
          {Object.entries(DESK_STATUSES).map(([key, def]) => (
            <button key={key} onClick={() => setFilterStatus(key)} className="btn-press px-3 py-1.5 text-xs font-medium rounded transition-all"
              style={{ backgroundColor: filterStatus === key ? def.color : 'transparent', color: filterStatus === key ? '#fff' : brand.text, border: `1px solid ${filterStatus === key ? def.color : brand.border}` }}>
              {def.label}
            </button>
          ))}
        </div>
      </Card>

      {viewMode === 'monthly' ? (
        // MONTHLY ACTIVITY view — shows everything everyone did over the past 30 days
        <MonthlyActivityView
          employees={employees}
          activityLog={activityLog || []}
          filterDept={filterDept}
          search={search}
          expandedEmployeeId={expandedEmployeeId}
          setExpandedEmployeeId={setExpandedEmployeeId}
          monthlyFilterType={monthlyFilterType}
          setMonthlyFilterType={setMonthlyFilterType}
        />
      ) : filtered.length === 0 ? (
        <Card className="animate-fade-in-up">
          <EmptyState icon={Activity} title="Nobody matches" message="Adjust your filters to see team activity." />
        </Card>
      ) : viewMode === 'teams' ? (
        // BY TEAM view — group cards under department and team headers
        <div className="space-y-6">
          {Object.entries(groupedByTeam).map(([dept, teams]) => {
            const deptCfg = DEPARTMENTS_CONFIG[dept];
            return (
              <div key={dept} className="animate-fade-in-up">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-1 h-6 rounded" style={{ backgroundColor: deptCfg?.color || brand.gold }} />
                  <h2 className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{dept}</h2>
                  {deptCfg?.description && <p className="text-xs" style={{ color: brand.textMuted }}>{deptCfg.description}</p>}
                </div>
                {Object.entries(teams).map(([teamName, items]) => (
                  <div key={teamName} className="mb-5">
                    {teamName !== 'null' && teamName !== 'Unassigned' && (
                      <div className="flex items-center gap-2 mb-3 ml-2">
                        <Layers size={12} style={{ color: brand.textMuted }} />
                        <p className="text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>{teamName}</p>
                        <span className="text-xs" style={{ color: brand.textMuted }}>· {items.length} member{items.length !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {items.map((item, idx) => <DeskCard key={item.employee.id} employee={item.employee} desk={item.desk} idx={idx} />)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        // GRID view — flat grid of all matching cards
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((item, idx) => <DeskCard key={item.employee.id} employee={item.employee} desk={item.desk} idx={idx} />)}
        </div>
      )}

      {/* Update modal */}
      <Modal open={editingId !== null} onClose={() => setEditingId(null)} title="Update Dashboard Status">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Current Status" required>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {Object.entries(DESK_STATUSES).filter(([k]) => k !== 'off_duty').map(([k, d]) => (
                <option key={k} value={k}>{d.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Location" required error={errors.location} hint="Where are you working from?">
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} error={errors.location} placeholder="e.g. Head Office, Protea Shopping Centre" />
          </Field>
        </div>
        <Field label="What are you working on?" required error={errors.task} hint="Minimum 5 characters">
          <textarea
            value={form.task}
            onChange={(e) => setForm({ ...form, task: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 text-sm rounded outline-none transition-all resize-none"
            style={{ backgroundColor: '#fff', border: `1px solid ${errors.task ? brand.danger : brand.border}`, color: brand.text }}
            placeholder="Describe what you're focused on right now..."
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Estimated Duration" hint="Optional — e.g. 2 hours, 30 min">
            <Input value={form.expectedDuration} onChange={(e) => setForm({ ...form, expectedDuration: e.target.value })} placeholder="2 hours" />
          </Field>
          <Field label="Notes" hint="Optional — visible to managers">
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any context or blockers..." />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
          <Button variant="primary" icon={Save} onClick={handleSave}>Save Status</Button>
        </div>
      </Modal>
    </div>
  );
};

// ============================================================
// USERS & ROLES
// ============================================================
const UsersSection = ({ employees, setEmployees, currentUser, setCurrentUser, showToast, logAction }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ employeeId: null, systemRole: 'readonly' });
  const [revokeId, setRevokeId] = useState(null);
  const [filterRole, setFilterRole] = useState('All');
  const canManage = hasPermission(currentUser, PERMISSIONS.MANAGE_USERS);

  const users = employees.filter(e => e.systemAccess);
  const nonUsers = employees.filter(e => !e.systemAccess && e.status === 'Active');

  const filteredUsers = users.filter(u => filterRole === 'All' || u.systemRole === filterRole);

  const openInvite = () => {
    if (nonUsers.length === 0) {
      showToast('All active employees already have system access', 'error');
      return;
    }
    setEditingId(null);
    setForm({ employeeId: nonUsers[0].id, systemRole: 'readonly' });
    setModalOpen(true);
  };

  const openEditRole = (user) => {
    setEditingId(user.id);
    setForm({ employeeId: user.id, systemRole: user.systemRole });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (editingId !== null) {
      // Updating existing
      setEmployees(employees.map(e => e.id === editingId ? { ...e, systemRole: form.systemRole } : e));
      const emp = employees.find(e => e.id === editingId);
      logAction(`Changed role for ${emp?.firstName} ${emp?.lastName} to ${ROLES[form.systemRole].label}`);
      showToast(`Role updated for ${emp?.firstName} ${emp?.lastName}`, 'success');
    } else {
      // Inviting new user
      setEmployees(employees.map(e => e.id === form.employeeId ? { ...e, systemAccess: true, systemRole: form.systemRole, lastLogin: null } : e));
      const emp = employees.find(e => e.id === form.employeeId);
      logAction(`Granted system access to ${emp?.firstName} ${emp?.lastName} as ${ROLES[form.systemRole].label}`);
      showToast(`User invited — invitation email sent`, 'success');
    }
    setModalOpen(false);
  };

  const handleRevoke = () => {
    if (revokeId === currentUser.id) {
      showToast('You cannot revoke your own access', 'error');
      setRevokeId(null);
      return;
    }
    setEmployees(employees.map(e => e.id === revokeId ? { ...e, systemAccess: false, systemRole: null, lastLogin: null } : e));
    const emp = employees.find(e => e.id === revokeId);
    logAction(`Revoked system access for ${emp?.firstName} ${emp?.lastName}`);
    showToast('Access revoked', 'success');
    setRevokeId(null);
  };

  const roleStats = Object.entries(ROLES).map(([key, def]) => ({
    role: key, label: def.label, color: def.color,
    count: users.filter(u => u.systemRole === key).length,
  }));

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Access Control</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Users & Roles</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Manage who can access the system and what they can do.</p>
        </div>
        {canManage && (
          <Button variant="primary" icon={UserPlus} onClick={openInvite}>Invite User</Button>
        )}
      </div>

      {/* Role distribution */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
        {roleStats.map((r, i) => (
          <Card key={r.role} className={`p-3 card-lift animate-fade-in-up stagger-${Math.min(i + 1, 8)}`}>
            <div className="w-2 h-2 rounded-full mb-2" style={{ backgroundColor: r.color }} />
            <p className="text-2xl font-semibold stat-number" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{r.count}</p>
            <p className="text-[11px] uppercase tracking-wider" style={{ color: brand.textMuted }}>{r.label}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="mb-4 p-4 animate-fade-in-up">
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilterRole('All')} className="btn-press px-3 py-1.5 text-xs font-medium rounded"
            style={{ backgroundColor: filterRole === 'All' ? brand.navy : 'transparent', color: filterRole === 'All' ? '#fff' : brand.text, border: `1px solid ${filterRole === 'All' ? brand.navy : brand.border}` }}>
            All Users ({users.length})
          </button>
          {Object.entries(ROLES).map(([key, def]) => {
            const count = users.filter(u => u.systemRole === key).length;
            return (
              <button key={key} onClick={() => setFilterRole(key)} className="btn-press px-3 py-1.5 text-xs font-medium rounded"
                style={{ backgroundColor: filterRole === key ? def.color : 'transparent', color: filterRole === key ? '#fff' : brand.text, border: `1px solid ${filterRole === key ? def.color : brand.border}` }}>
                {def.label} ({count})
              </button>
            );
          })}
        </div>
      </Card>

      {/* Users list */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                {['User', 'Role', 'Permissions', 'Last Login', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: brand.textMuted }}>No users match your filter.</td></tr>
              )}
              {filteredUsers.map((u, idx) => {
                const role = ROLES[u.systemRole];
                const isYou = u.id === currentUser.id;
                return (
                  <tr key={u.id} className={`animate-fade-in-up stagger-${Math.min(idx + 1, 8)}`} style={{ borderBottom: `1px solid ${brand.border}` }}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold" style={{ backgroundColor: brand.goldPale, color: brand.gold }}>
                          {u.firstName[0]}{u.lastName[0]}
                        </div>
                        <div>
                          <p className="font-medium flex items-center gap-2" style={{ color: brand.text }}>
                            {u.firstName} {u.lastName}
                            {isYou && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: brand.goldPale, color: brand.gold }}>You</span>}
                          </p>
                          <p className="text-xs" style={{ color: brand.textMuted }}>{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="inline-flex items-center gap-2 px-2 py-1 rounded text-xs font-medium" style={{ backgroundColor: brand.cream, color: brand.navy }}>
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: role.color }} />
                        {role.label}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-xs" style={{ color: brand.textMuted }}>{role.permissions.length} permissions</td>
                    <td className="px-5 py-4 text-xs" style={{ color: brand.textMuted }}>{u.lastLogin ? timeAgo(u.lastLogin) : 'Never'}</td>
                    <td className="px-5 py-4"><StatusBadge status={u.status} /></td>
                    <td className="px-5 py-4">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setCurrentUser(u)} className="text-xs px-2 py-1 rounded btn-press" style={{ color: brand.navy, border: `1px solid ${brand.border}` }}>
                          Switch To
                        </button>
                        {canManage && (
                          <>
                            <button onClick={() => openEditRole(u)} className="text-xs px-2 py-1 rounded btn-press" style={{ color: brand.gold, border: `1px solid ${brand.border}` }}>
                              Change Role
                            </button>
                            {!isYou && (
                              <button onClick={() => setRevokeId(u.id)} className="text-xs px-2 py-1 rounded btn-press" style={{ color: brand.danger, border: `1px solid ${brand.border}` }}>
                                Revoke
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId !== null ? 'Change User Role' : 'Invite User'} size="md">
        {editingId === null && (
          <Field label="Employee" required hint="Only employees without existing access are shown">
            <Select value={form.employeeId || ''} onChange={(e) => setForm({ ...form, employeeId: Number(e.target.value) })}>
              {nonUsers.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} · {e.role}</option>)}
            </Select>
          </Field>
        )}
        <Field label="System Role" required>
          <div className="grid grid-cols-1 gap-2 mt-1">
            {Object.entries(ROLES).map(([key, def]) => (
              <button
                key={key}
                type="button"
                onClick={() => setForm({ ...form, systemRole: key })}
                className="text-left p-3 rounded transition-all btn-press"
                style={{
                  backgroundColor: form.systemRole === key ? brand.cream : '#fff',
                  border: `1px solid ${form.systemRole === key ? def.color : brand.border}`,
                  borderWidth: form.systemRole === key ? '2px' : '1px',
                  margin: form.systemRole === key ? '0' : '1px',
                }}
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: def.color }} />
                    <p className="text-sm font-semibold" style={{ color: brand.text }}>{def.label}</p>
                  </div>
                  <p className="text-xs" style={{ color: brand.textMuted }}>{def.permissions.length} permissions</p>
                </div>
                <p className="text-xs" style={{ color: brand.textMuted }}>{def.description}</p>
              </button>
            ))}
          </div>
        </Field>
        <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" icon={Save} onClick={handleSave}>{editingId !== null ? 'Update Role' : 'Send Invitation'}</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={revokeId !== null}
        onCancel={() => setRevokeId(null)}
        onConfirm={handleRevoke}
        title="Revoke Access"
        message="This user will lose all system access. They will remain an employee in your records but will no longer be able to sign in."
        confirmText="Revoke Access"
        danger
      />
    </div>
  );
};

// ============================================================
// JIBBLE INTEGRATION CARD
// ============================================================
const JibbleIntegrationCard = ({ showToast, logAction }) => {
  // Server-vault-backed. Credentials stored AES-256-GCM in the backend;
  // browser only sees last-4. Token exchange + API calls happen
  // server-side, sidestepping Jibble's browser CORS block.
  const [metadata, setMetadata] = useState({}); // key → row
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [dirty, setDirty] = useState(false);

  // Load current vault state on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await api.secrets.get('jibble');
        if (cancelled) return;
        const map = {};
        rows.forEach(r => { map[r.key] = r; });
        setMetadata(map);
        if (map.organizationId?.value) setOrganizationId(map.organizationId.value);
      } catch { /* not signed in */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const hasStoredCreds = !!metadata.clientId?.hasValue && !!metadata.clientSecret?.hasValue;
  const hasAccessToken = !!metadata.accessToken?.hasValue;

  const saveCredentials = async () => {
    try {
      const values = { organizationId };
      if (clientId) values.clientId = clientId.trim();
      if (clientSecret) values.clientSecret = clientSecret.trim();
      const rows = await api.secrets.set('jibble', values);
      const map = {};
      rows.forEach(r => { map[r.key] = r; });
      setMetadata(map);
      setClientId(''); setClientSecret('');
      setDirty(false);
      logAction('Updated Jibble integration credentials (server vault)');
      showToast('Jibble credentials saved (encrypted server-side)', 'success');
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    }
  };

  const handleTest = async () => {
    if (!hasStoredCreds && (!clientId || !clientSecret)) {
      setTestResult({ ok: false, error: 'Both Client ID and Client Secret are required' });
      return;
    }
    if (dirty && (clientId || clientSecret)) {
      await saveCredentials();
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.proxy.jibbleTest();
      setTestResult({ ok: true, peopleCount: result.peopleCount || 0 });
      logAction('Connected to Jibble (server-side OAuth)');
      showToast('Connected to Jibble', 'success');
      // refresh metadata to pick up the new accessToken row
      const rows = await api.secrets.get('jibble');
      const map = {};
      rows.forEach(r => { map[r.key] = r; });
      setMetadata(map);
    } catch (err) {
      setTestResult({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.secrets.clear('jibble');
      setMetadata({});
      setClientId(''); setClientSecret(''); setOrganizationId('');
      setTestResult(null);
      logAction('Disconnected Jibble (server vault cleared)');
      showToast('Disconnected from Jibble', 'success');
    } catch (err) {
      showToast('Disconnect failed: ' + err.message, 'error');
    }
  };

  return (
    <Card className="p-6 animate-fade-in-up">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded flex items-center justify-center font-bold text-white text-lg flex-shrink-0" style={{ backgroundColor: brand.navy }}>J</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Jibble</h3>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase rounded" style={{ backgroundColor: brand.successLight, color: brand.success, border: `1px solid ${brand.success}` }}>
                <Shield size={10} /> Server vault
              </span>
              <StatusBadge status={hasStoredCreds && hasAccessToken ? 'Active' : 'Inactive'} />
            </div>
          </div>
          <p className="text-xs mb-4" style={{ color: brand.textMuted }}>
            Time tracking and attendance. Get an API Key from{' '}
            <a href="https://web.jibble.io/settings/organization/api-keys" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: brand.gold }}>
              Jibble &rsaquo; Organization Settings &rsaquo; API Keys
            </a>.
          </p>

          <div className="p-3 rounded mb-4 text-xs flex items-start gap-2" style={{ backgroundColor: brand.successLight, color: brand.success }}>
            <Shield size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              <strong>Encrypted server-side.</strong> Your Client ID + Secret are AES-256-GCM encrypted at rest. Token exchange and API calls happen on the server, so Jibble's CORS policy doesn't block anything.
            </span>
          </div>

          {/* Credentials — Client Credentials only */}
          <div className="space-y-3 mb-4">
            <Field
              label="API Key ID (Client ID)"
              required={!metadata.clientId?.hasValue}
              hint={metadata.clientId?.hasValue ? `Currently stored: •••• ${metadata.clientId.last4}` : 'The first value Jibble shows you (UUID format)'}
            >
              <Input
                value={clientId}
                onChange={(e) => { setClientId(e.target.value); setDirty(true); }}
                placeholder={metadata.clientId?.hasValue ? 'Leave blank to keep existing' : 'e.g. af43a10a-c4f8-4c7a-a083-...'}
                autoComplete="off"
              />
            </Field>
            <Field
              label="API Key Secret"
              required={!metadata.clientSecret?.hasValue}
              hint={metadata.clientSecret?.hasValue ? `Currently stored: •••• ${metadata.clientSecret.last4}` : 'The longer secret string. Treat like a password.'}
            >
              <div className="flex gap-2">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={clientSecret}
                  onChange={(e) => { setClientSecret(e.target.value); setDirty(true); }}
                  placeholder={metadata.clientSecret?.hasValue ? 'Leave blank to keep existing' : 'Paste your API Key Secret here...'}
                  className="flex-1 px-3 py-2 text-sm rounded outline-none font-mono"
                  style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, color: brand.text }}
                  autoComplete="off" spellCheck="false"
                />
                <button type="button" onClick={() => setShowSecret(!showSecret)} className="px-3 py-2 text-xs rounded btn-press" style={{ color: brand.textMuted, border: `1px solid ${brand.border}` }}>
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
            <Field label="Organization ID" hint="Optional — only required for some endpoints">
              <Input
                value={organizationId}
                onChange={(e) => { setOrganizationId(e.target.value); setDirty(true); }}
                placeholder="Optional"
              />
            </Field>
          </div>

          {/* Test result banner */}
          {testResult && (
            <div className="mt-2 mb-3 p-3 rounded text-xs animate-fade-in-up" style={{
              backgroundColor: testResult.ok ? brand.successLight : brand.dangerLight,
              color: testResult.ok ? brand.success : brand.danger,
              border: `1px solid ${testResult.ok ? brand.success : brand.danger}`,
            }}>
              <div className="flex items-start gap-2">
                {testResult.ok ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />}
                <div className="flex-1">
                  <p className="font-semibold">
                    {testResult.ok ? 'Connection successful!' : 'Connection failed'}
                  </p>
                  {testResult.ok ? (
                    <p className="mt-1">
                      Token issued server-side. Found {testResult.peopleCount} {testResult.peopleCount === 1 ? 'person' : 'people'} in your Jibble workspace.
                    </p>
                  ) : (
                    <p className="mt-1" style={{ color: brand.text }}>{testResult.error}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="primary" icon={Save} onClick={saveCredentials} disabled={!dirty}>Save</Button>
            <Button size="sm" variant="gold" icon={Zap} onClick={handleTest} disabled={testing || (!hasStoredCreds && (!clientId || !clientSecret))}>
              {testing ? 'Testing…' : 'Test Connection'}
            </Button>
            {hasStoredCreds && (
              <Button size="sm" variant="danger" icon={X} onClick={handleDisconnect}>Disconnect</Button>
            )}
            <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => window.open('https://docs.api.jibble.io/', '_blank')}>API Docs</Button>
          </div>
        </div>
      </div>
    </Card>
  );
};

// ============================================================
// DOCUSIGN INTEGRATION CARD
// ============================================================
const DocuSignIntegrationCard = ({ integrations, setIntegrations, showToast, logAction }) => {
  const ds = integrations.docusign || {};
  const defaultRedirect = typeof window !== 'undefined'
    ? `${window.location.origin}/oauth/docusign-callback`
    : 'http://localhost:5173/oauth/docusign-callback';
  const [form, setForm] = useState({
    environment: ds.environment || 'demo',
    integrationKey: ds.integrationKey || '',
    clientSecret: ds.clientSecret || '',
    redirectUri: ds.redirectUri || defaultRedirect,
  });
  const [showSecret, setShowSecret] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm({
      environment: ds.environment || 'demo',
      integrationKey: ds.integrationKey || '',
      clientSecret: ds.clientSecret || '',
      redirectUri: ds.redirectUri || defaultRedirect,
    });
    setDirty(false);
  }, [ds.environment, ds.integrationKey, ds.clientSecret, ds.redirectUri]);

  const updateField = (key, value) => { setForm(f => ({ ...f, [key]: value })); setDirty(true); };

  const save = () => {
    const cleaned = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    );
    setForm(cleaned);
    setIntegrations({
      ...integrations,
      docusign: {
        ...ds,
        ...cleaned,
        // Clear cached tokens whenever credentials change
        cachedAccessToken: '',
        cachedAccessTokenExpiry: null,
        cachedRefreshToken: '',
      },
    });
    logAction('Updated DocuSign integration credentials');
    showToast('DocuSign credentials saved', 'success');
    setDirty(false);
  };

  const handleConnect = () => {
    if (!form.integrationKey || !form.clientSecret) {
      showToast('Integration Key and Secret are required', 'error');
      return;
    }
    if (!form.redirectUri) {
      showToast('Redirect URI is required', 'error');
      return;
    }
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try {
      sessionStorage.setItem('ep:ds-oauth-pending', JSON.stringify({
        state,
        environment: form.environment,
        integrationKey: form.integrationKey,
        clientSecret: form.clientSecret,
        redirectUri: form.redirectUri,
        startedAt: Date.now(),
      }));
    } catch (err) {
      showToast(`Could not start OAuth flow: ${err.message}`, 'error');
      return;
    }
    const authUrl = docusignAPI.buildAuthorizeUrl({
      environment: form.environment,
      clientId: form.integrationKey,
      redirectUri: form.redirectUri,
      state,
    });
    logAction('Initiated DocuSign OAuth flow');
    window.location.href = authUrl;
  };

  const handleDisconnect = () => {
    setIntegrations({
      ...integrations,
      docusign: {
        ...ds,
        connected: false,
        cachedAccessToken: '',
        cachedAccessTokenExpiry: null,
        cachedRefreshToken: '',
        accountId: '',
        baseUri: '',
        userId: '',
        userEmail: '',
        lastSyncStatus: null,
        lastSyncError: null,
      },
    });
    logAction('Disconnected DocuSign');
    showToast('Disconnected from DocuSign', 'success');
  };

  const envHost = form.environment === 'prod' ? 'https://account.docusign.com' : 'https://account-d.docusign.com';

  return (
    <Card className="p-6 animate-fade-in-up">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded flex items-center justify-center font-bold text-white text-lg flex-shrink-0" style={{ backgroundColor: '#FFCC22', color: '#000' }}>DS</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>DocuSign</h3>
            <StatusBadge status={ds.connected ? 'Active' : 'Inactive'} />
          </div>
          <p className="text-xs mb-3" style={{ color: brand.textMuted }}>
            Send leases for electronic signature. Create an app in{' '}
            <a href="https://admindemo.docusign.com/api-integrator-key" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: brand.gold }}>
              DocuSign Admin &rsaquo; Apps &amp; Keys
            </a>{' '}
            and register the Redirect URI shown below.
          </p>

          {ds.connected && ds.accountId && (
            <div className="p-3 rounded mb-4 text-xs flex items-start gap-2" style={{ backgroundColor: brand.successLight, color: brand.success }}>
              <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
              <div>
                <p><strong>Connected.</strong> Account <code>{ds.accountId}</code>{ds.userEmail && <> · {ds.userEmail}</>}</p>
                <p className="mt-0.5">Base URI: <code>{ds.baseUri}</code></p>
              </div>
            </div>
          )}

          <div className="space-y-3 mb-4">
            <Field label="Environment" hint="Use Demo while developing — keys do not cross between environments">
              <Select value={form.environment} onChange={(e) => updateField('environment', e.target.value)}>
                <option value="demo">{DOCUSIGN_ENVIRONMENTS.demo.label}</option>
                <option value="prod">{DOCUSIGN_ENVIRONMENTS.prod.label}</option>
              </Select>
            </Field>
            <Field label="Integration Key (Client ID)" required hint="UUID — from Apps & Keys → your app">
              <Input value={form.integrationKey} onChange={(e) => updateField('integrationKey', e.target.value)} placeholder="e.g. 1d4a2b8e-..." autoComplete="off" />
            </Field>
            <Field label="Client Secret" required hint="Generate a secret key in your DocuSign app. Stored in this browser.">
              <div className="flex gap-2">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={form.clientSecret}
                  onChange={(e) => updateField('clientSecret', e.target.value)}
                  placeholder="Paste your secret here..."
                  className="flex-1 px-3 py-2 text-sm rounded outline-none font-mono"
                  style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, color: brand.text }}
                  autoComplete="off" spellCheck="false"
                />
                <button type="button" onClick={() => setShowSecret(!showSecret)} className="px-3 py-2 text-xs rounded btn-press" style={{ color: brand.textMuted, border: `1px solid ${brand.border}` }}>
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
            <Field label="Redirect URI" required hint="MUST be added to your DocuSign app's Redirect URIs list">
              <Input value={form.redirectUri} onChange={(e) => updateField('redirectUri', e.target.value)} placeholder={defaultRedirect} />
            </Field>
          </div>

          {ds.lastSyncStatus === 'error' && ds.lastSyncError && (
            <div className="p-3 rounded mb-3 text-xs flex items-start gap-2" style={{ backgroundColor: brand.dangerLight, color: brand.danger }}>
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p><strong>Last error:</strong></p>
                <pre className="mt-1 whitespace-pre-wrap text-xs" style={{ fontFamily: 'inherit' }}>{ds.lastSyncError}</pre>
              </div>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="primary" icon={Save} onClick={save} disabled={!dirty}>Save</Button>
            {!ds.connected ? (
              <Button size="sm" variant="gold" icon={ExternalLink} onClick={handleConnect} disabled={!form.integrationKey || !form.clientSecret || !form.redirectUri || dirty}>
                Connect with DocuSign
              </Button>
            ) : (
              <Button size="sm" variant="gold" icon={RefreshCw} onClick={handleConnect} disabled={dirty}>
                Re-Connect
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => window.open(`${envHost}/`, '_blank')}>Open DocuSign</Button>
            {ds.connected && (
              <Button size="sm" variant="danger" icon={X} onClick={handleDisconnect}>Disconnect</Button>
            )}
          </div>

          <div className="mt-4 p-3 rounded text-xs flex items-start gap-2" style={{ backgroundColor: brand.cream, color: brand.textMuted }}>
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              <strong style={{ color: brand.text }}>How it works:</strong> Click <em>Connect with DocuSign</em>, sign in, approve the app. The lease drafter and Leasing section will then create real envelopes with sign/date/initial fields placed at the anchor strings embedded in the lease template (e.g. <code>\sig_landlord\</code>, <code>\sig_tenant\</code>). DocuSign emails the signers; on completion, the lease auto-advances to <em>Active</em>.
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
};

// ============================================================
// ANTHROPIC (CLAUDE API) INTEGRATION CARD
// ============================================================
const AnthropicIntegrationCard = ({ showToast, logAction }) => {
  // Server-vault-backed version. The API key never lives in the browser:
  //   - POST /api/secrets/anthropic stores the key, AES-256-GCM encrypted.
  //   - GET  /api/secrets/anthropic returns only metadata (last4, length).
  //   - POST /api/proxy/anthropic/messages forwards calls server-side.
  const [metadata, setMetadata] = useState({}); // {apiKey: {last4, length}, model: {value}}
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastTest, setLastTest] = useState(null); // { ok, at, error }
  const [loaded, setLoaded] = useState(false);

  // Load existing vault metadata on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await api.secrets.get('anthropic');
        if (cancelled) return;
        const map = {};
        rows.forEach(r => { map[r.key] = r; });
        setMetadata(map);
        if (map.model?.value) setModel(map.model.value);
      } catch { /* not signed in or no rows yet */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  const hasStoredKey = !!metadata.apiKey?.hasValue;

  const save = async () => {
    try {
      // Only send `apiKey` if the user actually typed a new one; otherwise
      // we'd overwrite the stored value with empty (which the vault
      // interprets as a delete).
      const values = { model };
      if (apiKey) values.apiKey = apiKey;
      const rows = await api.secrets.set('anthropic', values);
      const map = {};
      rows.forEach(r => { map[r.key] = r; });
      setMetadata(map);
      setApiKey(''); // clear the input — the stored value is in the vault now
      setDirty(false);
      logAction('Updated Anthropic API credentials (server vault)');
      showToast('Anthropic credentials saved (server vault, encrypted)', 'success');
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    }
  };

  const test = async () => {
    if (!hasStoredKey && !apiKey) {
      showToast('Paste an API key and Save first', 'error');
      return;
    }
    if (apiKey && dirty) {
      // Save before testing so the proxy uses the new value.
      await save();
    }
    setTesting(true);
    try {
      const res = await api.proxy.anthropicMessages({
        model,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      });
      const text = (res?.content?.[0]?.text || '').trim();
      const ok = /OK/i.test(text);
      setLastTest({ ok, at: new Date().toISOString(), error: ok ? null : `Unexpected response: ${text.slice(0, 80)}` });
      showToast(ok ? 'Connected to Claude API' : `Test returned: ${text.slice(0, 80)}`, ok ? 'success' : 'error');
    } catch (err) {
      setLastTest({ ok: false, at: new Date().toISOString(), error: err.message });
      showToast('Test failed: ' + err.message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    try {
      await api.secrets.clear('anthropic');
      setMetadata({});
      setApiKey('');
      setLastTest(null);
      logAction('Disconnected Anthropic API (server vault cleared)');
      showToast('Disconnected', 'success');
    } catch (err) {
      showToast('Disconnect failed: ' + err.message, 'error');
    }
  };

  return (
    <Card className="p-6 animate-fade-in-up">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded flex items-center justify-center font-bold text-white text-lg flex-shrink-0" style={{ backgroundColor: brand.navy }}>
          <Sparkles size={20} style={{ color: brand.gold }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Anthropic (Claude API)</h3>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase rounded" style={{ backgroundColor: brand.successLight, color: brand.success, border: `1px solid ${brand.success}` }}>
                <Shield size={10} /> Server vault
              </span>
              <StatusBadge status={hasStoredKey ? 'Active' : 'Inactive'} />
            </div>
          </div>
          <p className="text-xs mb-4" style={{ color: brand.textMuted }}>
            Powers PDF auto-populate, Lease Learner, and other AI features. Get a key from{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: brand.gold }}>
              console.anthropic.com → API Keys
            </a>.
          </p>

          <div className="p-3 rounded mb-4 text-xs flex items-start gap-2" style={{ backgroundColor: brand.successLight, color: brand.success }}>
            <Shield size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              <strong>Encrypted server-side.</strong> Your key is stored in the server's secrets vault (AES-256-GCM) and only used when the backend forwards calls to Anthropic on your behalf. The browser never sees the full key.
            </span>
          </div>

          <Field label="API Key" required={!hasStoredKey} hint={hasStoredKey ? `Currently stored: •••• ${metadata.apiKey.last4} (${metadata.apiKey.length} chars). Paste a new key to replace.` : 'Starts with sk-ant-api03-...'}>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setDirty(true); }}
                placeholder={hasStoredKey ? 'Leave blank to keep the existing key' : 'Paste your Anthropic API key here...'}
                autoComplete="off"
                className="flex-1 px-3 py-2 text-sm rounded outline-none font-mono"
                style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, color: brand.text }}
              />
              <button type="button" onClick={() => setShowKey(s => !s)} className="px-3 py-2 text-xs rounded" style={{ border: `1px solid ${brand.border}`, color: brand.text }}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          <Field label="Model" hint="Haiku is cheaper/faster; Sonnet is more accurate">
            <Select value={model} onChange={(e) => { setModel(e.target.value); setDirty(true); }}>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (fast)</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (accurate)</option>
              <option value="claude-opus-4-7">Claude Opus 4.7 (best)</option>
            </Select>
          </Field>

          {lastTest && (
            <p className="text-xs mb-3" style={{ color: brand.textMuted }}>
              {lastTest.ok ? 'Test passed' : 'Test failed'} · {timeAgo(lastTest.at)}
              {lastTest.error && <span style={{ color: brand.danger }}> · {lastTest.error}</span>}
            </p>
          )}

          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="primary" icon={Save} onClick={save} disabled={!dirty}>Save</Button>
            <Button size="sm" variant="gold" icon={Zap} onClick={test} disabled={testing || (!hasStoredKey && !apiKey)}>
              {testing ? 'Testing…' : 'Test Connection'}
            </Button>
            {hasStoredKey && (
              <Button size="sm" variant="ghost" icon={X} onClick={disconnect}>Disconnect</Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

// ============================================================
// SAMPLE PI INSPECTIONS — shaped exactly per PI's API docs
// (https://my.propertyinspect.com/dev/docs/inspections). Used as a
// fallback when the live API is gated by scopes we can't influence,
// so the downstream pipeline (Move-Ins/Outs) is provably functional.
// No PI data is mutated by loading these.
// ============================================================
const PI_SAMPLE_INSPECTIONS = {
  pagination: { perPage: 10, currentPage: 1, totalPages: 1, totalRecords: 6 },
  data: [
    {
      id: 1001, account_id: 1,
      property: {
        id: 501, ref: 'BRY-2B',
        address: { line1: 'Flat 12, Bryanston Heights Apartments', line2: 'Bryanston Drive', city: 'Sandton', county: 'Gauteng', postcode: '2191', country: 'South Africa' },
        furnished: 'Semi furnished', type: 'Apartment',
      },
      clerk: { id: 14, name: 'Hetty van Wyk', is_manager: false },
      state: { id: 400, name: 'Complete' },
      type: { id: 2, name: 'Check In' },
      ref: 'CI-2026-041', title: 'Move-In Inventory',
      report_key: 'a1b2c3d4e5f6', location_of_keys: 'With Agent',
      conduct_date: '2026-05-18T09:30:00', completed_at: '2026-05-18T11:45:00',
    },
    {
      id: 1002, account_id: 1,
      property: {
        id: 502, ref: 'GH-7',
        address: { line1: 'House 7, Greenstone Hill Estate', city: 'Edenvale', county: 'Gauteng', postcode: '1609', country: 'South Africa' },
        furnished: 'Unfurnished', type: 'House',
      },
      clerk: { id: 14, name: 'Hetty van Wyk', is_manager: false },
      state: { id: 400, name: 'Complete' },
      type: { id: 5, name: 'Check Out' },
      ref: 'CO-2026-038', title: 'Move-Out Comparison',
      report_key: 'f6e5d4c3b2a1', location_of_keys: 'Returned to office',
      conduct_date: '2026-05-15T14:00:00', completed_at: '2026-05-15T16:20:00',
    },
    {
      id: 1003, account_id: 1,
      property: {
        id: 503, ref: 'RV-A14',
        address: { line1: 'Unit A14, Riverside Estate', city: 'Modderfontein', county: 'Gauteng', postcode: '1645', country: 'South Africa' },
        furnished: 'Fully furnished', type: 'Apartment',
      },
      clerk: { id: 14, name: 'Hetty van Wyk', is_manager: false },
      state: { id: 400, name: 'Complete' },
      type: { id: 6, name: 'Inventory & Check In' },
      ref: 'ICI-2026-019', title: 'New Tenant Inventory & Move-In',
      report_key: 'd1e2f3a4b5c6', location_of_keys: 'With Agent',
      conduct_date: '2026-05-12T10:00:00', completed_at: '2026-05-12T13:15:00',
    },
    {
      id: 1004, account_id: 1,
      property: {
        id: 504, ref: 'BRY-4A',
        address: { line1: 'Flat 4A, Bryanston Heights Apartments', city: 'Sandton', county: 'Gauteng', postcode: '2191', country: 'South Africa' },
        furnished: 'Semi furnished', type: 'Apartment',
      },
      clerk: { id: 14, name: 'Hetty van Wyk', is_manager: false },
      state: { id: 400, name: 'Complete' },
      type: { id: 5, name: 'Check Out' },
      ref: 'CO-2026-042', title: 'End-of-Tenancy',
      report_key: 'c3b4a5d6e7f8', location_of_keys: 'Returned to office',
      conduct_date: '2026-05-09T11:00:00', completed_at: '2026-05-09T12:40:00',
    },
    {
      id: 1005, account_id: 1,
      property: {
        id: 505, ref: 'GH-22',
        address: { line1: 'House 22, Greenstone Hill Estate', city: 'Edenvale', county: 'Gauteng', postcode: '1609', country: 'South Africa' },
        furnished: 'Unfurnished', type: 'House',
      },
      clerk: { id: 14, name: 'Hetty van Wyk', is_manager: false },
      state: { id: 400, name: 'Complete' },
      type: { id: 2, name: 'Check In' },
      ref: 'CI-2026-044', title: 'Move-In Inventory',
      report_key: 'e8f7a6b5c4d3', location_of_keys: 'With Agent',
      conduct_date: '2026-05-05T09:00:00', completed_at: '2026-05-05T11:30:00',
    },
    {
      id: 1006, account_id: 1,
      property: {
        id: 506, ref: 'RV-B22',
        address: { line1: 'Unit B22, Riverside Estate', city: 'Modderfontein', county: 'Gauteng', postcode: '1645', country: 'South Africa' },
        furnished: 'Fully furnished', type: 'Apartment',
      },
      clerk: { id: 14, name: 'Hetty van Wyk', is_manager: false },
      state: { id: 400, name: 'Complete' },
      type: { id: 5, name: 'Check Out' },
      ref: 'CO-2026-040', title: 'Tenant Exit',
      report_key: 'a9b8c7d6e5f4', location_of_keys: 'Returned to office',
      conduct_date: '2026-04-29T13:30:00', completed_at: '2026-04-29T15:00:00',
    },
  ],
};

// ============================================================
// PROPERTY INSPECT INTEGRATION CARD — READ-ONLY
// Pulls inspections from Property Inspect. Never writes back.
// ============================================================
const PropertyInspectIntegrationCard = ({ integrations, setIntegrations, showToast, logAction }) => {
  const pi = integrations.propertyInspect || {};
  // Auto-migrate the old bad authorize URL — anyone who connected on a
  // previous build still has 'api.propertyinspect.com/oauth/authorize' in
  // their integration state and would keep getting Unauthenticated.
  const resolveAuthorizeUrl = (stored) => {
    if (!stored || stored === propertyInspectAPI.legacyBadAuthorizeUrl) {
      return propertyInspectAPI.defaultAuthorizeUrl;
    }
    return stored;
  };
  const DEFAULT_PI_SCOPES = 'read-inspections read-properties read-clients read-staff read-templates read-contacts';
  // PI silently ignores the '*' wildcard — every endpoint then 403s with
  // "Invalid scope(s) provided." If a previous build stored '*', swap it
  // for the explicit-name default so the next Connect issues a real token.
  const resolveScope = (stored) => {
    if (!stored || stored === '*') return DEFAULT_PI_SCOPES;
    return stored;
  };
  const [form, setForm] = useState({
    baseUrl: pi.baseUrl || propertyInspectAPI.defaultBaseUrl,
    tokenUrl: pi.tokenUrl || propertyInspectAPI.defaultTokenUrl,
    authorizeUrl: resolveAuthorizeUrl(pi.authorizeUrl),
    redirectUri: pi.redirectUri || propertyInspectAPI.defaultRedirectUri,
    clientId: pi.clientId || '',
    clientSecret: pi.clientSecret || '',
    // PI silently ignores '*' (Passport wildcard), so we instead ask for
    // a space-separated list of explicit read-* scopes that match the
    // resources in PI's API docs sidebar (Clients, Properties, etc.).
    // PI's authorize page accepts whichever it recognizes and drops the
    // unknown ones. If the user finds the canonical names in PI's docs,
    // they can override this list in the Scope field.
    scope: resolveScope(pi.scope),
  });
  const [showSecret, setShowSecret] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    setForm({
      baseUrl: pi.baseUrl || propertyInspectAPI.defaultBaseUrl,
      tokenUrl: pi.tokenUrl || propertyInspectAPI.defaultTokenUrl,
      authorizeUrl: resolveAuthorizeUrl(pi.authorizeUrl),
      redirectUri: pi.redirectUri || propertyInspectAPI.defaultRedirectUri,
      clientId: pi.clientId || '',
      clientSecret: pi.clientSecret || '',
      scope: resolveScope(pi.scope),
    });
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pi.baseUrl, pi.tokenUrl, pi.authorizeUrl, pi.redirectUri, pi.clientId, pi.clientSecret, pi.scope]);

  const updateField = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
    setTestResult(null);
  };

  const saveCredentials = async () => {
    // Trim each value — stray whitespace in OAuth params breaks PI auth.
    const cleaned = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    );
    setForm(cleaned);
    try {
      // Persist to the server vault so the backend's exchange-code and
      // /property-inspect/get endpoints can read the creds. localStorage is
      // a UI-only mirror; the server has no access to it.
      await api.secrets.set('propertyInspect', {
        clientId: cleaned.clientId,
        clientSecret: cleaned.clientSecret,
        redirectUri: cleaned.redirectUri,
        baseUrl: cleaned.baseUrl,
        tokenUrl: cleaned.tokenUrl,
        authorizeUrl: cleaned.authorizeUrl,
      });
    } catch (err) {
      showToast(`Failed to save credentials: ${err.message}`, 'error');
      return;
    }
    setIntegrations({
      ...integrations,
      propertyInspect: {
        ...pi,
        ...cleaned,
        // Connection happens after the OAuth redirect callback.
        cachedAccessToken: '',
        cachedAccessTokenExpiry: null,
        cachedRefreshToken: '',
      },
    });
    logAction('Updated Property Inspect integration credentials');
    showToast('Property Inspect credentials saved', 'success');
    setDirty(false);
  };

  // Kick off the authorization_code flow: persist a pending-flow record to
  // localStorage (so we can resume after the redirect bounces back through
  // the PI login), then redirect the browser to PI's authorize URL. The
  // resulting access_token is bound to the logged-in PI user — which is
  // what every data endpoint requires (client_credentials tokens get 500'd).
  const handleConnect = async () => {
    // Trim every field — a stray trailing space in Client ID encodes as `+`
    // in the URL and Property Inspect rejects it as "invalid_client".
    const cleaned = {
      clientId: (form.clientId || '').trim(),
      clientSecret: (form.clientSecret || '').trim(),
      tokenUrl: (form.tokenUrl || '').trim(),
      redirectUri: (form.redirectUri || '').trim(),
      authorizeUrl: (form.authorizeUrl || '').trim(),
      baseUrl: (form.baseUrl || '').trim(),
      scope: (form.scope || '').trim(),
    };

    if (!cleaned.clientId || !cleaned.clientSecret) {
      setTestResult({ ok: false, error: 'Both Client ID and Client Secret are required before connecting' });
      return;
    }
    if (!cleaned.redirectUri) {
      setTestResult({ ok: false, error: 'Redirect URI is required — it must match one of the URLs registered in your PI API app' });
      return;
    }

    // Persist the trimmed values so subsequent calls don't re-introduce whitespace.
    setForm(f => ({ ...f, ...cleaned }));
    try {
      // The server's exchange-code route reads creds from the vault — push
      // them up BEFORE we hand off to PI's authorize page, otherwise the
      // callback returns "Property Inspect integration is not configured".
      await api.secrets.set('propertyInspect', {
        clientId: cleaned.clientId,
        clientSecret: cleaned.clientSecret,
        redirectUri: cleaned.redirectUri,
        baseUrl: cleaned.baseUrl,
        tokenUrl: cleaned.tokenUrl,
        authorizeUrl: cleaned.authorizeUrl,
      });
    } catch (err) {
      setTestResult({ ok: false, error: `Could not persist credentials: ${err.message}` });
      return;
    }
    setIntegrations({
      ...integrations,
      propertyInspect: {
        ...pi,
        ...cleaned,
        // Don't pre-mark as connected; that happens on successful callback.
        cachedAccessToken: '',
        cachedAccessTokenExpiry: null,
        cachedRefreshToken: '',
      },
    });

    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try {
      sessionStorage.setItem('ep:pi-oauth-pending', JSON.stringify({
        state,
        ...cleaned,
        startedAt: Date.now(),
      }));
    } catch (err) {
      setTestResult({ ok: false, error: `Could not start OAuth flow: ${err.message}` });
      return;
    }

    // Request a scope. Without this, PI (Laravel Passport) issues a token
    // with no scopes attached, and scope-protected endpoints like
    // /inspections respond with 403 "Invalid scope(s) provided". '*' is the
    // Passport wildcard convention — the consent screen lists whatever the
    // PI admin has configured for our app and the user approves.
    const scope = (form.scope || '').trim();
    const authUrl = propertyInspectAPI.buildAuthorizeUrl({
      clientId: cleaned.clientId,
      redirectUri: cleaned.redirectUri,
      state,
      scope: scope || undefined,
      authorizeUrl: cleaned.authorizeUrl,
    });
    logAction(`Initiated Property Inspect OAuth flow (scope: ${scope || '<none>'})`);
    window.location.href = authUrl;
  };

  // Normalize a Property Inspect inspection payload into a shape we can display.
  // Mirrors the structure documented at /dev/docs/inspections: id, property
  // (with nested address), type {id, name}, state {id, name}, clerk, dates.
  const normalizePI = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const addr = raw.property?.address || {};
    const propertyAddr = typeof addr === 'string'
      ? addr
      : [addr.line1, addr.line2, addr.city, addr.county, addr.postcode].filter(Boolean).join(', ');
    return {
      id: String(raw.id ?? raw.inspectionId ?? raw.uuid ?? Math.random().toString(36).slice(2)),
      title: raw.title || raw.type?.name || 'Inspection',
      typeId: raw.type?.id ?? null,
      typeName: raw.type?.name || (typeof raw.type === 'string' ? raw.type : '—'),
      stateId: raw.state?.id ?? null,
      stateName: raw.state?.name || raw.status || (raw.completed_at ? 'Complete' : 'Pending'),
      property: propertyAddr || raw.property?.name || '—',
      propertyId: raw.property?.id ?? null,
      propertyRef: raw.property?.ref || null,
      conductDate: raw.conduct_date || raw.conductDate || raw.scheduledDate || null,
      completedAt: raw.completed_at || raw.completedAt || null,
      startedAt: raw.started_at || raw.startedAt || raw.start_date || null,
      submittedAt: raw.submitted_at || raw.submittedAt || null,
      ref: raw.ref || null,
      reportKey: raw.report_key || raw.reportKey || null,
      clerk: raw.clerk?.name || raw.assignee?.name || raw.staffName || null,
      raw,
    };
  };

  // Load PI's documented sample response into importedInspections. Useful
  // when the live API is blocked by scope config (PI-side) — proves the
  // ingest + display pipeline works end-to-end with real PI-shaped data.
  // No data is fetched from or sent to PI in this path.
  const handleLoadSample = () => {
    const list = PI_SAMPLE_INSPECTIONS.data;
    const normalized = list.map(normalizePI).filter(Boolean);
    setIntegrations({
      ...integrations,
      propertyInspect: {
        ...pi,
        importedInspections: normalized,
        importedCount: normalized.length,
        lastSync: new Date().toISOString(),
        lastSyncStatus: 'success',
        lastSyncError: null,
      },
    });
    logAction(`Loaded ${normalized.length} sample inspection(s) from PI docs example`);
    showToast(`Loaded ${normalized.length} sample inspections — see Move-Ins / Outs page`, 'success');
  };

  // Endpoints we know exist from PI's API docs sidebar. Each is tried in
  // sequence; whatever returns 2xx is kept. Scope-protected endpoints that
  // 403 are recorded but don't abort the pull — the user still gets data
  // from anything their token DOES have scopes for. /me and /account are
  // typically scope-less on Laravel Passport and are useful even when
  // every other endpoint rejects the token.
  const PI_ENDPOINTS = [
    { path: '/me',          label: 'My user',     itemType: 'user' },
    { path: '/account',     label: 'Account',     itemType: 'account' },
    { path: '/user',        label: 'User info',   itemType: 'user' },
    { path: '/staff',       label: 'Staff',       itemType: 'staff' },
    { path: '/clients',     label: 'Clients',     itemType: 'client' },
    { path: '/contacts',    label: 'Contacts',    itemType: 'contact' },
    { path: '/properties',  label: 'Properties',  itemType: 'property' },
    { path: '/templates',   label: 'Templates',   itemType: 'template' },
    { path: '/inspections', label: 'Inspections', itemType: 'inspection' },
  ];

  const extractList = (payload) => {
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload)) return payload;
    // Single-object endpoints like /me or /account.
    if (payload && typeof payload === 'object') return [payload];
    return [];
  };

  const handleFetch = async () => {
    setFetching(true);
    const report = {}; // path -> { ok, count, status, message, sample }
    let inspections = [];
    let probeError = null;
    try {
      // One server round-trip — the backend fans out to PI in parallel,
      // collects per-path { ok, status, body|message } and returns a map.
      // The old client-side serial loop hit Render's request timeout on
      // endpoint 5+ and returned generic 502s with no body.
      const { report: serverReport } = await api.proxy.piProbe(PI_ENDPOINTS.map(e => e.path));
      for (const { path, label } of PI_ENDPOINTS) {
        const r = serverReport[path] || { ok: false, status: 0, message: 'no result' };
        if (r.ok) {
          const list = extractList(r.body);
          report[path] = { ok: true, label, count: list.length, sample: list.slice(0, 3) };
          if (path === '/inspections') {
            inspections = list.map(normalizePI).filter(Boolean);
          }
        } else {
          const message = r.message || r.body?.message || r.body?.error || (r.body?.raw ? String(r.body.raw).slice(0, 200) : `HTTP ${r.status}`);
          report[path] = { ok: false, label, status: r.status, message };
        }
      }
    } catch (err) {
      probeError = err?.body?.message || err?.body?.error || err?.message || String(err);
      // Fall back to per-endpoint failure rows so the UI still shows the
      // same shape (otherwise the report panel just disappears).
      for (const { path, label } of PI_ENDPOINTS) {
        report[path] = { ok: false, label, status: err?.status || 0, message: probeError };
      }
    }

    const successCount = Object.values(report).filter(r => r.ok).length;
    const failCount = Object.values(report).filter(r => !r.ok).length;
    const totalItems = Object.values(report).filter(r => r.ok).reduce((sum, r) => sum + (r.count || 0), 0);

    setIntegrations({
      ...integrations,
      propertyInspect: {
        ...pi,
        connected: true,
        importedInspections: inspections,
        importedCount: inspections.length,
        endpointReport: report,
        lastSync: new Date().toISOString(),
        lastSyncStatus: successCount > 0 ? 'success' : 'error',
        lastSyncError: successCount > 0
          ? null
          : `Every endpoint rejected the token. Most likely your PI OAuth app has no scopes assigned — needs to be enabled in your PI dev portal or via PI support.`,
      },
    });

    if (successCount > 0) {
      logAction(`PI pull: ${successCount} endpoint(s) OK (${totalItems} items), ${failCount} blocked`);
      showToast(
        inspections.length > 0
          ? `Pulled ${inspections.length} inspection${inspections.length === 1 ? '' : 's'} (+ ${totalItems - inspections.length} other PI records)`
          : `Pulled ${totalItems} item(s) from PI — but /inspections is blocked. See endpoint report below.`,
        inspections.length > 0 ? 'success' : 'error',
      );
    } else {
      logAction(`PI pull: 0 endpoints accessible — token has no usable scopes`);
      showToast('Live pull failed: every PI endpoint rejected the token. See report below.', 'error');
    }
    setFetching(false);
  };

  // Run a single GET against PI and capture the exact request + response
  // bytes so we can compare side-by-side with PI's docs. Read-only.
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagResult, setDiagResult] = useState(null);
  const [diagPath, setDiagPath] = useState('/inspections');
  const [diagRunning, setDiagRunning] = useState(false);

  const runDiagnostic = async () => {
    setDiagRunning(true);
    const path = diagPath.startsWith('/') ? diagPath : `/${diagPath}`;
    const base = (pi.baseUrl || propertyInspectAPI.defaultBaseUrl).replace(/\/+$/, '');
    const fullUrl = `${base}${path}`;
    const reqHeaders = {
      'Authorization': 'Bearer <stored server-side>',
      'Accept': 'application/json',
    };
    try {
      // Route through the backend proxy. Browser-direct fetches to
      // api.propertyinspect.com are blocked in production by both CSP
      // (connect-src 'self') and PI's CORS policy, AND the access token
      // is held in the server vault — not the browser. The proxy attaches
      // the token server-side and returns PI's response verbatim.
      const body = await api.proxy.piGet(path);
      setDiagResult({
        request: { url: fullUrl, fetchedAs: `/api/proxy/property-inspect/get?path=${path}`, method: 'GET', headers: reqHeaders },
        response: { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body, null, 2).slice(0, 2000) },
      });
    } catch (err) {
      // ApiError carries the upstream status + body so we can show the
      // real PI response, not just "fetch failed".
      const status = err?.status || 0;
      const upstreamMessage = err?.body?.message || err?.body?.error || err?.message || String(err);
      const upstreamBody = err?.body ? JSON.stringify(err.body, null, 2) : (err?.message || String(err));
      setDiagResult({
        request: { url: fullUrl, fetchedAs: `/api/proxy/property-inspect/get?path=${path}`, method: 'GET', headers: reqHeaders },
        response: status
          ? { status, statusText: upstreamMessage, headers: {}, body: upstreamBody.slice(0, 2000) }
          : { error: upstreamMessage },
      });
    } finally {
      setDiagRunning(false);
    }
  };

  // Decode the current access token (if it's a JWT) to see what scopes PI
  // actually granted. Tells us whether our requested scope was accepted,
  // ignored, or stripped.
  const [tokenInspectorOpen, setTokenInspectorOpen] = useState(false);
  const tokenClaims = (() => {
    const token = pi.cachedAccessToken;
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return { _notJwt: true, raw: token.slice(0, 80) + '…' };
    try {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
      return JSON.parse(atob(padded));
    } catch (err) {
      return { _decodeError: err.message };
    }
  })();

  const handleDisconnect = async () => {
    try {
      // Wipe the server vault too — otherwise stale tokens linger and the
      // next handleConnect can resume with old credentials.
      await api.secrets.clear('propertyInspect');
    } catch (err) {
      showToast(`Failed to clear server credentials: ${err.message}`, 'error');
      return;
    }
    setIntegrations({
      ...integrations,
      propertyInspect: {
        ...pi,
        connected: false,
        clientId: '',
        clientSecret: '',
        cachedAccessToken: '',
        cachedAccessTokenExpiry: null,
        cachedRefreshToken: '',
        lastSyncStatus: null,
        lastSyncError: null,
      },
    });
    setForm({ ...form, clientId: '', clientSecret: '' });
    logAction('Disconnected Property Inspect (server vault cleared)');
    showToast('Disconnected from Property Inspect', 'success');
  };

  const imported = pi.importedInspections || [];

  return (
    <Card className="p-6 animate-fade-in-up">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded flex items-center justify-center font-bold text-white text-lg flex-shrink-0" style={{ backgroundColor: '#2D6A4F' }}>
          <ClipboardCheck size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Property Inspect</h3>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase rounded" style={{ backgroundColor: brand.cream, color: brand.gold, border: `1px solid ${brand.gold}` }}>
                <Lock size={10} /> Read-only
              </span>
              <StatusBadge status={pi.connected ? 'Active' : 'Inactive'} />
            </div>
          </div>
          <p className="text-xs mb-3" style={{ color: brand.textMuted }}>
            Pulls inspections (inventories, check-ins, check-outs, mid-terms) from Property Inspect. Click <strong>Connect</strong> to log in to PI and approve read access.
          </p>

          <div className="p-3 rounded mb-4 text-xs flex items-start gap-2" style={{ backgroundColor: brand.successLight, color: brand.success }}>
            <Shield size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              <strong>One-way pull only.</strong> This integration only sends GET requests to Property Inspect — no inspections, properties, contacts or actions on the PI side are ever created, updated, or deleted by this app.
            </span>
          </div>

          <div className="p-3 rounded mb-4 text-xs flex items-start gap-2" style={{ backgroundColor: brand.cream, color: brand.textMuted }}>
            <Info size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              <strong style={{ color: brand.text }}>Make sure these match in your PI app settings:</strong> the Client ID and Client Secret below, and a Redirect URL of <code>{form.redirectUri || propertyInspectAPI.defaultRedirectUri}</code> registered in the "Redirect URLs" section of your PI API app.
            </span>
          </div>

          {/* Credentials */}
          <div className="space-y-3 mb-4">
            <Field label="Client ID" required hint="From your Property Inspect API Application">
              <Input value={form.clientId} onChange={(e) => updateField('clientId', e.target.value)} placeholder="e.g. 1d4a2b8e-..." autoComplete="off" />
            </Field>
            <Field label="Client Secret" required hint="Stored in this browser. Treat it like a password.">
              <div className="flex gap-2">
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={form.clientSecret}
                  onChange={(e) => updateField('clientSecret', e.target.value)}
                  placeholder="Paste your Client Secret here..."
                  className="flex-1 px-3 py-2 text-sm rounded outline-none font-mono"
                  style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, color: brand.text }}
                  autoComplete="off" spellCheck="false"
                />
                <button type="button" onClick={() => setShowSecret(!showSecret)} className="px-3 py-2 text-xs rounded btn-press" style={{ color: brand.textMuted, border: `1px solid ${brand.border}` }}>
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>

            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={() => setShowAdvanced(s => !s)} className="text-xs underline" style={{ color: brand.textMuted }}>
                {showAdvanced ? 'Hide' : 'Show'} advanced URLs
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(f => ({ ...f, baseUrl: propertyInspectAPI.defaultBaseUrl, tokenUrl: propertyInspectAPI.defaultTokenUrl }));
                  setDirty(true);
                  setTestResult(null);
                }}
                className="text-xs underline"
                style={{ color: brand.gold }}
              >
                Reset URLs to defaults
              </button>
            </div>
            {/^https?:\/\/my\.propertyinspect\.com\/api/i.test(form.baseUrl) && (
              <div className="p-3 rounded text-xs flex items-start gap-2" style={{ backgroundColor: brand.warningLight, color: brand.warning }}>
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>Your API Base URL points at <code>my.propertyinspect.com</code>, but the live API is at <code>api.propertyinspect.com</code>. Click <strong>Reset URLs to defaults</strong> above, then Save.</span>
              </div>
            )}
            {showAdvanced && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                <Field label="API Base URL" hint="The host that serves data endpoints">
                  <Input value={form.baseUrl} onChange={(e) => updateField('baseUrl', e.target.value)} placeholder={propertyInspectAPI.defaultBaseUrl} />
                </Field>
                <Field label="Authorize URL" hint="Where the user is redirected to approve access">
                  <Input value={form.authorizeUrl} onChange={(e) => updateField('authorizeUrl', e.target.value)} placeholder={propertyInspectAPI.defaultAuthorizeUrl} />
                </Field>
                <Field label="OAuth Token URL" hint="Exchanges the authorization code for tokens">
                  <Input value={form.tokenUrl} onChange={(e) => updateField('tokenUrl', e.target.value)} placeholder={propertyInspectAPI.defaultTokenUrl} />
                </Field>
                <Field label="Redirect URI" required hint="MUST exactly match a Redirect URL registered in your PI API app">
                  <Input value={form.redirectUri} onChange={(e) => updateField('redirectUri', e.target.value)} placeholder={propertyInspectAPI.defaultRedirectUri} />
                </Field>
                <Field label="OAuth Scope" hint="'*' = all scopes the app has been granted (Passport wildcard). If PI rejects, try a specific name like 'inspections.read' or leave blank.">
                  <Input value={form.scope} onChange={(e) => updateField('scope', e.target.value)} placeholder="*" />
                </Field>
              </div>
            )}
          </div>

          {/* Pre-flight check failures (shown only when handleConnect refuses to redirect) */}
          {testResult && !testResult.ok && (
            <div
              className="p-3 rounded mb-4 text-xs flex items-start gap-2"
              style={{ backgroundColor: brand.dangerLight, color: brand.danger }}
            >
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p><strong>Can't start OAuth flow.</strong></p>
                <pre className="mt-1 whitespace-pre-wrap text-xs" style={{ fontFamily: 'inherit' }}>{testResult.error}</pre>
              </div>
            </div>
          )}

          {/* Last sync status display */}
          {pi.lastSyncStatus === 'error' && pi.lastSyncError && (
            <div className="p-3 rounded mb-4 text-xs flex items-start gap-2" style={{ backgroundColor: brand.dangerLight, color: brand.danger }}>
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p><strong>Last sync failed.</strong></p>
                <pre className="mt-1 whitespace-pre-wrap text-xs" style={{ fontFamily: 'inherit' }}>{pi.lastSyncError}</pre>
                {/Invalid scope\(s\) provided/i.test(pi.lastSyncError) && (
                  <div className="mt-2" style={{ color: brand.text }}>
                    <p><strong>What this means:</strong> the API recognises your account but is blocking this endpoint. The fix is on PI's side — your API app needs access enabled for inspections. Email PI support or check your PI account's API app permissions.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Last sync */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 mb-3">
            <Field label="Last Sync">
              <Input value={pi.lastSync ? `${formatDate(pi.lastSync)} (${timeAgo(pi.lastSync)})` : 'Never'} disabled />
            </Field>
            <Field label="Inspections Imported">
              <Input value={String(pi.importedCount || 0)} disabled />
            </Field>
          </div>

          {/* Per-endpoint pull report — shows which PI endpoints your token
              can actually reach. Anything red is being rejected by PI's scope
              middleware; anything green returned data. Updated on every Pull. */}
          {pi.endpointReport && (
            <div className="mb-4">
              <p className="text-xs font-semibold tracking-wider uppercase mb-2" style={{ color: brand.navy }}>Endpoint report (last pull)</p>
              <div className="rounded overflow-hidden" style={{ border: `1px solid ${brand.border}` }}>
                {Object.entries(pi.endpointReport).map(([path, r]) => (
                  <div key={path} className="px-3 py-2 flex items-center gap-2 text-xs" style={{ borderTop: `1px solid ${brand.border}`, backgroundColor: r.ok ? brand.successLight : brand.dangerLight }}>
                    {r.ok
                      ? <CheckCircle2 size={14} style={{ color: brand.success, flexShrink: 0 }} />
                      : <AlertCircle size={14} style={{ color: brand.danger, flexShrink: 0 }} />}
                    <code className="font-mono" style={{ color: brand.text, minWidth: '120px' }}>{path}</code>
                    {r.ok
                      ? <span style={{ color: brand.success }}>{r.count} item{r.count === 1 ? '' : 's'}</span>
                      : <span style={{ color: brand.danger }}>HTTP {r.status || '?'} · {r.message}</span>}
                  </div>
                ))}
              </div>
              <p className="text-[11px] mt-2" style={{ color: brand.textMuted }}>
                Green rows are endpoints your token reached. Red rows were rejected — usually scope-protected endpoints your PI OAuth app hasn't been granted access to.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="primary" icon={Save} onClick={saveCredentials} disabled={!dirty}>Save</Button>
            {!pi.connected ? (
              <Button size="sm" variant="gold" icon={ExternalLink} onClick={handleConnect} disabled={!form.clientId || !form.clientSecret || !form.redirectUri || dirty}>
                Connect with Property Inspect
              </Button>
            ) : (
              <Button size="sm" variant="gold" icon={RefreshCw} onClick={handleConnect} disabled={!form.clientId || !form.clientSecret || !form.redirectUri || dirty}>
                Re-Connect
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={Download}
              onClick={handleFetch}
              disabled={fetching || dirty || !pi.connected}
            >
              {fetching ? 'Pulling…' : 'Pull Inspections'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={FileText}
              onClick={handleLoadSample}
              disabled={fetching || dirty}
            >
              Load Sample Data
            </Button>
            {imported.length > 0 && (
              <Button size="sm" variant="ghost" icon={Eye} onClick={() => setPreviewOpen(true)}>
                Preview ({imported.length})
              </Button>
            )}
            {pi.connected && (
              <>
                <Button size="sm" variant="ghost" icon={Eye} onClick={() => setTokenInspectorOpen(true)}>Inspect Token</Button>
                <Button size="sm" variant="ghost" icon={Activity} onClick={() => { setDiagOpen(true); setDiagResult(null); }}>Diagnose Request</Button>
                <Button size="sm" variant="danger" icon={X} onClick={handleDisconnect}>Disconnect</Button>
              </>
            )}
          </div>
          {dirty && (
            <p className="mt-2 text-xs" style={{ color: brand.textMuted }}>You have unsaved changes — click Save before Connecting.</p>
          )}
        </div>
      </div>

      <Modal open={diagOpen} onClose={() => setDiagOpen(false)} title="Diagnose Request" size="lg">
        <p className="text-xs mb-3" style={{ color: brand.textMuted }}>
          Send a single GET to PI with the documented request shape (Bearer token + Accept JSON only). Captures the exact response so you can compare against PI's API docs literally.
        </p>
        <div className="flex gap-2 mb-3">
          <Input value={diagPath} onChange={(e) => setDiagPath(e.target.value)} placeholder="/inspections" />
          <Button size="sm" variant="primary" onClick={runDiagnostic} disabled={diagRunning}>
            {diagRunning ? 'Running…' : 'Send GET'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1 mb-3">
          {['/inspections', '/properties', '/clients', '/contacts', '/staff', '/templates', '/me', '/account', '/user'].map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setDiagPath(p)}
              className="px-2 py-1 text-xs rounded btn-press"
              style={{
                backgroundColor: diagPath === p ? brand.gold : '#fff',
                color: diagPath === p ? '#fff' : brand.text,
                border: `1px solid ${diagPath === p ? brand.gold : brand.border}`,
                fontFamily: 'monospace',
              }}
            >
              {p}
            </button>
          ))}
        </div>
        {diagResult && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold mb-1" style={{ color: brand.text }}>Request</p>
              <pre className="p-2 rounded text-xs overflow-auto" style={{ backgroundColor: brand.cream, color: brand.text, fontFamily: 'monospace' }}>
{`${diagResult.request.method} ${diagResult.request.url}
${Object.entries(diagResult.request.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}`}
              </pre>
              {diagResult.request.fetchedAs !== diagResult.request.url && (
                <p className="text-xs mt-1" style={{ color: brand.textMuted }}>Dev-proxy rewrites this to: <code>{diagResult.request.fetchedAs}</code></p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold mb-1" style={{ color: brand.text }}>Response</p>
              {diagResult.response.error ? (
                <pre className="p-2 rounded text-xs" style={{ backgroundColor: brand.dangerLight, color: brand.danger, fontFamily: 'monospace' }}>
{diagResult.response.error}
                </pre>
              ) : (
                <>
                  <pre className="p-2 rounded text-xs" style={{ backgroundColor: brand.cream, color: brand.text, fontFamily: 'monospace' }}>
{`HTTP ${diagResult.response.status} ${diagResult.response.statusText}
${Object.entries(diagResult.response.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}`}
                  </pre>
                  <p className="text-xs font-semibold mt-2 mb-1" style={{ color: brand.text }}>Response body (first 2KB)</p>
                  <pre className="p-2 rounded text-xs overflow-auto max-h-64" style={{ backgroundColor: brand.cream, color: brand.text, fontFamily: 'monospace' }}>
{diagResult.response.body}
                  </pre>
                </>
              )}
            </div>
          </div>
        )}
        <div className="flex justify-end mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={() => setDiagOpen(false)}>Close</Button>
        </div>
      </Modal>

      <Modal open={tokenInspectorOpen} onClose={() => setTokenInspectorOpen(false)} title="Access Token Inspector" size="md">
        <p className="text-xs mb-3" style={{ color: brand.textMuted }}>
          Decoded JWT claims from your current access token. The <code>scopes</code> (or <code>scope</code>) field shows what permissions PI actually granted — compare against what <code>/inspections</code> says is "Invalid".
        </p>
        {!tokenClaims ? (
          <p className="text-xs" style={{ color: brand.textMuted }}>No token cached. Click Connect first.</p>
        ) : tokenClaims._notJwt ? (
          <div className="text-xs" style={{ color: brand.textMuted }}>
            <p>The token isn't a standard JWT — it's an opaque token. PI's docs (or <code>GET /me</code>) are the only way to see granted scopes.</p>
            <pre className="mt-2 p-2 rounded" style={{ backgroundColor: brand.cream, color: brand.text }}>{tokenClaims.raw}</pre>
          </div>
        ) : tokenClaims._decodeError ? (
          <p className="text-xs" style={{ color: brand.danger }}>Decode error: {tokenClaims._decodeError}</p>
        ) : (
          <>
            {(tokenClaims.scopes || tokenClaims.scope) && (
              <div className="p-3 rounded mb-3 text-xs" style={{ backgroundColor: brand.successLight, color: brand.success }}>
                <strong>Granted scopes:</strong> <code>{Array.isArray(tokenClaims.scopes) ? tokenClaims.scopes.join(' ') : (tokenClaims.scopes || tokenClaims.scope)}</code>
              </div>
            )}
            {!tokenClaims.scopes && !tokenClaims.scope && (
              <div className="p-3 rounded mb-3 text-xs" style={{ backgroundColor: brand.warningLight, color: brand.warning }}>
                <strong>No scopes claim found.</strong> PI stripped your requested scope — try a different value in the Scope field.
              </div>
            )}
            <pre className="p-3 rounded text-xs overflow-auto max-h-64" style={{ backgroundColor: brand.cream, color: brand.text, fontFamily: 'monospace' }}>
              {JSON.stringify(tokenClaims, null, 2)}
            </pre>
          </>
        )}
        <div className="flex justify-end mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={() => setTokenInspectorOpen(false)}>Close</Button>
        </div>
      </Modal>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Imported Inspections" size="lg">
        {imported.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="Nothing pulled yet" message="Click 'Pull Inspections' to fetch the latest from Property Inspect." />
        ) : (
          <div className="space-y-2">
            <p className="text-xs mb-2" style={{ color: brand.textMuted }}>
              Showing {imported.length} inspection{imported.length === 1 ? '' : 's'} pulled at {pi.lastSync ? new Date(pi.lastSync).toLocaleString('en-ZA') : '—'}. These are read-only — they live in this app only and were not modified on Property Inspect.
            </p>
            {imported.map((insp) => (
              <Card key={insp.id} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <StatusBadge status={insp.status === 'Completed' ? 'Completed' : (insp.status === 'Cancelled' ? 'Inactive' : (insp.status === 'Assigned' ? 'Scheduled' : 'Pending'))} />
                      <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: brand.cream, color: brand.navy }}>{insp.type}</span>
                    </div>
                    <p className="text-sm font-semibold truncate" style={{ color: brand.navy }}>{insp.title}</p>
                    <p className="text-xs truncate" style={{ color: brand.textMuted }}>{insp.property}</p>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs" style={{ color: brand.textMuted }}>
                      {insp.conductDate && <span>{formatDate(insp.conductDate)}</span>}
                      {insp.clerk && <span>· {insp.clerk}</span>}
                      <span>· PI ID: {insp.id}</span>
                    </div>
                  </div>
                  {insp.reportUrl && (
                    <a href={insp.reportUrl} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 rounded inline-flex items-center gap-1 flex-shrink-0" style={{ color: brand.gold, border: `1px solid ${brand.gold}` }}>
                      <ExternalLink size={12} /> Report
                    </a>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
        <div className="flex justify-end mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={() => setPreviewOpen(false)}>Close</Button>
        </div>
      </Modal>
    </Card>
  );
};

// ============================================================
// SETTINGS
// ============================================================
const SettingsSection = ({
  companyProfile, setCompanyProfile,
  departments, setDepartments,
  notificationPrefs, setNotificationPrefs,
  integrations, setIntegrations,
  security, setSecurity,
  auditLog, setAuditLog,
  employees, properties, inspections, leases, debtors, maintenance,
  setEmployees, setProperties, setInspections, setLeases, setDebtors, setMaintenance,
  showToast, logAction,
}) => {
  const [activeTab, setActiveTab] = useState('company');
  const [companyForm, setCompanyForm] = useState(companyProfile);
  const [companyErrors, setCompanyErrors] = useState({});
  const [newDept, setNewDept] = useState('');
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [deptToDelete, setDeptToDelete] = useState(null);

  useEffect(() => { setCompanyForm(companyProfile); }, [companyProfile]);

  const tabs = [
    { id: 'company', label: 'Company', icon: Briefcase },
    { id: 'departments', label: 'Departments', icon: Users },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'integrations', label: 'Integrations', icon: Sliders },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'data', label: 'Data Management', icon: Database },
    { id: 'audit', label: 'Audit Log', icon: FileText },
    { id: 'about', label: 'About', icon: Info },
  ];

  // ---- Company Profile ----
  const companySchema = {
    name: [validators.required],
    email: [validators.email],
    phone: [validators.phone],
    address: [validators.required],
  };

  const saveCompany = () => {
    const errors = validateForm(companyForm, companySchema);
    setCompanyErrors(errors);
    if (Object.keys(errors).length > 0) {
      showToast('Please fix the errors before saving', 'error');
      return;
    }
    setCompanyProfile(companyForm);
    logAction('Updated company profile');
    showToast('Company profile saved', 'success');
  };

  // ---- Departments ----
  const addDept = () => {
    const trimmed = newDept.trim();
    if (!trimmed) { showToast('Enter a department name', 'error'); return; }
    if (departments.includes(trimmed)) { showToast('That department already exists', 'error'); return; }
    setDepartments([...departments, trimmed]);
    logAction(`Added department: ${trimmed}`);
    showToast(`Department "${trimmed}" added`, 'success');
    setNewDept('');
  };

  const removeDept = () => {
    const inUse = employees.some(e => e.department === deptToDelete);
    if (inUse) {
      showToast('Cannot remove a department with employees assigned to it', 'error');
      setDeptToDelete(null);
      return;
    }
    setDepartments(departments.filter(d => d !== deptToDelete));
    logAction(`Removed department: ${deptToDelete}`);
    showToast(`Department "${deptToDelete}" removed`, 'success');
    setDeptToDelete(null);
  };

  // ---- Data Export / Reset ----
  const exportData = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      companyProfile, departments, notificationPrefs, integrations, security,
      employees, properties, inspections, leases, debtors, maintenance, auditLog,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exceed-properties-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logAction('Exported full data backup');
    showToast('Backup downloaded', 'success');
  };

  const resetAllData = () => {
    setEmployees(seedEmployees);
    setProperties(seedProperties);
    setInspections(seedInspections);
    setLeases(seedLeases);
    setDebtors(seedDebtors);
    setMaintenance(seedMaintenance);
    setCompanyProfile(defaultCompanyProfile);
    setDepartments(defaultDepartments);
    setNotificationPrefs(defaultNotificationPrefs);
    setIntegrations(defaultIntegrations);
    setSecurity(defaultSecurity);
    setAuditLog([{ id: Date.now(), action: 'System reset to factory defaults', user: 'Wayne Marks', timestamp: new Date().toISOString() }]);
    showToast('All data reset to defaults', 'success');
    setResetConfirmOpen(false);
  };

  // ---- Notification helpers ----
  const setPref = (event, channel, value) => {
    setNotificationPrefs({ ...notificationPrefs, [event]: { ...notificationPrefs[event], [channel]: value } });
  };

  const notifEvents = [
    { key: 'leaseExpiring', label: 'Lease Expiring', desc: 'Notify when a lease is within 90 days of expiry' },
    { key: 'paymentOverdue', label: 'Payment Overdue', desc: 'Notify when a tenant payment becomes overdue' },
    { key: 'inspectionScheduled', label: 'Inspection Scheduled', desc: 'Notify assigned inspector and property manager' },
    { key: 'maintenanceRequest', label: 'New Maintenance Request', desc: 'Notify operations when a request is logged' },
    { key: 'employeeFlagged', label: 'Employee Flagged', desc: 'Late clock-ins or attendance issues' },
    { key: 'weeklyReport', label: 'Weekly Summary Report', desc: 'Monday morning portfolio summary' },
  ];

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Configuration</p>
        <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Settings</h1>
        <p className="text-sm" style={{ color: brand.textMuted }}>Manage company information, integrations, and system preferences.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Settings sub-nav */}
        <Card className="p-2 self-start">
          {tabs.map(t => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded transition-all"
                style={{ backgroundColor: active ? brand.cream : 'transparent', color: active ? brand.navy : brand.textMuted, fontWeight: active ? 600 : 400 }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </Card>

        {/* Settings content */}
        <div>
          {/* COMPANY */}
          {activeTab === 'company' && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Company Profile</h2>
                  <p className="text-xs" style={{ color: brand.textMuted }}>Information used on lease agreements, invoices, and reports.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                <Field label="Registered Company Name" required error={companyErrors.name}>
                  <Input value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} error={companyErrors.name} />
                </Field>
                <Field label="Trading Name">
                  <Input value={companyForm.tradingName} onChange={(e) => setCompanyForm({ ...companyForm, tradingName: e.target.value })} />
                </Field>
                <Field label="Registration Number">
                  <Input value={companyForm.registration} onChange={(e) => setCompanyForm({ ...companyForm, registration: e.target.value })} />
                </Field>
                <Field label="VAT Number">
                  <Input value={companyForm.vatNumber} onChange={(e) => setCompanyForm({ ...companyForm, vatNumber: e.target.value })} />
                </Field>
                <Field label="Phone Number" required error={companyErrors.phone}>
                  <Input value={companyForm.phone} onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })} error={companyErrors.phone} />
                </Field>
                <Field label="Email Address" required error={companyErrors.email}>
                  <Input type="email" value={companyForm.email} onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })} error={companyErrors.email} />
                </Field>
                <Field label="Website">
                  <Input value={companyForm.website} onChange={(e) => setCompanyForm({ ...companyForm, website: e.target.value })} />
                </Field>
                <Field label="Physical Address" required error={companyErrors.address}>
                  <Input value={companyForm.address} onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} error={companyErrors.address} />
                </Field>
              </div>
              <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
                <Button variant="ghost" onClick={() => setCompanyForm(companyProfile)}>Discard</Button>
                <Button variant="primary" icon={Save} onClick={saveCompany}>Save Changes</Button>
              </div>
            </Card>
          )}

          {/* DEPARTMENTS */}
          {activeTab === 'departments' && (
            <Card className="p-6">
              <div className="mb-5">
                <h2 className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Departments & Teams</h2>
                <p className="text-xs" style={{ color: brand.textMuted }}>Three primary departments each with multiple teams. Click a team to see its members.</p>
              </div>

              <div className="space-y-4">
                {Object.entries(DEPARTMENTS_CONFIG).filter(([dept]) => dept !== 'Executive').map(([dept, cfg]) => {
                  const deptMembers = employees.filter(e => e.department === dept);
                  return (
                    <div key={dept} className="rounded overflow-hidden" style={{ border: `1px solid ${brand.border}` }}>
                      <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: brand.cream }}>
                        <div className="flex items-center gap-3">
                          <div className="w-1 h-8 rounded" style={{ backgroundColor: cfg.color }} />
                          <div>
                            <p className="text-sm font-semibold" style={{ color: brand.navy }}>{dept}</p>
                            <p className="text-xs" style={{ color: brand.textMuted }}>{cfg.description}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold" style={{ color: brand.navy }}>{deptMembers.length}</p>
                          <p className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>Members</p>
                        </div>
                      </div>
                      <div className="p-4 space-y-3">
                        {cfg.teams.map(team => {
                          const teamMembers = employees.filter(e => e.department === dept && e.team === team);
                          const lead = teamMembers.find(m => m.isTeamLead);
                          return (
                            <div key={team} className="rounded p-3" style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}>
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Layers size={12} style={{ color: cfg.color }} />
                                  <p className="text-sm font-medium" style={{ color: brand.text }}>{team}</p>
                                  <span className="text-xs" style={{ color: brand.textMuted }}>· {teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''}</span>
                                </div>
                                {lead && (
                                  <p className="text-xs" style={{ color: brand.textMuted }}>
                                    Lead: <span className="font-medium" style={{ color: brand.text }}>{lead.firstName} {lead.lastName}</span>
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {teamMembers.length === 0 ? (
                                  <p className="text-xs italic" style={{ color: brand.textMuted }}>No team members yet</p>
                                ) : (
                                  teamMembers.map(m => (
                                    <div key={m.id} className="flex items-center gap-1.5 px-2 py-1 rounded text-xs" style={{ backgroundColor: brand.cream }}>
                                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold" style={{ backgroundColor: brand.goldPale, color: brand.gold }}>
                                        {m.firstName[0]}{m.lastName[0]}
                                      </div>
                                      <span style={{ color: brand.text }}>{m.firstName} {m.lastName}</span>
                                      {m.isTeamLead && <span className="text-[10px] px-1 rounded font-medium" style={{ backgroundColor: brand.navy, color: '#fff' }}>Lead</span>}
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 p-3 rounded text-xs flex items-start gap-2" style={{ backgroundColor: brand.cream, color: brand.textMuted }}>
                <Info size={14} className="mt-0.5 flex-shrink-0" />
                <span>Department and team structure is defined in code. To assign an employee to a team, edit them in the <strong style={{ color: brand.text }}>Employees</strong> section.</span>
              </div>
            </Card>
          )}

          {/* NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <Card className="p-6">
              <div className="mb-5">
                <h2 className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Notification Preferences</h2>
                <p className="text-xs" style={{ color: brand.textMuted }}>Choose which channels notify you for each event type.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                      <th className="text-left py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>Event</th>
                      <th className="text-center py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>Email</th>
                      <th className="text-center py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>SMS</th>
                      <th className="text-center py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>In-App</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifEvents.map(ev => (
                      <tr key={ev.key} style={{ borderBottom: `1px solid ${brand.border}` }}>
                        <td className="py-3 pr-3">
                          <p className="text-sm font-medium" style={{ color: brand.text }}>{ev.label}</p>
                          <p className="text-xs" style={{ color: brand.textMuted }}>{ev.desc}</p>
                        </td>
                        {['email', 'sms', 'inApp'].map(ch => (
                          <td key={ch} className="py-3 text-center">
                            <button
                              type="button"
                              onClick={() => setPref(ev.key, ch, !notificationPrefs[ev.key]?.[ch])}
                              className="inline-flex h-5 w-9 rounded-full transition-colors relative"
                              style={{ backgroundColor: notificationPrefs[ev.key]?.[ch] ? brand.success : brand.borderDark }}
                            >
                              <span className="absolute top-0.5 inline-block h-4 w-4 rounded-full bg-white transition-transform" style={{ transform: notificationPrefs[ev.key]?.[ch] ? 'translateX(18px)' : 'translateX(2px)' }} />
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 p-3 rounded text-xs flex items-start gap-2" style={{ backgroundColor: brand.goldPale, color: brand.warning }}>
                <Info size={14} className="mt-0.5 flex-shrink-0" />
                <span>Changes are saved automatically. SMS notifications require an active SMS provider in Integrations.</span>
              </div>
            </Card>
          )}

          {/* INTEGRATIONS */}
          {activeTab === 'integrations' && (
            <div className="space-y-4">
              <JibbleIntegrationCard
                showToast={showToast}
                logAction={logAction}
              />

              <DocuSignIntegrationCard
                integrations={integrations}
                setIntegrations={setIntegrations}
                showToast={showToast}
                logAction={logAction}
              />

              <AnthropicIntegrationCard
                showToast={showToast}
                logAction={logAction}
              />

              <PropertyInspectIntegrationCard
                integrations={integrations}
                setIntegrations={setIntegrations}
                showToast={showToast}
                logAction={logAction}
              />

              {/* Email Provider */}
              <Card className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: brand.gold }}><Mail size={20} className="text-white" /></div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Email Provider · {integrations.emailProvider.provider}</h3>
                      <StatusBadge status={integrations.emailProvider.connected ? 'Active' : 'Inactive'} />
                    </div>
                    <p className="text-xs mb-4" style={{ color: brand.textMuted }}>Sends lease notifications, debtor reminders, and reports.</p>
                    <Field label="From Address">
                      <Input value={integrations.emailProvider.fromAddress} onChange={(e) => setIntegrations({ ...integrations, emailProvider: { ...integrations.emailProvider, fromAddress: e.target.value } })} />
                    </Field>
                    <Button variant="ghost" onClick={() => showToast('Test email sent to Wayne Marks', 'success')}>Send Test Email</Button>
                  </div>
                </div>
              </Card>

              {/* SMS Provider */}
              <Card className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: brand.warning }}><Phone size={20} className="text-white" /></div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>SMS Provider · {integrations.smsProvider.provider}</h3>
                      <StatusBadge status={integrations.smsProvider.connected ? 'Active' : 'Inactive'} />
                    </div>
                    <p className="text-xs mb-4" style={{ color: brand.textMuted }}>Required to send SMS notifications and payment reminders.</p>
                    <Field label="Sender Number">
                      <Input value={integrations.smsProvider.fromNumber} onChange={(e) => setIntegrations({ ...integrations, smsProvider: { ...integrations.smsProvider, fromNumber: e.target.value } })} placeholder="+27 11 555 0100" />
                    </Field>
                    <Button variant={integrations.smsProvider.connected ? 'danger' : 'gold'} onClick={() => { setIntegrations({ ...integrations, smsProvider: { ...integrations.smsProvider, connected: !integrations.smsProvider.connected } }); showToast(integrations.smsProvider.connected ? 'SMS provider disconnected' : 'SMS provider connected', 'success'); }}>
                      {integrations.smsProvider.connected ? 'Disconnect' : 'Connect'}
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* SECURITY */}
          {activeTab === 'security' && (
            <Card className="p-6">
              <div className="mb-5">
                <h2 className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Security & Access</h2>
                <p className="text-xs" style={{ color: brand.textMuted }}>Authentication and session policies for all users.</p>
              </div>
              <Toggle
                checked={security.twoFactorRequired}
                onChange={(v) => { setSecurity({ ...security, twoFactorRequired: v }); logAction(`Two-factor authentication ${v ? 'required' : 'disabled'}`); }}
                label="Require Two-Factor Authentication"
                description="Every user must verify a one-time code on each login"
              />
              <Toggle
                checked={security.passwordRequireSpecial}
                onChange={(v) => setSecurity({ ...security, passwordRequireSpecial: v })}
                label="Require Special Characters in Passwords"
                description="Passwords must include at least one symbol"
              />
              <Toggle
                checked={security.loginAlertEmails}
                onChange={(v) => setSecurity({ ...security, loginAlertEmails: v })}
                label="Email Alerts for New Logins"
                description="Notify the account holder of logins from new devices"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 mt-4">
                <Field label="Session Timeout (minutes)" hint="Auto-logout after inactivity">
                  <Input type="number" value={security.sessionTimeoutMinutes} onChange={(e) => setSecurity({ ...security, sessionTimeoutMinutes: Number(e.target.value) })} min={5} max={480} />
                </Field>
                <Field label="Minimum Password Length" hint="Recommended: 12 or more">
                  <Input type="number" value={security.passwordMinLength} onChange={(e) => setSecurity({ ...security, passwordMinLength: Number(e.target.value) })} min={8} max={32} />
                </Field>
              </div>
            </Card>
          )}

          {/* DATA */}
          {activeTab === 'data' && (
            <div className="space-y-4">
              <Card className="p-6">
                <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Data Backup</h2>
                <p className="text-xs mb-4" style={{ color: brand.textMuted }}>Download a complete JSON snapshot of all employees, properties, leases, debtors, inspections, maintenance, and settings.</p>
                <div className="flex items-center gap-3 mb-4">
                  <div className="grid grid-cols-3 gap-3 flex-1 text-xs">
                    <div className="text-center p-2 rounded" style={{ backgroundColor: brand.cream }}>
                      <p className="font-semibold text-base" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{employees.length}</p>
                      <p style={{ color: brand.textMuted }}>Employees</p>
                    </div>
                    <div className="text-center p-2 rounded" style={{ backgroundColor: brand.cream }}>
                      <p className="font-semibold text-base" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{leases.length}</p>
                      <p style={{ color: brand.textMuted }}>Leases</p>
                    </div>
                    <div className="text-center p-2 rounded" style={{ backgroundColor: brand.cream }}>
                      <p className="font-semibold text-base" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{debtors.length}</p>
                      <p style={{ color: brand.textMuted }}>Debtor Records</p>
                    </div>
                  </div>
                </div>
                <Button variant="primary" icon={Download} onClick={exportData}>Export Full Backup</Button>
              </Card>

              <Card className="p-6" style={{ borderColor: brand.danger }}>
                <h2 className="text-lg font-semibold mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.danger }}>Danger Zone</h2>
                <p className="text-xs mb-4" style={{ color: brand.textMuted }}>Resets every record back to the seeded sample data. Cannot be undone.</p>
                <Button variant="danger" icon={Undo2} onClick={() => setResetConfirmOpen(true)}>Reset All Data</Button>
              </Card>
            </div>
          )}

          {/* AUDIT LOG */}
          {activeTab === 'audit' && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Activity Log</h2>
                  <p className="text-xs" style={{ color: brand.textMuted }}>System actions logged for audit and compliance.</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setAuditLog([]); showToast('Audit log cleared', 'success'); }}>Clear Log</Button>
              </div>
              {auditLog.length === 0 ? (
                <EmptyState icon={FileText} title="No activity yet" message="Actions you take across the system will appear here." />
              ) : (
                <div className="space-y-2">
                  {auditLog.slice(0, 100).map(entry => (
                    <div key={entry.id} className="flex items-start gap-3 py-2 px-3 rounded" style={{ backgroundColor: brand.cream }}>
                      <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: brand.gold }} />
                      <div className="flex-1">
                        <p className="text-sm" style={{ color: brand.text }}>{entry.action}</p>
                        <p className="text-xs mt-0.5" style={{ color: brand.textMuted }}>{entry.user} · {new Date(entry.timestamp).toLocaleString('en-ZA')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* ABOUT */}
          {activeTab === 'about' && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>About</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2" style={{ borderBottom: `1px solid ${brand.border}` }}>
                  <span style={{ color: brand.textMuted }}>Product</span>
                  <span style={{ color: brand.text }}>Exceed Properties Management System</span>
                </div>
                <div className="flex justify-between py-2" style={{ borderBottom: `1px solid ${brand.border}` }}>
                  <span style={{ color: brand.textMuted }}>Version</span>
                  <span style={{ color: brand.text }}>0.5.0 · Preview</span>
                </div>
                <div className="flex justify-between py-2" style={{ borderBottom: `1px solid ${brand.border}` }}>
                  <span style={{ color: brand.textMuted }}>Data Persistence</span>
                  <span style={{ color: brand.success }}>Enabled</span>
                </div>
                <div className="flex justify-between py-2" style={{ borderBottom: `1px solid ${brand.border}` }}>
                  <span style={{ color: brand.textMuted }}>Support</span>
                  <span style={{ color: brand.text }}>support@exceedproperties.co.za</span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={resetConfirmOpen}
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={resetAllData}
        title="Reset All Data"
        message="This will permanently delete all current records and restore the seeded sample data. Make sure you have a backup before proceeding."
        confirmText="Reset Everything"
        danger
      />
      <ConfirmDialog
        open={deptToDelete !== null}
        onCancel={() => setDeptToDelete(null)}
        onConfirm={removeDept}
        title={`Remove "${deptToDelete}"`}
        message={`Are you sure you want to remove the ${deptToDelete} department?`}
        confirmText="Remove Department"
        danger
      />
    </div>
  );
};

// ============================================================
// NOTIFICATIONS PANEL
// ============================================================
const NotificationsPanel = ({ open, onClose, notifications, setNotifications, onNavigate }) => {
  if (!open) return null;
  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => setNotifications(notifications.map(n => ({ ...n, read: true })));
  const markRead = (id) => setNotifications(notifications.map(n => n.id === id ? { ...n, read: true } : n));
  const clearAll = () => setNotifications([]);

  const navByType = (n) => {
    markRead(n.id);
    const map = { overdue: 'debtors', inspection: 'inspections', lease: 'leasing', maintenance: 'maintenance', time: 'time' };
    if (map[n.type]) onNavigate(map[n.type]);
    onClose();
  };

  const severityColor = { high: brand.danger, medium: brand.warning, low: brand.navy };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed right-4 top-16 w-96 max-h-[calc(100vh-5rem)] z-50 rounded-lg overflow-hidden flex flex-col animate-fade-in"
        style={{ backgroundColor: '#fff', border: `1px solid ${brand.borderDark}`, boxShadow: '0 10px 25px rgba(0,0,0,0.15)' }}
      >
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${brand.border}` }}>
          <div>
            <h3 className="text-sm font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>Notifications</h3>
            <p className="text-xs" style={{ color: brand.textMuted }}>{unreadCount} unread</p>
          </div>
          <div className="flex gap-1">
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs px-2 py-1 rounded hover:bg-black hover:bg-opacity-5" style={{ color: brand.gold }}>Mark all read</button>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-black hover:bg-opacity-5">
              <X size={14} style={{ color: brand.textMuted }} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <EmptyState icon={Bell} title="All clear" message="You have no notifications." />
          ) : (
            notifications.map(n => (
              <button
                key={n.id}
                onClick={() => navByType(n)}
                className="w-full text-left px-4 py-3 hover:bg-black hover:bg-opacity-[0.02] flex gap-3 transition-colors"
                style={{ borderBottom: `1px solid ${brand.border}`, backgroundColor: n.read ? 'transparent' : brand.cream }}
              >
                <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: n.read ? brand.borderDark : severityColor[n.severity] }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: brand.text }}>{n.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: brand.textMuted }}>{n.message}</p>
                  <p className="text-xs mt-1" style={{ color: brand.textMuted }}>{n.time}</p>
                </div>
              </button>
            ))
          )}
        </div>
        {notifications.length > 0 && (
          <div className="px-4 py-2" style={{ borderTop: `1px solid ${brand.border}` }}>
            <button onClick={clearAll} className="text-xs" style={{ color: brand.textMuted }}>Clear all</button>
          </div>
        )}
      </div>
    </>
  );
};

// ============================================================
// LOGIN PAGE
// ============================================================
const LoginPage = ({ onLoggedIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError('');
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    setSubmitting(true);
    try {
      // Backend handles bcrypt verification, session creation, audit log.
      const user = await api.auth.login(email.trim(), password);
      onLoggedIn(user);
    } catch (err) {
      if (err.status === 429) {
        setError('Too many login attempts. Wait 15 minutes and try again.');
      } else if (err.status === 401) {
        setError('Invalid email or password');
      } else {
        setError('Login failed: ' + (err.message || 'unknown error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: brand.navy }}>
      <form onSubmit={handleSubmit} className="w-full max-w-sm animate-fade-in-up">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded mb-4" style={{ backgroundColor: brand.gold, color: brand.navy, fontFamily: 'Georgia, serif', fontSize: '28px', fontWeight: 700 }}>
            E
          </div>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', fontWeight: 600, color: '#fff' }}>Exceed Properties</h1>
          <p className="text-sm" style={{ color: brand.gold }}>Sign in to continue</p>
        </div>

        <div className="rounded-lg p-6" style={{ backgroundColor: '#fff' }}>
          <Field label="Email Address">
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: brand.textMuted }} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@exceedproperties.co.za"
                autoComplete="email"
                autoFocus
                className="w-full pl-9 pr-3 py-2 text-sm rounded outline-none"
                style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, color: brand.text }}
              />
            </div>
          </Field>
          <Field label="Password">
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: brand.textMuted }} />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full pl-9 pr-14 py-2 text-sm rounded outline-none"
                style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, color: brand.text }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-1.5 py-0.5"
                style={{ color: brand.textMuted }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          {error && (
            <div className="mb-3 p-2 rounded text-xs flex items-center gap-2" style={{ backgroundColor: brand.dangerLight, color: brand.danger }}>
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-2.5 text-sm font-medium tracking-wide rounded transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: brand.navy, color: '#fff' }}
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>

          <p className="text-xs mt-4 text-center" style={{ color: brand.textMuted }}>
            Trouble signing in? Contact your administrator. Passwords are managed server-side and never stored in your browser.
          </p>
        </div>
      </form>
    </div>
  );
};

// ============================================================
// CHANGE PASSWORD MODAL — shown on first login when mustChange flag is set
// ============================================================
const ChangePasswordModal = ({ currentUser, mustChange, onChanged, onCancel, showToast }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError('');
    if (!newPassword || newPassword.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      setError('Password must include letters, a digit, AND a symbol (e.g. !@#$%)');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!mustChange && !currentPassword) {
      setError('Enter your current password');
      return;
    }
    setSubmitting(true);
    try {
      await api.auth.changePassword({
        currentPassword: mustChange ? undefined : currentPassword,
        newPassword,
      });
      showToast('Password updated', 'success');
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Failed to update password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(15, 30, 46, 0.7)' }}>
      <div className="max-w-md w-full rounded-lg animate-scale-in" style={{ backgroundColor: brand.ivory, border: `1px solid ${brand.borderDark}` }}>
        <div className="px-6 py-4" style={{ borderBottom: `1px solid ${brand.border}` }}>
          <h3 className="text-lg font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>
            {mustChange ? 'Set a new password' : 'Change password'}
          </h3>
          <p className="text-xs mt-1" style={{ color: brand.textMuted }}>
            {mustChange
              ? "You're signed in with a temporary password. Choose something only you'll know — at least 10 characters with letters, a digit, AND a symbol."
              : 'Enter your current password and choose a new one.'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5">
          {!mustChange && (
            <Field label="Current Password">
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus />
            </Field>
          )}
          <Field label="New Password" hint="At least 10 chars · must include letters, a digit, AND a symbol (e.g. !@#$%)">
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus={mustChange} />
          </Field>
          <Field label="Confirm New Password">
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </Field>

          {error && (
            <div className="mb-3 p-2 rounded text-xs flex items-center gap-2" style={{ backgroundColor: brand.dangerLight, color: brand.danger }}>
              <AlertCircle size={14} className="flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2">
            {!mustChange && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="flex-1 px-4 py-2.5 text-sm font-medium tracking-wide rounded transition-all hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#fff', color: brand.text, border: `1px solid ${brand.border}` }}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 text-sm font-medium tracking-wide rounded transition-all hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: brand.navy, color: '#fff' }}
            >
              {submitting ? 'Saving…' : 'Set Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================
// REPORT OUTAGE
// ============================================================
const OUTAGE_TYPES = {
  electricity: { label: 'Electricity', icon: Zap, color: '#A86523', bg: '#F5E2CC' },
  water: { label: 'Water', icon: Droplets, color: '#1B4965', bg: '#E8EEF5' },
};

const OUTAGE_STATUSES = ['Active', 'Investigating', 'Restored'];

const OutagesSection = ({ outages, setOutages, properties, currentUser, showToast, logAction }) => {
  const canReport = hasPermission(currentUser, PERMISSIONS.REPORT_OUTAGES);

  const [filterType, setFilterType] = useState('All');
  const [filterStatus, setFilterStatus] = useState('Active');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const blankForm = {
    property: '',
    unit: '',
    outageType: 'electricity',
    severity: 'Medium',
    affectedUnits: '',
    startedAt: new Date().toISOString().slice(0, 16),
    estimatedRestoration: '',
    description: '',
    reporterName: currentUser ? fullName(currentUser) : '',
    reporterContact: currentUser?.phone || currentUser?.email || '',
  };

  const [form, setForm] = useState(blankForm);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const schema = {
    property: [validators.required],
    outageType: [validators.required],
    severity: [validators.required],
    startedAt: [validators.required],
    description: [(v) => !v || v.trim().length < 10 ? 'Please describe the outage in at least 10 characters' : ''],
    reporterName: [validators.required],
    reporterContact: [validators.required],
  };

  const handleField = (f, v) => {
    const next = { ...form, [f]: v };
    setForm(next);
    if (touched[f]) setErrors(validateForm(next, schema));
  };
  const handleBlur = (f) => {
    setTouched({ ...touched, [f]: true });
    setErrors(validateForm(form, schema));
  };

  const openCreate = () => {
    setForm(blankForm);
    setErrors({}); setTouched({});
    setModalOpen(true);
  };

  const handleSubmit = () => {
    const allTouched = Object.keys(schema).reduce((a, k) => ({ ...a, [k]: true }), {});
    setTouched(allTouched);
    const newErrors = validateForm(form, schema);
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      showToast('Please fix the errors before submitting', 'error');
      return;
    }
    const newId = Math.max(0, ...outages.map(o => o.id)) + 1;
    const newOutage = {
      ...form,
      id: newId,
      affectedUnits: form.affectedUnits ? Number(form.affectedUnits) : null,
      status: 'Active',
      reportedAt: new Date().toISOString(),
      restoredAt: '',
    };
    setOutages([newOutage, ...outages]);
    logAction && logAction(`Reported ${OUTAGE_TYPES[form.outageType].label.toLowerCase()} outage at ${form.property}`);
    showToast('Outage reported. Maintenance has been notified.', 'success');
    setModalOpen(false);
  };

  const updateStatus = (id, status) => {
    setOutages(outages.map(o => o.id === id ? {
      ...o,
      status,
      restoredAt: status === 'Restored' ? new Date().toISOString() : o.restoredAt,
    } : o));
    const o = outages.find(x => x.id === id);
    logAction && logAction(`Marked ${OUTAGE_TYPES[o?.outageType]?.label.toLowerCase()} outage at ${o?.property} as ${status}`);
    showToast(`Outage marked as ${status}`, 'success');
  };

  const activeCount = outages.filter(o => o.status !== 'Restored').length;
  const electricityCount = outages.filter(o => o.outageType === 'electricity' && o.status !== 'Restored').length;
  const waterCount = outages.filter(o => o.outageType === 'water' && o.status !== 'Restored').length;
  const restoredToday = outages.filter(o => {
    if (!o.restoredAt) return false;
    const d = new Date(o.restoredAt);
    const t = new Date();
    return d.toDateString() === t.toDateString();
  }).length;

  const filtered = outages.filter(o => {
    const matchesType = filterType === 'All' || o.outageType === filterType;
    const matchesStatus = filterStatus === 'All' || o.status === filterStatus;
    const matchesSearch = `${o.property} ${o.unit || ''} ${o.description} ${o.reporterName}`.toLowerCase().includes(search.toLowerCase());
    return matchesType && matchesStatus && matchesSearch;
  });

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Operations</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Report Outage</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Log electricity and water outages affecting a building so maintenance can respond.</p>
        </div>
        {canReport && <Button variant="primary" icon={Siren} onClick={openCreate}>Report Outage</Button>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Active Outages', value: activeCount, color: brand.danger, icon: AlertTriangle },
          { label: 'Electricity Open', value: electricityCount, color: OUTAGE_TYPES.electricity.color, icon: Zap },
          { label: 'Water Open', value: waterCount, color: OUTAGE_TYPES.water.color, icon: Droplets },
          { label: 'Restored Today', value: restoredToday, color: brand.success, icon: CheckCircle2 },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>{s.label}</p>
                <Icon size={14} style={{ color: s.color }} />
              </div>
              <p className="text-2xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{s.value}</p>
            </Card>
          );
        })}
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: brand.textMuted }} />
            <input
              type="text"
              placeholder="Search by building, description, or reporter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded outline-none"
              style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}` }}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {[
              { id: 'All', label: 'All Types' },
              { id: 'electricity', label: 'Electricity' },
              { id: 'water', label: 'Water' },
            ].map(t => (
              <button key={t.id} onClick={() => setFilterType(t.id)}
                className="px-3 py-1.5 text-xs font-medium rounded transition-all"
                style={{ backgroundColor: filterType === t.id ? brand.navy : 'transparent', color: filterType === t.id ? '#fff' : brand.text, border: `1px solid ${filterType === t.id ? brand.navy : brand.border}` }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            {['All', ...OUTAGE_STATUSES].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className="px-3 py-1.5 text-xs font-medium rounded transition-all"
                style={{ backgroundColor: filterStatus === s ? brand.gold : 'transparent', color: filterStatus === s ? '#fff' : brand.text, border: `1px solid ${filterStatus === s ? brand.gold : brand.border}` }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Siren}
            title="No outages to show"
            message={search || filterType !== 'All' || filterStatus !== 'Active' ? 'No outages match your filters.' : 'Nothing outstanding — every building has power and water.'}
            action={canReport && !search && filterType === 'All' && filterStatus === 'Active' && <Button variant="primary" icon={Siren} onClick={openCreate}>Report First Outage</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => {
            const typeMeta = OUTAGE_TYPES[o.outageType] || OUTAGE_TYPES.electricity;
            const TypeIcon = typeMeta.icon;
            const isActive = o.status !== 'Restored';
            return (
              <Card key={o.id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded" style={{ backgroundColor: typeMeta.bg, color: typeMeta.color }}>
                        <TypeIcon size={12} /> {typeMeta.label}
                      </span>
                      <StatusBadge status={o.severity} />
                      <StatusBadge status={o.status === 'Restored' ? 'Completed' : (o.status === 'Investigating' ? 'In Progress' : 'Flagged')} />
                      {isActive && <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded animate-pulse-soft" style={{ backgroundColor: brand.dangerLight, color: brand.danger }}>● Live</span>}
                    </div>
                    <h3 className="text-base font-semibold mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>
                      {o.property}{o.unit ? ` · ${o.unit}` : ''}
                    </h3>
                    <p className="text-sm mb-3" style={{ color: brand.text }}>{o.description}</p>
                    <div className="flex flex-wrap gap-4 text-xs" style={{ color: brand.textMuted }}>
                      <span><span className="font-medium">Started:</span> {o.startedAt ? new Date(o.startedAt).toLocaleString('en-ZA') : '—'}</span>
                      {o.estimatedRestoration && (
                        <span><span className="font-medium">ETA restore:</span> {new Date(o.estimatedRestoration).toLocaleString('en-ZA')}</span>
                      )}
                      {o.affectedUnits != null && (
                        <span><span className="font-medium">Units affected:</span> {o.affectedUnits}</span>
                      )}
                      <span><span className="font-medium">Reported by:</span> {o.reporterName} · {o.reporterContact}</span>
                      <span><span className="font-medium">Logged:</span> {timeAgo(o.reportedAt)}</span>
                      {o.restoredAt && (
                        <span><span className="font-medium">Restored:</span> {new Date(o.restoredAt).toLocaleString('en-ZA')}</span>
                      )}
                    </div>
                  </div>
                  {canReport && (
                    <div className="flex flex-col gap-1">
                      {o.status === 'Active' && (
                        <button onClick={() => updateStatus(o.id, 'Investigating')} className="text-xs px-2 py-1 rounded whitespace-nowrap" style={{ color: brand.warning, border: `1px solid ${brand.warning}` }}>Mark Investigating</button>
                      )}
                      {o.status !== 'Restored' && (
                        <button onClick={() => updateStatus(o.id, 'Restored')} className="text-xs px-2 py-1 rounded whitespace-nowrap" style={{ color: brand.success, border: `1px solid ${brand.success}` }}>Mark Restored</button>
                      )}
                      {o.status === 'Restored' && (
                        <button onClick={() => updateStatus(o.id, 'Active')} className="text-xs px-2 py-1 rounded whitespace-nowrap" style={{ color: brand.navy, border: `1px solid ${brand.border}` }}>Reopen</button>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Report a New Outage">
        <div className="mb-4 p-3 rounded flex items-start gap-2 text-xs" style={{ backgroundColor: brand.goldPale, color: brand.warning }}>
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <span>Use this form for active electricity or water outages affecting a building. Maintenance will be paged automatically.</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Field label="Building" required error={touched.property && errors.property}>
            <Select value={form.property} onChange={(e) => handleField('property', e.target.value)} onBlur={() => handleBlur('property')} error={touched.property && errors.property}>
              <option value="">Select building...</option>
              {properties.map(p => <option key={p.id} value={p.address}>{p.address}</option>)}
            </Select>
          </Field>
          <Field label="Unit / Area" hint="Leave blank if whole building affected">
            <Input value={form.unit} onChange={(e) => handleField('unit', e.target.value)} placeholder="e.g. Shop 4, Block B, Common Area" />
          </Field>
          <Field label="Outage Type" required>
            <Select value={form.outageType} onChange={(e) => handleField('outageType', e.target.value)}>
              <option value="electricity">Electricity</option>
              <option value="water">Water</option>
            </Select>
          </Field>
          <Field label="Severity" required>
            <Select value={form.severity} onChange={(e) => handleField('severity', e.target.value)}>
              <option>Low</option><option>Medium</option><option>High</option>
            </Select>
          </Field>
          <Field label="Started At" required error={touched.startedAt && errors.startedAt} hint="When the outage began">
            <Input type="datetime-local" value={form.startedAt} onChange={(e) => handleField('startedAt', e.target.value)} onBlur={() => handleBlur('startedAt')} error={touched.startedAt && errors.startedAt} />
          </Field>
          <Field label="Estimated Restoration" hint="Optional — leave blank if unknown">
            <Input type="datetime-local" value={form.estimatedRestoration} onChange={(e) => handleField('estimatedRestoration', e.target.value)} />
          </Field>
          <Field label="Units Affected" hint="Approximate count, optional">
            <Input type="number" min="0" value={form.affectedUnits} onChange={(e) => handleField('affectedUnits', e.target.value)} placeholder="e.g. 12" />
          </Field>
          <Field label="Reporter Name" required error={touched.reporterName && errors.reporterName}>
            <Input value={form.reporterName} onChange={(e) => handleField('reporterName', e.target.value)} onBlur={() => handleBlur('reporterName')} error={touched.reporterName && errors.reporterName} placeholder="Who is reporting this" />
          </Field>
        </div>
        <Field label="Reporter Contact" required error={touched.reporterContact && errors.reporterContact} hint="Phone or email for follow-up">
          <Input value={form.reporterContact} onChange={(e) => handleField('reporterContact', e.target.value)} onBlur={() => handleBlur('reporterContact')} error={touched.reporterContact && errors.reporterContact} placeholder="+27 82 555 0000 or name@example.co.za" />
        </Field>
        <Field label="What's happening?" required error={touched.description && errors.description} hint="Minimum 10 characters — include any safety concerns">
          <textarea
            value={form.description}
            onChange={(e) => handleField('description', e.target.value)}
            onBlur={() => handleBlur('description')}
            rows={4}
            className="w-full px-3 py-2 text-sm rounded outline-none transition-all resize-none"
            style={{ backgroundColor: '#fff', border: `1px solid ${touched.description && errors.description ? brand.danger : brand.border}`, color: brand.text }}
            placeholder="e.g. Full power loss across Block B since 14:20, generator not engaged. Lifts stuck on floor 3."
          />
        </Field>
        <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${brand.border}` }}>
          <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" icon={Siren} onClick={handleSubmit}>Submit Report</Button>
        </div>
      </Modal>
    </div>
  );
};

// ============================================================
// TENANCY ACTIVITY (Move-Ins / Move-Outs)
// ============================================================
// Property Inspect inspection type IDs (per their API docs):
//   2 = Check In / Move In
//   5 = Check Out / Move Out
//   6 = Inventory & Check In / Inventory & Move In
const PI_MOVE_IN_TYPE_IDS = new Set([2, 6]);
const PI_MOVE_OUT_TYPE_IDS = new Set([5]);
// Match local seed inspection.type strings too.
const LOCAL_MOVE_IN_TYPES = ['Move-in', 'Move In', 'Check-in', 'Check In', 'Inventory & Check In'];
const LOCAL_MOVE_OUT_TYPES = ['Move-out', 'Move Out', 'Check-out', 'Check Out'];

const TenancyActivitySection = ({ inspections, integrations, onNavigateToSettings }) => {
  const [days, setDays] = useState(90);
  const piImported = integrations?.propertyInspect?.importedInspections || [];
  const piConnected = !!integrations?.propertyInspect?.connected;

  // Unify both sources into one shape, tag direction (in/out), filter and sort.
  const unified = useMemo(() => {
    const out = [];

    // Local inspections — match on type string
    inspections.forEach((i) => {
      const t = String(i.type || '');
      const isIn = LOCAL_MOVE_IN_TYPES.some(x => t.toLowerCase() === x.toLowerCase());
      const isOut = LOCAL_MOVE_OUT_TYPES.some(x => t.toLowerCase() === x.toLowerCase());
      if (!isIn && !isOut) return;
      out.push({
        id: `local-${i.id}`,
        source: 'local',
        direction: isIn ? 'in' : 'out',
        property: i.property,
        unit: i.unit,
        date: i.scheduledDate,
        status: i.status,
        inspector: i.inspector,
        type: i.type,
      });
    });

    // PI imported inspections — match on type.id
    piImported.forEach((i) => {
      const id = i.typeId;
      const isIn = id != null && PI_MOVE_IN_TYPE_IDS.has(id);
      const isOut = id != null && PI_MOVE_OUT_TYPE_IDS.has(id);
      if (!isIn && !isOut) return;
      out.push({
        id: `pi-${i.id}`,
        source: 'propertyinspect',
        direction: isIn ? 'in' : 'out',
        property: i.property,
        unit: i.propertyRef,
        date: i.completedAt || i.submittedAt || i.conductDate,
        status: i.stateName,
        inspector: i.clerk,
        type: i.typeName,
        ref: i.ref,
        reportKey: i.reportKey,
      });
    });

    // Filter to last N days (use the date field; entries without a date pass through)
    const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
    return out
      .filter(x => !x.date || new Date(x.date).getTime() >= cutoff)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }, [inspections, piImported, days]);

  const moveIns = unified.filter(x => x.direction === 'in');
  const moveOuts = unified.filter(x => x.direction === 'out');

  const Row = ({ item }) => (
    <Card className="p-4 mb-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase rounded"
              style={{
                backgroundColor: item.direction === 'in' ? brand.successLight : brand.warningLight,
                color: item.direction === 'in' ? brand.success : brand.warning,
              }}
            >
              {item.direction === 'in' ? 'Entry' : 'Exit'}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: brand.cream, color: brand.navy }}>{item.type}</span>
            {item.status && <StatusBadge status={item.status} />}
            {item.source === 'propertyinspect' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: '#2D6A4F', color: '#fff' }}>PI</span>
            )}
          </div>
          <p className="text-sm font-semibold truncate" style={{ color: brand.navy, fontFamily: 'Georgia, serif' }}>
            {item.property}{item.unit ? ` · ${item.unit}` : ''}
          </p>
          <div className="flex flex-wrap gap-3 text-xs mt-1" style={{ color: brand.textMuted }}>
            {item.date && <span>{formatDate(item.date)}</span>}
            {item.inspector && <span>· {item.inspector}</span>}
            {item.ref && <span>· Ref: {item.ref}</span>}
          </div>
        </div>
      </div>
    </Card>
  );

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Tenancy</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Entries & Exits</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Units that have recently entered or exited a tenancy, drawn from inspections in this app and from Property Inspect.</p>
        </div>
        <div className="flex gap-2">
          {[30, 90, 180, 0].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className="px-3 py-1.5 text-xs font-medium rounded transition-all"
              style={{
                backgroundColor: days === d ? brand.navy : 'transparent',
                color: days === d ? '#fff' : brand.text,
                border: `1px solid ${days === d ? brand.navy : brand.border}`,
              }}
            >
              {d === 0 ? 'All time' : `Last ${d} days`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>Entries</p>
            <CheckCircle2 size={14} style={{ color: brand.success }} />
          </div>
          <p className="text-2xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{moveIns.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>Exits</p>
            <Undo2 size={14} style={{ color: brand.warning }} />
          </div>
          <p className="text-2xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{moveOuts.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs tracking-wider uppercase" style={{ color: brand.textMuted }}>From Property Inspect</p>
            <ClipboardCheck size={14} style={{ color: '#2D6A4F' }} />
          </div>
          <p className="text-2xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>{unified.filter(x => x.source === 'propertyinspect').length}</p>
          {!piConnected && (
            <button onClick={onNavigateToSettings} className="text-xs mt-1 underline" style={{ color: brand.gold }}>
              Connect Property Inspect
            </button>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>
            <CheckCircle2 size={16} style={{ color: brand.success }} />
            Recent Entries
          </h2>
          {moveIns.length === 0 ? (
            <Card><EmptyState icon={Home} title="No recent entries" message="Nothing matches the selected timeframe." /></Card>
          ) : (
            moveIns.map(item => <Row key={item.id} item={item} />)
          )}
        </div>
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>
            <Undo2 size={16} style={{ color: brand.warning }} />
            Recent Exits
          </h2>
          {moveOuts.length === 0 ? (
            <Card><EmptyState icon={Home} title="No recent exits" message="Nothing matches the selected timeframe." /></Card>
          ) : (
            moveOuts.map(item => <Row key={item.id} item={item} />)
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// INCOME PROJECTIONS
// Import an MRI Property Central Rent Roll export (xlsx/csv),
// parse tenant + monthly rent + lease end + escalation, and project
// future monthly income forward with escalation curves applied.
// ============================================================
// Map common header names from MRI exports to our internal keys. MRI
// exports vary slightly between accounts and report versions; this list
// catches the common variants so any reasonable Rent Roll dump works.
const MRI_RENT_ROLL_HEADER_MAP = {
  tenant: ['tenant', 'tenant name', 'tenantname', 'customer', 'lessee'],
  property: ['property', 'building', 'property name', 'propertyname', 'building name'],
  unit: ['unit', 'suite', 'unit number', 'unitnumber', 'suite number'],
  monthlyRent: ['monthly rent', 'monthlyrent', 'rent', 'gross rent', 'grossrent', 'base rent', 'baserent', 'rental', 'monthly rental'],
  leaseStart: ['lease start', 'leasestart', 'start date', 'startdate', 'commencement', 'lease commencement', 'commencementdate'],
  leaseEnd: ['lease end', 'leaseend', 'end date', 'enddate', 'termination', 'lease termination', 'expiry', 'expiry date', 'lease expiry'],
  escalation: ['escalation', 'escalation %', 'escalation rate', 'escalationrate', 'escalation pct', 'annual increase', 'increase %'],
  status: ['status', 'lease status', 'leasestatus', 'state', 'active'],
};

const normalizeHeader = (h) => String(h || '').toLowerCase().replace(/[\s_\-./]+/g, '').trim();

const matchHeader = (header, candidates) => {
  const n = normalizeHeader(header);
  return candidates.some(c => normalizeHeader(c) === n);
};

// Parse a Rent Roll workbook into normalized lease records.
const parseRentRoll = (rows) => {
  if (!rows || rows.length === 0) return [];
  // First row is headers
  const headers = rows[0].map(h => String(h || ''));
  const colIndex = {};
  Object.entries(MRI_RENT_ROLL_HEADER_MAP).forEach(([key, candidates]) => {
    const idx = headers.findIndex(h => matchHeader(h, candidates));
    if (idx >= 0) colIndex[key] = idx;
  });

  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => c === null || c === undefined || String(c).trim() === '')) continue;

    const get = (key) => colIndex[key] !== undefined ? row[colIndex[key]] : null;
    const parseNum = (v) => {
      if (v == null) return null;
      const s = String(v).replace(/[^\d.\-]/g, '');
      const n = parseFloat(s);
      return isFinite(n) ? n : null;
    };
    const parseDate = (v) => {
      if (!v) return null;
      // Excel serial date (number of days since 1900-01-01)
      if (typeof v === 'number' && v > 1000 && v < 100000) {
        const epoch = new Date(Date.UTC(1899, 11, 30));
        return new Date(epoch.getTime() + v * 86400000);
      }
      const d = new Date(v);
      return isFinite(d.getTime()) ? d : null;
    };

    const tenant = get('tenant');
    const monthlyRent = parseNum(get('monthlyRent'));
    if (!tenant || !monthlyRent) continue; // skip header echoes / totals rows

    records.push({
      tenant: String(tenant).trim(),
      property: String(get('property') || 'Unknown Property').trim(),
      unit: String(get('unit') || '').trim(),
      monthlyRent,
      leaseStart: parseDate(get('leaseStart')),
      leaseEnd: parseDate(get('leaseEnd')),
      escalation: parseNum(get('escalation')) ?? 0,
      status: String(get('status') || 'Active').trim(),
    });
  }
  return records;
};

// Project a single tenant's monthly income across N months from a start date,
// applying escalation on each anniversary of leaseStart. Returns array of
// { month: 'YYYY-MM', rent: number }.
const projectTenantIncome = (record, startMonth, months) => {
  if (!record || !record.monthlyRent) return [];
  const out = [];
  const escalationPct = (record.escalation || 0) / 100;
  for (let i = 0; i < months; i++) {
    const cursor = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
    // Lease bounds
    if (record.leaseEnd && cursor > record.leaseEnd) {
      out.push({ month: cursor, rent: 0 });
      continue;
    }
    if (record.leaseStart && cursor < new Date(record.leaseStart.getFullYear(), record.leaseStart.getMonth(), 1)) {
      out.push({ month: cursor, rent: 0 });
      continue;
    }
    // Apply escalation: anniversaries from leaseStart
    let yearsElapsed = 0;
    if (record.leaseStart) {
      yearsElapsed = cursor.getFullYear() - record.leaseStart.getFullYear();
      if (cursor.getMonth() < record.leaseStart.getMonth()) yearsElapsed -= 1;
      yearsElapsed = Math.max(0, yearsElapsed);
    }
    const escalated = record.monthlyRent * Math.pow(1 + escalationPct, yearsElapsed);
    out.push({ month: cursor, rent: escalated });
  }
  return out;
};

const ProjectionsSection = ({ showToast, logAction }) => {
  const [rentRoll, setRentRoll] = useStoredState('ep:rentRoll', []);
  const [importedAt, setImportedAt] = useStoredState('ep:rentRollImportedAt', null);
  const [horizonMonths, setHorizonMonths] = useState(12);
  const [parsing, setParsing] = useState(false);
  const [importError, setImportError] = useState(null);
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setParsing(true);
    setImportError(null);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: false });
      // Use the first sheet (MRI typically dumps to "Rent Roll" or "Sheet1")
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      const records = parseRentRoll(rows);
      if (records.length === 0) {
        throw new Error(`No tenant rows found. Expected columns: Tenant, Property, Unit, Monthly Rent, Lease Start, Lease End, Escalation %. Found headers: ${(rows[0] || []).join(', ').slice(0, 200)}`);
      }
      // Strip Date objects before storing — localStorage can't hold them as Date.
      const serialized = records.map(r => ({
        ...r,
        leaseStart: r.leaseStart ? r.leaseStart.toISOString() : null,
        leaseEnd: r.leaseEnd ? r.leaseEnd.toISOString() : null,
      }));
      setRentRoll(serialized);
      setImportedAt(new Date().toISOString());
      logAction(`Imported ${records.length} tenants from MRI Rent Roll (${file.name})`);
      showToast(`Imported ${records.length} tenants from ${file.name}`, 'success');
    } catch (err) {
      setImportError(err.message);
      showToast('Import failed: ' + err.message, 'error');
    } finally {
      setParsing(false);
    }
  };

  // Re-hydrate dates from ISO strings before projecting.
  const hydrated = useMemo(() => rentRoll.map(r => ({
    ...r,
    leaseStart: r.leaseStart ? new Date(r.leaseStart) : null,
    leaseEnd: r.leaseEnd ? new Date(r.leaseEnd) : null,
  })), [rentRoll]);

  const activeOnly = useMemo(() => hydrated.filter(r => !/inactive|terminated|expired/i.test(r.status)), [hydrated]);

  // Project income over the chosen horizon, grouped by month.
  const projection = useMemo(() => {
    if (activeOnly.length === 0) return { byMonth: [], byProperty: [], totalAnnual: 0 };
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const perTenant = activeOnly.map(r => ({
      record: r,
      months: projectTenantIncome(r, start, horizonMonths),
    }));
    // Aggregate by month
    const monthMap = new Map();
    perTenant.forEach(({ record, months }) => {
      months.forEach(({ month, rent }) => {
        const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap.has(key)) {
          monthMap.set(key, { month: key, monthDate: month, total: 0, byProp: {} });
        }
        const entry = monthMap.get(key);
        entry.total += rent;
        entry.byProp[record.property] = (entry.byProp[record.property] || 0) + rent;
      });
    });
    const byMonth = Array.from(monthMap.values()).sort((a, b) => a.monthDate - b.monthDate);
    const properties = Array.from(new Set(activeOnly.map(r => r.property))).sort();
    // Aggregate by property: total over horizon
    const byProperty = properties.map(p => {
      const tenantsForProp = activeOnly.filter(r => r.property === p);
      const totalForProp = byMonth.reduce((sum, m) => sum + (m.byProp[p] || 0), 0);
      return { property: p, tenants: tenantsForProp.length, total: totalForProp };
    }).sort((a, b) => b.total - a.total);
    const totalAnnual = byMonth.reduce((s, m) => s + m.total, 0) * (12 / horizonMonths);
    return { byMonth, byProperty, totalAnnual, properties };
  }, [activeOnly, horizonMonths]);

  const fmtR = (n) => `R ${Math.round(n).toLocaleString('en-ZA')}`;

  // Friendly month label for charts (e.g. "Jun '26")
  const formatMonthLabel = (m) => {
    const d = new Date(m + '-01');
    return d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' });
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Finance</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Income Projections</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Project monthly rental income forward using a Rent Roll export from MRI Property Central.</p>
        </div>
        <div className="flex gap-2">
          {[12, 24, 36, 60].map(m => (
            <button key={m} onClick={() => setHorizonMonths(m)} className="px-3 py-1.5 text-xs font-medium rounded transition-all"
              style={{
                backgroundColor: horizonMonths === m ? brand.navy : 'transparent',
                color: horizonMonths === m ? '#fff' : brand.text,
                border: `1px solid ${horizonMonths === m ? brand.navy : brand.border}`,
              }}>{m} months</button>
          ))}
        </div>
      </div>

      {/* Import card */}
      <Card className="p-5 mb-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold mb-1" style={{ color: brand.navy }}>Import Rent Roll</h3>
            <p className="text-xs mb-3" style={{ color: brand.textMuted }}>
              In MRI Property Central, export the <strong>Rent Roll</strong> report as Excel (.xlsx) or CSV.
              The importer auto-detects columns like Tenant, Property, Unit, Monthly Rent, Lease Start, Lease End, and Escalation %.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="primary" icon={Upload} onClick={() => fileInputRef.current?.click()} disabled={parsing}>
                {parsing ? 'Parsing…' : 'Choose Rent Roll file'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
              />
              {rentRoll.length > 0 && (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => { setRentRoll([]); setImportedAt(null); showToast('Rent roll cleared', 'success'); }}>
                  Clear
                </Button>
              )}
              {importedAt && (
                <span className="text-xs" style={{ color: brand.textMuted }}>
                  Last import: {timeAgo(importedAt)} · {rentRoll.length} tenants
                </span>
              )}
            </div>
            {importError && (
              <div className="mt-3 p-2 rounded text-xs flex items-start gap-2" style={{ backgroundColor: brand.dangerLight, color: brand.danger }}>
                <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}
          </div>
        </div>
      </Card>

      {rentRoll.length === 0 ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title="No rent roll imported yet"
            message="Drop an MRI Property Central Rent Roll export above and we'll project your income forward."
          />
        </Card>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            {[
              { label: `Projected income (next ${horizonMonths}mo)`, value: fmtR(projection.byMonth.reduce((s, m) => s + m.total, 0)), color: brand.success },
              { label: 'Estimated annual run-rate', value: fmtR(projection.totalAnnual), color: brand.navy },
              { label: 'Active tenants', value: activeOnly.length, color: brand.gold },
              { label: 'Properties', value: projection.properties?.length || 0, color: brand.warning },
            ].map((s, i) => (
              <Card key={i} className="p-4">
                <p className="text-xs tracking-wider uppercase mb-2" style={{ color: brand.textMuted }}>{s.label}</p>
                <p className="text-2xl font-semibold" style={{ fontFamily: 'Georgia, serif', color: s.color }}>{s.value}</p>
              </Card>
            ))}
          </div>

          {/* Monthly income line chart */}
          <Card className="p-5 mb-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: brand.navy }}>Projected monthly income</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={projection.byMonth.map(m => ({ name: formatMonthLabel(m.month), total: Math.round(m.total) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={brand.border} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: brand.textMuted }} />
                <YAxis tick={{ fontSize: 11, fill: brand.textMuted }} tickFormatter={(v) => `R${Math.round(v / 1000)}k`} />
                <RTooltip
                  formatter={(v) => fmtR(v)}
                  contentStyle={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, borderRadius: 4, fontSize: 12 }}
                />
                <Bar dataKey="total" fill={brand.gold} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Income by property */}
          <Card className="p-5 mb-4">
            <h3 className="text-sm font-semibold mb-3" style={{ color: brand.navy }}>Projected income by property ({horizonMonths} months)</h3>
            <ResponsiveContainer width="100%" height={Math.max(200, projection.byProperty.length * 36 + 40)}>
              <BarChart layout="vertical" data={projection.byProperty.map(p => ({ name: p.property, total: Math.round(p.total), tenants: p.tenants }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={brand.border} />
                <XAxis type="number" tick={{ fontSize: 11, fill: brand.textMuted }} tickFormatter={(v) => `R${Math.round(v / 1000)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: brand.text }} width={180} />
                <RTooltip
                  formatter={(v, k) => k === 'total' ? fmtR(v) : v}
                  contentStyle={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, borderRadius: 4, fontSize: 12 }}
                />
                <Bar dataKey="total" fill={brand.navy} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Tenant table */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-3" style={{ color: brand.navy }}>Tenants from rent roll</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${brand.border}` }}>
                    <th className="text-left py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>Tenant</th>
                    <th className="text-left py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>Property · Unit</th>
                    <th className="text-right py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>Monthly Rent</th>
                    <th className="text-right py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>Escalation</th>
                    <th className="text-left py-2 text-xs font-medium tracking-wider uppercase" style={{ color: brand.textMuted }}>Lease end</th>
                  </tr>
                </thead>
                <tbody>
                  {hydrated.slice(0, 50).map((r, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${brand.border}` }}>
                      <td className="py-2 text-xs">{r.tenant}</td>
                      <td className="py-2 text-xs" style={{ color: brand.textMuted }}>{r.property}{r.unit ? ` · ${r.unit}` : ''}</td>
                      <td className="py-2 text-xs text-right">{fmtR(r.monthlyRent)}</td>
                      <td className="py-2 text-xs text-right">{r.escalation}%</td>
                      <td className="py-2 text-xs" style={{ color: brand.textMuted }}>{r.leaseEnd ? formatDate(r.leaseEnd) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hydrated.length > 50 && (
                <p className="text-xs mt-2 text-center" style={{ color: brand.textMuted }}>Showing first 50 of {hydrated.length} tenants</p>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

// ============================================================
// LEASE LEARNER
// User pastes / uploads Word lease templates. Uses the connected Claude
// API to extract patterns (standard clauses, escalation defaults, deposit
// formulas, etc.) and saves them as "learned patterns" for reference when
// drafting future leases.
// ============================================================
const LeaseLearnerSection = ({ integrations, showToast, logAction, onNavigateToSettings, onNavigateToLeasing }) => {
  const [patterns, setPatterns] = useStoredState('ep:learnedPatterns', []);
  const [pastedText, setPastedText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const fileInputRef = useRef(null);

  const anthropicCfg = integrations?.anthropic || {};
  // API key lives in the server vault — query it to decide if AI is available.
  const [anthropicHasKey, setAnthropicHasKey] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.secrets.get('anthropic')
      .then(rows => { if (!cancelled) setAnthropicHasKey(!!rows.find(r => r.key === 'apiKey' && r.hasValue)); })
      .catch(() => { if (!cancelled) setAnthropicHasKey(false); });
    return () => { cancelled = true; };
  }, []);
  const aiReady = anthropicHasKey;

  // Extract plain text from a .docx file by reading word/document.xml.
  // No external service, purely local.
  const extractDocxText = async (file) => {
    const PizZipMod = await import('pizzip');
    const PizZip = PizZipMod.default || PizZipMod;
    const buf = await file.arrayBuffer();
    const zip = new PizZip(buf);
    const xml = zip.file('word/document.xml')?.asText() || '';
    // Strip XML tags and decode common entities. Preserves paragraph breaks.
    return xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (!/\.(docx?)$/i.test(file.name)) {
      showToast('Only Word documents (.docx) are supported. .doc may not parse — convert first.', 'error');
      return;
    }
    setUploadedFileName(file.name);
    try {
      const text = await extractDocxText(file);
      setPastedText(text);
      showToast(`Extracted ${text.length.toLocaleString()} chars from ${file.name}`, 'success');
    } catch (err) {
      showToast('Could not parse Word file: ' + err.message, 'error');
    }
  };

  const handleAnalyze = async () => {
    if (!aiReady) {
      showToast('Configure your Anthropic API key in Settings → Integrations first', 'error');
      onNavigateToSettings?.();
      return;
    }
    if (!pastedText || pastedText.trim().length < 50) {
      showToast('Paste at least a paragraph of lease text first', 'error');
      return;
    }
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const systemPrompt = `You are analyzing a commercial property lease agreement template to extract reusable patterns for an automated lease-drafting system in South Africa.

Extract structured JSON with this exact shape:
{
  "summary": "1-2 sentence description of what makes this template distinctive",
  "clauses": [
    { "name": "short name", "category": "rent|deposit|termination|sureties|maintenance|insurance|operating-costs|escalation|use|access|default|other", "snippet": "<200 char distinctive excerpt" }
  ],
  "defaults": {
    "escalationPercent": number | null,
    "depositMonths": number | null,
    "noticeMonths": number | null,
    "leaseYears": number | null,
    "vatRate": number | null
  },
  "vocabulary": ["distinctive terms/phrases this template uses, max 10"],
  "warnings": ["any unusual clauses or risks worth flagging, max 5"]
}

Return ONLY valid JSON. No prose before or after.`;
      const res = await api.proxy.anthropicMessages({
        model: anthropicCfg.model || 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: pastedText.slice(0, 60000) }],
      });
      const raw = (res.content?.[0]?.text || '').trim();
      // Tolerate markdown code fences
      const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        throw new Error(`Claude returned non-JSON: ${raw.slice(0, 200)}`);
      }
      const newPattern = {
        id: `p-${Date.now()}`,
        source: uploadedFileName || 'Pasted text',
        analyzedAt: new Date().toISOString(),
        textLength: pastedText.length,
        ...parsed,
      };
      setPatterns([newPattern, ...patterns].slice(0, 50));
      logAction(`Learned lease pattern from ${newPattern.source} (${(parsed.clauses || []).length} clauses)`);
      showToast(`Learned ${(parsed.clauses || []).length} clauses from ${newPattern.source}`, 'success');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Lease Learner] failed:', err);
      setAnalysisError(err.message);
      showToast('Analysis failed: ' + err.message, 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const removePattern = (id) => {
    setPatterns(patterns.filter(p => p.id !== id));
    showToast('Pattern removed', 'success');
  };

  // Aggregate the learned defaults across all patterns — useful as drafting hints.
  const aggregatedDefaults = useMemo(() => {
    const collect = (key) => patterns.map(p => p.defaults?.[key]).filter(v => v != null && isFinite(v));
    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    return {
      escalationPercent: avg(collect('escalationPercent')),
      depositMonths: avg(collect('depositMonths')),
      noticeMonths: avg(collect('noticeMonths')),
      leaseYears: avg(collect('leaseYears')),
      vatRate: avg(collect('vatRate')),
    };
  }, [patterns]);

  return (
    <div>
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase mb-2" style={{ color: brand.gold }}>Operations · AI-assisted</p>
          <h1 className="text-3xl mb-1" style={{ fontFamily: 'Georgia, serif', color: brand.navy, fontWeight: 600 }}>Lease Learner</h1>
          <p className="text-sm" style={{ color: brand.textMuted }}>Feed in existing Word lease templates and Claude extracts the patterns. Learned patterns inform future drafts.</p>
        </div>
        <Button variant="ghost" icon={FileSignature} onClick={onNavigateToLeasing}>Open Lease Drafter</Button>
      </div>

      {!aiReady && (
        <Card className="p-4 mb-4" style={{ backgroundColor: brand.warningLight, borderColor: brand.warning }}>
          <div className="flex items-start gap-2 text-xs" style={{ color: brand.warning }}>
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p><strong>Claude API isn't configured.</strong> The Lease Learner needs the Anthropic integration to read templates.</p>
              <button onClick={onNavigateToSettings} className="underline mt-1" style={{ color: brand.warning }}>Open Settings → Integrations</button>
            </div>
          </div>
        </Card>
      )}

      {/* Input card */}
      <Card className="p-5 mb-4">
        <h3 className="text-sm font-semibold mb-2" style={{ color: brand.navy }}>Add a template to learn from</h3>
        <p className="text-xs mb-3" style={{ color: brand.textMuted }}>Upload a Word .docx file or paste lease text directly. The system extracts clauses, defaults, and unusual terms.</p>

        <div className="flex gap-2 mb-3 flex-wrap">
          <Button size="sm" variant="ghost" icon={Upload} onClick={() => fileInputRef.current?.click()} disabled={analyzing}>
            Upload .docx
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
          />
          {uploadedFileName && (
            <span className="text-xs flex items-center gap-1" style={{ color: brand.textMuted }}>
              <FileCheck size={12} /> {uploadedFileName}
            </span>
          )}
        </div>

        <textarea
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          rows={10}
          placeholder="…or paste lease text here. Aim for a representative section: rental clauses, escalation, deposit, termination."
          className="w-full px-3 py-2 text-sm rounded outline-none transition-all resize-y"
          style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, color: brand.text, fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.5 }}
        />

        <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
          <p className="text-xs" style={{ color: brand.textMuted }}>{pastedText.length.toLocaleString()} chars{pastedText.length > 60000 ? ' (will be truncated to 60K for analysis)' : ''}</p>
          <Button variant="primary" icon={analyzing ? RefreshCw : Sparkles} onClick={handleAnalyze} disabled={analyzing || !aiReady || pastedText.trim().length < 50}>
            {analyzing ? 'Analyzing with Claude…' : 'Learn from this template'}
          </Button>
        </div>

        {analysisError && (
          <div className="mt-3 p-2 rounded text-xs flex items-start gap-2" style={{ backgroundColor: brand.dangerLight, color: brand.danger }}>
            <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{analysisError}</span>
          </div>
        )}
      </Card>

      {/* Aggregated defaults */}
      {patterns.length > 0 && (
        <Card className="p-5 mb-4">
          <h3 className="text-sm font-semibold mb-2" style={{ color: brand.navy }}>Learned defaults (averaged across {patterns.length} template{patterns.length === 1 ? '' : 's'})</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Escalation %', value: aggregatedDefaults.escalationPercent, suffix: '%' },
              { label: 'Deposit (months)', value: aggregatedDefaults.depositMonths, suffix: ' mo' },
              { label: 'Notice (months)', value: aggregatedDefaults.noticeMonths, suffix: ' mo' },
              { label: 'Lease term (years)', value: aggregatedDefaults.leaseYears, suffix: ' yr' },
              { label: 'VAT %', value: aggregatedDefaults.vatRate, suffix: '%' },
            ].map((d, i) => (
              <div key={i} className="p-2 rounded text-center" style={{ backgroundColor: brand.cream }}>
                <p className="text-[10px] tracking-wider uppercase" style={{ color: brand.textMuted }}>{d.label}</p>
                <p className="text-base font-semibold" style={{ fontFamily: 'Georgia, serif', color: brand.navy }}>
                  {d.value != null ? `${(Math.round(d.value * 10) / 10)}${d.suffix}` : '—'}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Learned patterns list */}
      {patterns.length === 0 ? (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="No patterns learned yet"
            message="Upload your first lease template above to get started."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {patterns.map(p => (
            <Card key={p.id} className="p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: brand.navy }}>{p.source}</p>
                  <p className="text-xs mt-0.5" style={{ color: brand.textMuted }}>
                    Learned {timeAgo(p.analyzedAt)} · {(p.clauses || []).length} clauses · {(p.warnings || []).length} warnings
                  </p>
                  {p.summary && <p className="text-xs mt-2" style={{ color: brand.text }}>{p.summary}</p>}
                </div>
                <button onClick={() => removePattern(p.id)} className="text-xs px-2 py-1 rounded" style={{ color: brand.danger, border: `1px solid ${brand.dangerLight}` }}>
                  Remove
                </button>
              </div>

              {p.clauses && p.clauses.length > 0 && (
                <div className="mb-2">
                  <p className="text-[10px] tracking-wider uppercase mb-1.5" style={{ color: brand.textMuted }}>Clauses</p>
                  <div className="flex flex-wrap gap-1">
                    {p.clauses.map((c, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: brand.cream, color: brand.navy, border: `1px solid ${brand.border}` }} title={c.snippet || ''}>
                        {c.name}{c.category ? ` · ${c.category}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {p.warnings && p.warnings.length > 0 && (
                <div className="mt-2 p-2 rounded text-xs" style={{ backgroundColor: brand.warningLight, color: brand.warning }}>
                  <strong>Notes from Claude:</strong>
                  <ul className="list-disc ml-5 mt-1">
                    {p.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {p.vocabulary && p.vocabulary.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] tracking-wider uppercase mb-1" style={{ color: brand.textMuted }}>Distinctive terms</p>
                  <p className="text-xs" style={{ color: brand.text }}>{p.vocabulary.join(' · ')}</p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// MAIN APP
// ============================================================
export default function ExceedProperties() {
  // Persisted across refreshes so the user stays on whatever page they were on.
  const [activeNav, setActiveNav] = useStoredState('ep:activeNav', 'dashboard');

  // Persistent state — all auto-saved to window.storage so data survives refresh
  const [employees, setEmployees] = useStoredState('ep:employees', seedEmployees);
  const [properties, setProperties] = useStoredState('ep:properties', seedProperties);
  const [inspections, setInspections] = useStoredState('ep:inspections', seedInspections);
  const [leases, setLeases] = useStoredState('ep:leases', seedLeases);
  const [debtors, setDebtors] = useStoredState('ep:debtors', seedDebtors);
  const [tenancies, setTenancies] = useStoredState('ep:tenancies', []);
  // Persistent collections workflow state — keyed by MDA account number so
  // assignments / notes / status survive across monthly debtor imports.
  const [debtorAccounts, setDebtorAccounts] = useStoredState('ep:debtorAccounts', {});
  const [debtorNotes, setDebtorNotes] = useStoredState('ep:debtorNotes', {});
  const [maintenance, setMaintenance] = useStoredState('ep:maintenance', seedMaintenance);
  const [outages, setOutages] = useStoredState('ep:outages', []);
  const [deskStatuses, setDeskStatuses] = useStoredState('ep:deskStatuses', seedDeskStatuses);
  const [activityLog, setActivityLog] = useStoredState('ep:activityLog', seedActivityLog);
  const [timeEntries] = useState(seedTimeEntries);
  const [companyProfile, setCompanyProfile] = useStoredState('ep:companyProfile', defaultCompanyProfile);
  const [departments, setDepartments] = useStoredState('ep:departments', defaultDepartments);
  const [notificationPrefs, setNotificationPrefs] = useStoredState('ep:notificationPrefs', defaultNotificationPrefs);
  const [integrations, setIntegrations] = useStoredState('ep:integrations', defaultIntegrations);
  const [security, setSecurity] = useStoredState('ep:security', defaultSecurity);
  const [auditLog, setAuditLog] = useStoredState('ep:auditLog', []);
  const [notifications, setNotifications] = useStoredState('ep:notifications', seedNotifications);
  // Auth session is owned by the backend (httpOnly cookie). We mirror
  // the current user into React state by calling /api/auth/me on mount
  // and after login/logout. We never store passwords or session data
  // in localStorage anymore.
  const [authUser, setAuthUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await api.auth.me();
        if (!cancelled) setAuthUser(user);
      } catch { /* unauthenticated */ }
      finally { if (!cancelled) setAuthChecked(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Match the backend user against the local employee record so the
  // role-based permission system keeps working off the same data
  // (DEPARTMENTS_CONFIG, ROLES, hasPermission) that it has always used.
  const currentUser = useMemo(() => {
    if (!authUser) return null;
    const emp = employees.find(e => e.email?.toLowerCase() === authUser.email.toLowerCase()) || null;
    // Merge: the backend is the source of truth for identity (email, role).
    // The employee record carries operational data (department, team, etc.).
    return {
      ...(emp || {}),
      id: emp?.id ?? -1,
      email: authUser.email,
      firstName: authUser.firstName || emp?.firstName || '',
      lastName: authUser.lastName || emp?.lastName || '',
      systemAccess: true,
      systemRole: authUser.role || emp?.systemRole || 'readonly',
      lastLogin: authUser.lastLogin || emp?.lastLogin,
    };
  }, [authUser, employees]);

  const setCurrentUser = useCallback((user) => {
    setAuthUser(prev => ({ ...(prev || {}), ...user }));
  }, []);

  const handleLogout = useCallback(async () => {
    try { await api.auth.logout(); } catch { /* ignore */ }
    setAuthUser(null);
  }, []);

  const mustChangePassword = !!authUser?.mustChangePassword;

  // Ephemeral UI state
  const [toast, setToast] = useState({ message: '', type: 'success' });
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  // Mobile drawer for the sidebar. md:+ ignores this and keeps the sidebar
  // permanently visible; phones get a slide-in drawer triggered by the
  // hamburger button in the top bar.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: '', type }), 3500);
  }, []);

  const logAction = useCallback((action) => {
    setAuditLog((prev) => [
      { id: Date.now() + Math.random(), action, user: `${currentUser?.firstName} ${currentUser?.lastName}` || 'Unknown', timestamp: new Date().toISOString() },
      ...prev,
    ].slice(0, 200));
  }, [setAuditLog, currentUser]);

  // Property Inspect OAuth callback handler. PI redirects back to
  // {redirectUri}?code=...&state=... after the user approves access. We
  // detect this on mount, validate state for CSRF, exchange the code for
  // tokens, and persist them. Then we land the user on Settings → Integrations.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const isPICallback = url.pathname === '/oauth/pi-callback' || (code && state && sessionStorage.getItem('ep:pi-oauth-pending'));
    if (!isPICallback) return;

    const cleanUrl = () => {
      window.history.replaceState({}, document.title, window.location.origin + '/');
    };

    let pending = null;
    try {
      const raw = sessionStorage.getItem('ep:pi-oauth-pending');
      pending = raw ? JSON.parse(raw) : null;
    } catch { /* ignore */ }

    if (error) {
      const errDesc = url.searchParams.get('error_description') || '';
      const msg = error === 'invalid_scope'
        ? `Property Inspect rejected the requested scope. ${errDesc} — try a different value in the Scope field.`
        : `Property Inspect connection cancelled: ${error}${errDesc ? ' — ' + errDesc : ''}`;
      showToast(msg, 'error');
      setIntegrations(prev => ({
        ...prev,
        propertyInspect: {
          ...(prev.propertyInspect || {}),
          lastSync: new Date().toISOString(),
          lastSyncStatus: 'error',
          lastSyncError: `OAuth ${error}: ${errDesc || '(no description)'}`,
        },
      }));
      sessionStorage.removeItem('ep:pi-oauth-pending');
      cleanUrl();
      setActiveNav('settings');
      return;
    }
    if (!code || !pending) {
      showToast('Property Inspect callback was missing data — please try Connect again.', 'error');
      sessionStorage.removeItem('ep:pi-oauth-pending');
      cleanUrl();
      return;
    }
    if (state !== pending.state) {
      showToast('Property Inspect OAuth state mismatch — possible CSRF. Aborted.', 'error');
      sessionStorage.removeItem('ep:pi-oauth-pending');
      cleanUrl();
      return;
    }

    (async () => {
      try {
        // Exchange the code through our backend, not the browser. Property
        // Inspect's token endpoint doesn't accept browser-origin CORS, and
        // even if it did, the client_secret has no business being in the
        // SPA — it's already stored in the server vault from the Save step.
        await api.proxy.piExchangeCode(code);
        setIntegrations(prev => ({
          ...prev,
          propertyInspect: {
            ...(prev.propertyInspect || {}),
            clientId: pending.clientId,
            clientSecret: pending.clientSecret,
            tokenUrl: pending.tokenUrl,
            redirectUri: pending.redirectUri,
            baseUrl: pending.baseUrl,
            connected: true,
            lastSync: new Date().toISOString(),
            lastSyncStatus: 'success',
            lastSyncError: null,
          },
        }));
        logAction('Connected to Property Inspect via OAuth (read-only)');
        showToast('Connected to Property Inspect', 'success');
      } catch (err) {
        setIntegrations(prev => ({
          ...prev,
          propertyInspect: {
            ...(prev.propertyInspect || {}),
            connected: false,
            lastSync: new Date().toISOString(),
            lastSyncStatus: 'error',
            lastSyncError: err.message,
          },
        }));
        showToast('Property Inspect connection failed: ' + err.message, 'error');
      } finally {
        sessionStorage.removeItem('ep:pi-oauth-pending');
        cleanUrl();
        setActiveNav('settings');
      }
    })();
    // Run exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // DocuSign OAuth callback handler. Mirrors the PI handler. Triggered when
  // the browser is redirected back to /oauth/docusign-callback after the user
  // approves the app on DocuSign. Exchanges code → tokens, fetches userInfo
  // to auto-detect accountId + base_uri, persists everything.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const isDSCallback = url.pathname === '/oauth/docusign-callback' || (code && state && sessionStorage.getItem('ep:ds-oauth-pending'));
    if (!isDSCallback) return;

    const cleanUrl = () => {
      window.history.replaceState({}, document.title, window.location.origin + '/');
    };

    let pending = null;
    try {
      const raw = sessionStorage.getItem('ep:ds-oauth-pending');
      pending = raw ? JSON.parse(raw) : null;
    } catch { /* ignore */ }

    if (error) {
      const errDesc = url.searchParams.get('error_description') || '';
      showToast(`DocuSign connection cancelled: ${error}${errDesc ? ' — ' + errDesc : ''}`, 'error');
      setIntegrations(prev => ({
        ...prev,
        docusign: {
          ...(prev.docusign || {}),
          lastSync: new Date().toISOString(),
          lastSyncStatus: 'error',
          lastSyncError: `OAuth ${error}: ${errDesc || '(no description)'}`,
        },
      }));
      sessionStorage.removeItem('ep:ds-oauth-pending');
      cleanUrl();
      setActiveNav('settings');
      return;
    }
    if (!code || !pending) {
      sessionStorage.removeItem('ep:ds-oauth-pending');
      cleanUrl();
      return;
    }
    if (state !== pending.state) {
      showToast('DocuSign OAuth state mismatch — possible CSRF. Aborted.', 'error');
      sessionStorage.removeItem('ep:ds-oauth-pending');
      cleanUrl();
      return;
    }

    (async () => {
      try {
        const tokens = await docusignAPI.exchangeAuthorizationCode({
          environment: pending.environment,
          clientId: pending.integrationKey,
          clientSecret: pending.clientSecret,
          code,
          redirectUri: pending.redirectUri,
        });
        // Pull account info to auto-detect accountId + base_uri.
        let info = null;
        try {
          info = await docusignAPI.getUserInfo({
            environment: pending.environment,
            accessToken: tokens.accessToken,
          });
        } catch (e) {
          // Continue even if userinfo fails — user can edit manually if needed.
          console.warn('[DocuSign] /userinfo failed:', e.message);
        }
        // Pick the account marked default, else the first one.
        const defaultAcct = (info?.accounts || []).find(a => a.is_default) || (info?.accounts || [])[0] || null;

        setIntegrations(prev => ({
          ...prev,
          docusign: {
            ...(prev.docusign || {}),
            environment: pending.environment,
            integrationKey: pending.integrationKey,
            clientSecret: pending.clientSecret,
            redirectUri: pending.redirectUri,
            connected: true,
            cachedAccessToken: tokens.accessToken,
            cachedAccessTokenExpiry: tokens.expiresAt,
            cachedRefreshToken: tokens.refreshToken,
            accountId: defaultAcct?.account_id || prev.docusign?.accountId || '',
            baseUri: defaultAcct?.base_uri ? `${defaultAcct.base_uri}/restapi` : (prev.docusign?.baseUri || ''),
            userId: info?.sub || prev.docusign?.userId || '',
            userEmail: info?.email || prev.docusign?.userEmail || '',
            lastSync: new Date().toISOString(),
            lastSyncStatus: 'success',
            lastSyncError: null,
          },
        }));
        logAction(`Connected to DocuSign (${pending.environment}) as ${info?.email || 'unknown'}`);
        showToast('Connected to DocuSign', 'success');
      } catch (err) {
        setIntegrations(prev => ({
          ...prev,
          docusign: {
            ...(prev.docusign || {}),
            connected: false,
            lastSync: new Date().toISOString(),
            lastSyncStatus: 'error',
            lastSyncError: err.message,
          },
        }));
        showToast('DocuSign connection failed: ' + err.message, 'error');
      } finally {
        sessionStorage.removeItem('ep:ds-oauth-pending');
        cleanUrl();
        setActiveNav('settings');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  // All possible nav items — each gated by a permission
  const allNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: PERMISSIONS.VIEW_DASHBOARD },
    { id: 'ondesk', label: 'Dashboards', icon: Zap, permission: PERMISSIONS.VIEW_ONDESK },
    { id: 'properties', label: 'Properties', icon: Building2, permission: PERMISSIONS.VIEW_PROPERTIES },
    { id: 'employees', label: 'Employees', icon: Users, permission: PERMISSIONS.VIEW_EMPLOYEES },
    { id: 'time', label: 'Time Tracking', icon: Clock, permission: PERMISSIONS.VIEW_TIME },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench, permission: PERMISSIONS.VIEW_MAINTENANCE },
    { id: 'outages', label: 'Report Outage', icon: Siren, permission: PERMISSIONS.VIEW_OUTAGES },
    { id: 'tenancy', label: 'Entries & Exits', icon: Home, permission: PERMISSIONS.VIEW_TENANCY },
    { id: 'leasing', label: 'Leasing', icon: FileSignature, permission: PERMISSIONS.VIEW_LEASING },
    { id: 'debtors', label: 'Debtors', icon: DollarSign, permission: PERMISSIONS.VIEW_DEBTORS },
    { id: 'projections', label: 'Projections', icon: TrendingUp, permission: PERMISSIONS.VIEW_PROJECTIONS },
    { id: 'users', label: 'Users & Roles', icon: Shield, permission: PERMISSIONS.MANAGE_USERS },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, permission: PERMISSIONS.VIEW_SETTINGS },
  ];

  // Filter nav by current user permissions
  const navItems = allNavItems.filter(item => hasPermission(currentUser, item.permission));

  // Valid routes that aren't in the sidebar (sub-pages reached by buttons).
  // Without this allowlist, the redirect-to-home effect below would bounce
  // away from them the moment they activate.
  const HIDDEN_ROUTES = new Set(['leaseDrafter']);

  // If the user lost permission for the current page, send them home.
  useEffect(() => {
    if (HIDDEN_ROUTES.has(activeNav)) return;
    if (!navItems.find(n => n.id === activeNav)) {
      setActiveNav(navItems[0]?.id || 'dashboard');
    }
  }, [navItems, activeNav]);

  // Global search
  const handleGlobalSearch = (e) => {
    if (e.key !== 'Enter' || !globalSearch.trim()) return;
    const q = globalSearch.toLowerCase();
    if (employees.some(emp => `${emp.firstName} ${emp.lastName} ${emp.email} ${emp.role}`.toLowerCase().includes(q)) && hasPermission(currentUser, PERMISSIONS.VIEW_EMPLOYEES)) {
      setActiveNav('employees');
    } else if (debtors.some(d => `${d.tenant} ${d.property} ${d.unit}`.toLowerCase().includes(q)) && hasPermission(currentUser, PERMISSIONS.VIEW_DEBTORS)) {
      setActiveNav('debtors');
    } else if (leases.some(l => `${l.tenant} ${l.property} ${l.unit}`.toLowerCase().includes(q)) && hasPermission(currentUser, PERMISSIONS.VIEW_LEASING)) {
      setActiveNav('leasing');
    } else if (properties.some(p => p.address.toLowerCase().includes(q)) && hasPermission(currentUser, PERMISSIONS.VIEW_PROPERTIES)) {
      setActiveNav('properties');
    } else {
      showToast('No matches found or you lack permission', 'error');
    }
  };

  const renderContent = () => {
    // Permission guard — defense in depth, even though nav is filtered
    const checkPerm = (perm) => {
      if (!hasPermission(currentUser, perm)) {
        return (
          <Card className="p-8 text-center animate-fade-in-up">
            <EmptyState icon={Lock} title="Access Denied" message="You don't have permission to view this section. Contact your administrator." />
          </Card>
        );
      }
      return null;
    };

    switch (activeNav) {
      case 'dashboard': return checkPerm(PERMISSIONS.VIEW_DASHBOARD) || <Dashboard employees={employees} properties={properties} inspections={inspections} leases={leases} debtors={debtors} activityLog={activityLog} currentUser={currentUser} onNavigate={setActiveNav} />;
      case 'ondesk': return checkPerm(PERMISSIONS.VIEW_ONDESK) || <OnDeskSection employees={employees} deskStatuses={deskStatuses} setDeskStatuses={setDeskStatuses} activityLog={activityLog} currentUser={currentUser} showToast={showToast} logAction={logAction} />;
      case 'properties': return checkPerm(PERMISSIONS.VIEW_PROPERTIES) || <PropertiesSection properties={properties} setProperties={setProperties} tenancies={tenancies} setTenancies={setTenancies} showToast={showToast} logAction={logAction} />;
      case 'employees': return checkPerm(PERMISSIONS.VIEW_EMPLOYEES) || <EmployeesSection employees={employees} setEmployees={setEmployees} showToast={showToast} logAction={logAction} />;
      case 'time': return checkPerm(PERMISSIONS.VIEW_TIME) || <TimeTrackingSection employees={employees} showToast={showToast} integrations={integrations} setIntegrations={setIntegrations} onNavigateToSettings={() => setActiveNav('settings')} />;
      case 'maintenance': return checkPerm(PERMISSIONS.VIEW_MAINTENANCE) || <MaintenanceSection maintenance={maintenance} setMaintenance={setMaintenance} properties={properties} employees={employees} showToast={showToast} logAction={logAction} />;
      case 'outages': return checkPerm(PERMISSIONS.VIEW_OUTAGES) || <OutagesSection outages={outages} setOutages={setOutages} properties={properties} currentUser={currentUser} showToast={showToast} logAction={logAction} />;
      case 'tenancy': return checkPerm(PERMISSIONS.VIEW_TENANCY) || <TenancyActivitySection inspections={inspections} integrations={integrations} onNavigateToSettings={() => setActiveNav('settings')} />;
      case 'projections': return checkPerm(PERMISSIONS.VIEW_PROJECTIONS) || <ProjectionsSection showToast={showToast} logAction={logAction} />;
      case 'leasing': return checkPerm(PERMISSIONS.VIEW_LEASING) || <LeasingSection leases={leases} setLeases={setLeases} properties={properties} employees={employees} debtors={debtors} integrations={integrations} setIntegrations={setIntegrations} showToast={showToast} logAction={logAction} currentUser={currentUser} onNavigateToSettings={() => setActiveNav('settings')} onNavigate={setActiveNav} />;
      case 'leaseDrafter': return checkPerm(PERMISSIONS.VIEW_LEASING) || <LeaseDrafter currentUser={currentUser} showToast={showToast} logAction={logAction} integrations={integrations} debtors={debtors} onNavigateToSettings={() => setActiveNav('settings')} onClose={() => setActiveNav('leasing')} />;
      case 'debtors': return checkPerm(PERMISSIONS.VIEW_DEBTORS) || <DebtorsSection debtors={debtors} setDebtors={setDebtors} debtorAccounts={debtorAccounts} setDebtorAccounts={setDebtorAccounts} debtorNotes={debtorNotes} setDebtorNotes={setDebtorNotes} currentUser={currentUser} showToast={showToast} logAction={logAction} />;
      case 'users': return checkPerm(PERMISSIONS.MANAGE_USERS) || <UsersSection employees={employees} setEmployees={setEmployees} currentUser={currentUser} setCurrentUser={setCurrentUser} showToast={showToast} logAction={logAction} />;
      case 'settings': return checkPerm(PERMISSIONS.VIEW_SETTINGS) || (
        <SettingsSection
          companyProfile={companyProfile} setCompanyProfile={setCompanyProfile}
          departments={departments} setDepartments={setDepartments}
          notificationPrefs={notificationPrefs} setNotificationPrefs={setNotificationPrefs}
          integrations={integrations} setIntegrations={setIntegrations}
          security={security} setSecurity={setSecurity}
          auditLog={auditLog} setAuditLog={setAuditLog}
          employees={employees} properties={properties} inspections={inspections}
          leases={leases} debtors={debtors} maintenance={maintenance}
          setEmployees={setEmployees} setProperties={setProperties}
          setInspections={setInspections} setLeases={setLeases}
          setDebtors={setDebtors} setMaintenance={setMaintenance}
          showToast={showToast} logAction={logAction}
        />
      );
      default: return null;
    }
  };

  // While the initial /api/auth/me probe is in flight, render a blank
  // navy screen — flashing the login form for a split second on every
  // page load would look broken.
  if (!authChecked) {
    return <div className="min-h-screen" style={{ backgroundColor: brand.navy }} />;
  }

  // Login gate — show LoginPage if no valid session
  if (!authUser) {
    return <LoginPage onLoggedIn={(user) => setAuthUser(user)} />;
  }

  return (
    <div className="h-screen flex overflow-hidden" style={{ backgroundColor: brand.cream, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      {(mustChangePassword || showChangePassword) && (
        <ChangePasswordModal
          currentUser={currentUser}
          mustChange={mustChangePassword}
          showToast={showToast}
          onChanged={async () => {
            setShowChangePassword(false);
            try {
              const fresh = await api.auth.me();
              setAuthUser(fresh);
            } catch { /* ignore */ }
          }}
          onCancel={mustChangePassword ? undefined : () => setShowChangePassword(false)}
        />
      )}
      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fade-in-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slide-in-right { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes slide-in-left { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes scale-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        @keyframes pulse-soft { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(184, 146, 74, 0.5); } 70% { box-shadow: 0 0 0 8px rgba(184, 146, 74, 0); } 100% { box-shadow: 0 0 0 0 rgba(184, 146, 74, 0); } }
        @keyframes shimmer { 0% { background-position: -1000px 0; } 100% { background-position: 1000px 0; } }
        @keyframes count-up { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }

        .animate-fade-in { animation: fade-in 0.3s ease-out; }
        .animate-fade-in-up { animation: fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-slide-in-right { animation: slide-in-right 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-slide-in-left { animation: slide-in-left 0.35s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-scale-in { animation: scale-in 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
        .animate-pulse-soft { animation: pulse-soft 2s ease-in-out infinite; }
        .animate-pulse-ring { animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        .animate-shake { animation: shake 0.4s ease-in-out; }
        .animate-count-up { animation: count-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) backwards; }

        /* Stagger delays for list items */
        .stagger-1 { animation-delay: 0.05s; }
        .stagger-2 { animation-delay: 0.10s; }
        .stagger-3 { animation-delay: 0.15s; }
        .stagger-4 { animation-delay: 0.20s; }
        .stagger-5 { animation-delay: 0.25s; }
        .stagger-6 { animation-delay: 0.30s; }
        .stagger-7 { animation-delay: 0.35s; }
        .stagger-8 { animation-delay: 0.40s; }

        /* Card hover lift */
        .card-lift {
          transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
        }
        .card-lift:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 16px -8px rgba(15, 30, 46, 0.12);
        }

        /* Button press feedback */
        .btn-press {
          transition: transform 0.1s ease, opacity 0.2s ease;
        }
        .btn-press:active:not(:disabled) {
          transform: scale(0.97);
        }

        /* Skeleton loader */
        .skeleton {
          background: linear-gradient(90deg, #E8E2D4 0%, #F5EBD6 50%, #E8E2D4 100%);
          background-size: 1000px 100%;
          animation: shimmer 1.8s infinite linear;
          border-radius: 4px;
        }

        /* Active nav indicator */
        .nav-item {
          transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
        }

        /* Smooth status badges */
        .status-transition {
          transition: background-color 0.3s ease, color 0.3s ease;
        }

        /* Number ticker */
        .stat-number {
          animation: count-up 0.5s cubic-bezier(0.16, 1, 0.3, 1);
          display: inline-block;
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #D4CCB8; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #B8924A; }
      `}</style>

      {/* Mobile-only backdrop. Renders under the drawer when open so taps
          outside the nav close it. md:+ never sees it. */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 md:hidden"
          style={{ backgroundColor: 'rgba(15, 30, 46, 0.5)' }}
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed-position slide-in drawer on mobile, in-flow on md:+ */}
      <aside
        className={`w-64 flex-shrink-0 flex flex-col fixed md:static inset-y-0 left-0 z-40 transform transition-transform duration-200 ease-out ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        style={{ backgroundColor: brand.navy }}
      >
        {/* Logo */}
        <div className="px-6 py-6 flex items-center justify-between" style={{ borderBottom: `1px solid ${brand.navyLight}` }}>
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded flex items-center justify-center font-bold"
              style={{ backgroundColor: brand.gold, color: brand.navy, fontFamily: 'Georgia, serif' }}
            >
              E
            </div>
            <div>
              <p className="font-semibold tracking-wide text-white" style={{ fontFamily: 'Georgia, serif' }}>EXCEED</p>
              <p className="text-xs tracking-[0.2em] uppercase" style={{ color: brand.goldLight }}>Properties</p>
            </div>
          </div>
          {/* Close button — only visible inside the mobile drawer */}
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="md:hidden p-1 rounded hover:bg-white/10"
            aria-label="Close menu"
          >
            <X size={18} style={{ color: 'rgba(255,255,255,0.7)' }} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto no-scrollbar">
          {navItems.map((item, idx) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setActiveNav(item.id); setMobileNavOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm nav-item btn-press animate-slide-in-left stagger-${Math.min(idx + 1, 8)}`}
                style={{
                  backgroundColor: isActive ? brand.navyLight : 'transparent',
                  color: isActive ? brand.goldLight : 'rgba(255,255,255,0.7)',
                  borderLeft: `2px solid ${isActive ? brand.gold : 'transparent'}`,
                }}
              >
                <Icon size={16} />
                <span className="font-medium tracking-wide">{item.label}</span>
                {item.id === 'ondesk' && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full animate-pulse-soft" style={{ backgroundColor: brand.success }} />
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-6 py-4" style={{ borderTop: `1px solid ${brand.navyLight}` }}>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Version 0.5.0 · Preview</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="px-4 md:px-8 py-4 flex items-center justify-between gap-3" style={{ backgroundColor: '#fff', borderBottom: `1px solid ${brand.border}` }}>
          <div className="flex items-center gap-3 flex-1 min-w-0 max-w-md">
            {/* Hamburger — opens the mobile drawer. Hidden on md:+. */}
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden p-2 -ml-2 rounded hover:bg-black hover:bg-opacity-5 btn-press"
              aria-label="Open menu"
            >
              <Menu size={20} style={{ color: brand.text }} />
            </button>
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: brand.textMuted }} />
              <input
                type="text"
                placeholder="Search properties, tenants, employees..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                onKeyDown={handleGlobalSearch}
                className="w-full pl-9 pr-3 py-2 text-sm rounded outline-none"
                style={{ backgroundColor: brand.cream, border: `1px solid ${brand.border}` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 ml-4">
            <div className="relative">
              <button onClick={() => setUserMenuOpen(!userMenuOpen)} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-black hover:bg-opacity-5 btn-press">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold" style={{ backgroundColor: brand.goldPale, color: brand.gold }}>
                  {currentUser.firstName[0]}{currentUser.lastName[0]}
                </div>
                <div className="text-left hidden md:block">
                  <p className="text-sm font-medium" style={{ color: brand.text }}>{currentUser.firstName} {currentUser.lastName}</p>
                  <p className="text-xs flex items-center gap-1" style={{ color: brand.textMuted }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ROLES[currentUser.systemRole]?.color }} />
                    {ROLES[currentUser.systemRole]?.label || 'No Role'}
                  </p>
                </div>
                <ChevronDown size={14} style={{ color: brand.textMuted }} />
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-64 rounded shadow-lg z-10 animate-scale-in" style={{ backgroundColor: '#fff', border: `1px solid ${brand.border}`, transformOrigin: 'top right' }}>
                  <div className="px-4 py-3" style={{ borderBottom: `1px solid ${brand.border}` }}>
                    <p className="text-sm font-medium" style={{ color: brand.text }}>{currentUser.firstName} {currentUser.lastName}</p>
                    <p className="text-xs" style={{ color: brand.textMuted }}>{currentUser.email}</p>
                  </div>
                  <button onClick={() => { if (hasPermission(currentUser, PERMISSIONS.VIEW_SETTINGS)) { setActiveNav('settings'); setUserMenuOpen(false); } else { showToast('You do not have access to settings', 'error'); } }} className="w-full px-4 py-2 text-sm text-left hover:bg-black hover:bg-opacity-5 flex items-center gap-2 transition-colors" style={{ color: brand.text }}>
                    <SettingsIcon size={14} /> Preferences
                  </button>
                  <button onClick={() => { setUserMenuOpen(false); setShowChangePassword(true); }} className="w-full px-4 py-2 text-sm text-left hover:bg-black hover:bg-opacity-5 flex items-center gap-2 transition-colors" style={{ color: brand.text }}>
                    <Lock size={14} /> Change password
                  </button>
                  <div style={{ borderTop: `1px solid ${brand.border}` }} />
                  <button onClick={() => { setUserMenuOpen(false); handleLogout(); }} className="w-full px-4 py-2 text-sm text-left hover:bg-black hover:bg-opacity-5 flex items-center gap-2 transition-colors" style={{ color: brand.danger }}>
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 p-4 md:p-8 overflow-y-auto">
          <div key={activeNav} className="animate-fade-in-up">
            {renderContent()}
          </div>
        </div>
      </main>

      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />
    </div>
  );
}
