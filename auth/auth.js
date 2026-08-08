const enc = new TextEncoder();
let warnedPartialConfig = false;

export const COOKIE_NAME = 'calpher_auth';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const HANDOFF_TTL_SECONDS = 90;

function requiredSecret(env, override) {
  const secret = String(override || env.AUTH_COOKIE_SECRET || '').trim();
  if (!secret) throw new Error('AUTH_COOKIE_SECRET 未配置');
  return secret;
}

function normalizeOrigin(value) {
  if (!value) return '';
  try { return new URL(value).origin; } catch (e) { return ''; }
}

export function getAuthMode(env) {
  const origin = normalizeOrigin(env.AUTH_MASTER_ORIGIN);
  const secret = String(env.AUTH_COOKIE_SECRET || '').trim();
  if (Boolean(origin) !== Boolean(secret) && !warnedPartialConfig) {
    warnedPartialConfig = true;
    console.warn('[auth] AUTH_MASTER_ORIGIN 与 AUTH_COOKIE_SECRET 未同时配置，已使用独立站模式');
  }
  return origin && secret ? 'federated' : 'standalone';
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeJson(value) {
  return bytesToBase64Url(enc.encode(JSON.stringify(value)));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function signToken(env, payload, secret) {
  const body = encodeJson(payload);
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(requiredSecret(env, secret)),
    enc.encode(body),
  );
  return `${body}.${bytesToBase64Url(signature)}`;
}

async function verifyToken(env, token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(requiredSecret(env, secret)),
      base64UrlToBytes(parts[1]),
      enc.encode(parts[0]),
    );
    return valid ? decodeJson(parts[0]) : null;
  } catch (e) {
    return null;
  }
}

function readCookies(request, name) {
  const header = request.headers.get('Cookie') || '';
  const values = [];
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        values.push(decodeURIComponent(part.slice(index + 1).trim()));
      } catch (e) {
        // Ignore a malformed duplicate and continue looking for a valid session.
      }
    }
  }
  return values;
}

function cookieDomain(request, env) {
  const parent = String(env.PARENT_DOMAIN || '').trim().replace(/^\./, '').toLowerCase();
  if (!parent || !request) return '';
  const host = new URL(request.url).hostname.toLowerCase();
  return host === parent || host.endsWith(`.${parent}`) ? parent : '';
}

function cookieBase(request, env, maxAge, options = {}) {
  const domain = cookieDomain(request, env);
  const partitioned = Boolean(options.partitioned) && !domain;
  const parts = [
    'Path=/',
    'HttpOnly',
    'Secure',
    `SameSite=${partitioned || (!domain && getAuthMode(env) === 'federated') ? 'None' : 'Lax'}`,
    `Max-Age=${maxAge}`,
  ];
  if (domain) parts.splice(1, 0, `Domain=${domain}`);
  if (partitioned) parts.push('Partitioned');
  return parts.join('; ');
}

export function buildSessionCookie(sid, request, env, options = {}) {
  return `${COOKIE_NAME}=${encodeURIComponent(sid)}; ${cookieBase(request, env, SESSION_TTL_SECONDS, options)}`;
}

export function buildLogoutCookie(request, env, options = {}) {
  return `${COOKIE_NAME}=; ${cookieBase(request, env, 0, options)}`;
}

export async function createSession(env, user, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  return signToken(env, {
    v: 1,
    typ: 'session',
    sub: String(user.name || user.sub || 'admin'),
    role: user.role || 'user',
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
  });
}

export async function verifySession(env, sid, now = Date.now()) {
  const payload = await verifyToken(env, sid);
  const current = Math.floor(now / 1000);
  if (!payload || payload.typ !== 'session' || payload.v !== 1) return null;
  if (!payload.sub || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;
  if (payload.iat > current + 10 || payload.exp <= current) return null;
  return { name: payload.sub, role: payload.role || 'user' };
}

export async function authenticate(request, env, now = Date.now()) {
  for (const sid of readCookies(request, COOKIE_NAME)) {
    const user = await verifySession(env, sid, now);
    if (user) return { user, sid, source: 'calpher' };
  }
  return { user: null, sid: null };
}

export async function loginByMaster(env, name, pass) {
  const expectedName = env.AUTH_MASTER_NAME || 'admin';
  const ok = Boolean(env.AUTH_MASTER_PASS)
    && name === expectedName
    && pass === env.AUTH_MASTER_PASS;
  if (!ok) return { ok: false };
  const user = { name: expectedName, role: 'admin' };
  return { ok: true, user, sid: await createSession(env, user) };
}

export async function createHandoffTicket(env, user, audience, returnUrl, now = Date.now(), secret = '') {
  const aud = normalizeOrigin(audience);
  const target = new URL(returnUrl);
  if (!aud || target.origin !== aud) throw new Error('handoff audience 不匹配');
  const issuedAt = Math.floor(now / 1000);
  return signToken(env, {
    v: 1,
    typ: 'handoff',
    sub: String(user.name || user.sub || 'admin'),
    role: user.role || 'user',
    aud,
    returnUrl: target.toString(),
    nonce: crypto.randomUUID(),
    iat: issuedAt,
    exp: issuedAt + HANDOFF_TTL_SECONDS,
  }, secret);
}

export async function verifyHandoffTicket(env, ticket, audience, now = Date.now(), secret = '') {
  const payload = await verifyToken(env, ticket, secret);
  const current = Math.floor(now / 1000);
  const aud = normalizeOrigin(audience);
  if (!payload || payload.typ !== 'handoff' || payload.v !== 1) return null;
  if (!payload.sub || !payload.nonce || payload.aud !== aud) return null;
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.exp <= current) return null;
  if (payload.iat > current + 10 || current - payload.iat > HANDOFF_TTL_SECONDS + 10) return null;
  try {
    if (new URL(payload.returnUrl).origin !== aud) return null;
  } catch (e) {
    return null;
  }
  return {
    user: { name: payload.sub, role: payload.role || 'user' },
    returnUrl: payload.returnUrl,
    nonce: payload.nonce,
  };
}

export function buildMasterLoginUrl(request, env, targetUrl = request.url) {
  const origin = normalizeOrigin(env.AUTH_MASTER_ORIGIN);
  if (!origin) return '';
  const login = new URL('/login', origin);
  login.searchParams.set('redirect', new URL(targetUrl, request.url).toString());
  return login.toString();
}
