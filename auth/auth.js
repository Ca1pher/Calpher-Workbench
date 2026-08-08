const enc = new TextEncoder();
let secretWarned = false;

function sessionSecret(env) {
  const secret = env.AUTH_COOKIE_SECRET || 'dev-insecure-secret';
  if (secret === 'dev-insecure-secret' && !secretWarned) {
    secretWarned = true;
    console.warn('[auth] AUTH_COOKIE_SECRET 未配置，正在使用公开的 dev-insecure-secret，任何知晓者都可伪造会话。生产部署前必须配置。');
  }
  return secret;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function hmac(secret, data) {
  return crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const COOKIE_NAME = 'calpher_auth';

export function buildSessionCookie(sid) {
  return `${COOKIE_NAME}=${sid}; Domain=${globalThis.PARENT_DOMAIN || 'example.dev'}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

export function buildLogoutCookie() {
  return `${COOKIE_NAME}=; Domain=${globalThis.PARENT_DOMAIN || 'example.dev'}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function signSession(env, payload) {
  const secret = sessionSecret(env);
  const body = JSON.stringify(payload);
  const sig = toHex(await hmac(secret, body));
  return `${typeof Buffer !== 'undefined' ? Buffer.from(body).toString('base64') : btoa(unescape(encodeURIComponent(body)))}.${sig}`;
}

async function verifySession(env, sid) {
  if (!sid) return null;
  const dot = sid.lastIndexOf('.');
  if (dot < 0) return null;
  const b64 = sid.slice(0, dot);
  const sig = sid.slice(dot + 1);
  const secret = sessionSecret(env);
  let body;
  try { body = decodeURIComponent(escape(atob(b64))); } catch (e) { return null; }
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), toBytes(sig), enc.encode(body));
  if (!valid) return null;
  try { return JSON.parse(body); } catch (e) { return null; }
}

function readCookie(request, name) {
  const h = request.headers.get('Cookie') || '';
  for (const part of h.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export async function authenticate(request, env) {
  const sid = readCookie(request, COOKIE_NAME);
  const payload = await verifySession(env, sid);
  if (!payload) return { user: null, sid: null };
  return { user: { name: payload.name, role: payload.role || 'user' }, sid };
}

export async function loginByMaster(env, name, pass) {
  // 模式优先级：AUTH_MASTER_PASS 存在即独立模式（本地校验）。
  // 接入模式（AUTH_MASTER_ORIGIN + AUTH_MASTER_TOKEN）依赖主鉴权中心
  // 的 federation 接口，当前阶段尚未落地，接入模式暂不可用。
  const mode = env.AUTH_MASTER_PASS ? 'standalone' : (env.AUTH_MASTER_ORIGIN ? 'federated' : 'none');
  let ok = false;
  let displayName = name;
  if (mode === 'standalone') {
    ok = name === (env.AUTH_MASTER_NAME || 'admin') && pass === env.AUTH_MASTER_PASS;
  } else if (mode === 'federated') {
    // 占位：待主鉴权中心 federation 接口落地后改为向 AUTH_MASTER_ORIGIN 校验。
    // 当前一律失败，避免配置接入模式却静默走本地空密码校验。
    ok = false;
  } else {
    ok = false;
  }
  if (!ok) return { ok: false };
  const payload = { name: displayName, role: 'admin', iat: Date.now() };
  const sid = await signSession(env, payload);
  return { ok: true, user: payload, sid };
}

export async function handleAuthSync(request, env) {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  const token = request.headers.get('X-Master-Token');
  if (token !== env.AUTH_MASTER_TOKEN) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  let body;
  try { body = await request.json(); } catch (e) { body = null; }
  return new Response(JSON.stringify({ ok: true, received: body }), { headers: { 'Content-Type': 'application/json' } });
}
