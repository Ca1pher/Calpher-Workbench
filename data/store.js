const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 100000;

export const DEFAULT_INTEGRATION_LIMIT = 3;
export const DEFAULT_SHORTCUT_LIMIT = 10;

function requireKv(env) {
  if (!env.WORKBENCH_KV) throw new Error('WORKBENCH_KV 未配置');
  return env.WORKBENCH_KV;
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

function normalizeLimit(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1000 ? parsed : fallback;
}

export function normalizeUsername(value) {
  const name = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,32}$/.test(name) ? name : '';
}

export function normalizeHttpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url.toString() : '';
  } catch (e) {
    return '';
  }
}

export function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashPassword(password, salt = randomSecret()) {
  const text = String(password || '');
  if (text.length < 8 || text.length > 200) throw new Error('密码长度需为 8 至 200 位');
  const key = await crypto.subtle.importKey('raw', enc.encode(text), 'PBKDF2', false, ['deriveBits']);
  const iterations = PBKDF2_ITERATIONS;
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: base64UrlToBytes(salt),
    iterations,
  }, key, 256);
  return { algorithm: 'PBKDF2-SHA256', iterations, salt, hash: bytesToBase64Url(bits) };
}

export async function verifyPassword(password, credential) {
  if (!credential || credential.algorithm !== 'PBKDF2-SHA256') return false;
  const derived = await hashPasswordWithCredential(password, credential);
  const left = base64UrlToBytes(derived);
  const right = base64UrlToBytes(credential.hash || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function hashPasswordWithCredential(password, credential) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(password || '')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: base64UrlToBytes(credential.salt),
    iterations: credential.iterations,
  }, key, 256);
  return bytesToBase64Url(bits);
}

function memberKey(name) {
  return `member:${name}`;
}

function workspaceKey(name) {
  return `workspace:${name}`;
}

async function passwordVaultKey(env) {
  const secret = String(env.AUTH_COOKIE_SECRET || '').trim();
  if (!secret) throw new Error('AUTH_COOKIE_SECRET 未配置，无法保存可查看密码');
  const material = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`calpher-member-password-v1:${secret}`),
  );
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptMemberPassword(env, password) {
  const text = String(password || '');
  if (text.length < 8 || text.length > 200) throw new Error('密码长度需为 8 至 200 位');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await passwordVaultKey(env),
    enc.encode(text),
  );
  return {
    version: 1,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(ciphertext),
  };
}

async function decryptMemberPassword(env, vault) {
  if (!vault || vault.version !== 1) return '';
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(vault.iv) },
      await passwordVaultKey(env),
      base64UrlToBytes(vault.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch (e) {
    return '';
  }
}

export async function getMember(env, name) {
  const normalized = normalizeUsername(name);
  if (!normalized) return null;
  return requireKv(env).get(memberKey(normalized), 'json');
}

export async function listMembers(env) {
  const kv = requireKv(env);
  const result = await kv.list({ prefix: 'member:' });
  const members = await Promise.all(result.keys.map((key) => kv.get(key.name, 'json')));
  return members.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createMember(env, input) {
  const name = normalizeUsername(input.name);
  if (!name) throw new Error('账号需为 3 至 32 位字母、数字、点、横线或下划线');
  if (await getMember(env, name)) throw new Error('账号已存在');
  const now = new Date().toISOString();
  const member = {
    name,
    role: 'user',
    disabled: false,
    integrationLimit: normalizeLimit(input.integrationLimit, DEFAULT_INTEGRATION_LIMIT),
    shortcutLimit: normalizeLimit(input.shortcutLimit, DEFAULT_SHORTCUT_LIMIT),
    credential: await hashPassword(input.password),
    passwordVault: await encryptMemberPassword(env, input.password),
    createdAt: now,
    updatedAt: now,
  };
  await requireKv(env).put(memberKey(name), JSON.stringify(member));
  return publicMember(member);
}

export async function updateMember(env, name, input) {
  const member = await getMember(env, name);
  if (!member) throw new Error('成员不存在');
  if (input.password) {
    member.credential = await hashPassword(input.password);
    member.passwordVault = await encryptMemberPassword(env, input.password);
  }
  if (input.integrationLimit !== undefined) {
    member.integrationLimit = normalizeLimit(input.integrationLimit, member.integrationLimit);
  }
  if (input.shortcutLimit !== undefined) {
    member.shortcutLimit = normalizeLimit(input.shortcutLimit, member.shortcutLimit);
  }
  if (input.disabled !== undefined) member.disabled = Boolean(input.disabled);
  member.updatedAt = new Date().toISOString();
  await requireKv(env).put(memberKey(member.name), JSON.stringify(member));
  return publicMember(member);
}

export async function deleteMember(env, name) {
  const normalized = normalizeUsername(name);
  if (!normalized || !(await getMember(env, normalized))) throw new Error('成员不存在');
  const kv = requireKv(env);
  await Promise.all([
    kv.delete(memberKey(normalized)),
    kv.delete(workspaceKey(normalized)),
  ]);
}

export function publicMember(member) {
  return {
    name: member.name,
    role: 'user',
    disabled: Boolean(member.disabled),
    integrationLimit: normalizeLimit(member.integrationLimit, DEFAULT_INTEGRATION_LIMIT),
    shortcutLimit: normalizeLimit(member.shortcutLimit, DEFAULT_SHORTCUT_LIMIT),
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

export async function verifyMemberLogin(env, name, password) {
  const member = await getMember(env, name);
  if (!member || member.disabled) return null;
  if (!(await verifyPassword(password, member.credential))) return null;
  if (!member.passwordVault) {
    member.passwordVault = await encryptMemberPassword(env, password);
    member.updatedAt = new Date().toISOString();
    await requireKv(env).put(memberKey(member.name), JSON.stringify(member));
  }
  return publicMember(member);
}

export async function getMemberPassword(env, name) {
  const member = await getMember(env, name);
  if (!member) throw new Error('成员不存在');
  const password = await decryptMemberPassword(env, member.passwordVault);
  if (!password) throw new Error('该成员是旧数据，请先重置密码或让成员重新登录');
  return password;
}

export async function updateOwnMember(env, currentName, input) {
  const member = await getMember(env, currentName);
  if (!member) throw new Error('成员不存在');
  const nextName = input.name === undefined ? member.name : normalizeUsername(input.name);
  if (!nextName) throw new Error('账号需为 3 至 32 位字母、数字、点、横线或下划线');
  if (nextName !== member.name && await getMember(env, nextName)) throw new Error('账号已存在');
  if (input.password) {
    member.credential = await hashPassword(input.password);
    member.passwordVault = await encryptMemberPassword(env, input.password);
  }
  member.name = nextName;
  member.updatedAt = new Date().toISOString();
  const kv = requireKv(env);
  if (nextName === currentName) {
    await kv.put(memberKey(nextName), JSON.stringify(member));
  } else {
    const workspace = await getWorkspace(env, currentName);
    await Promise.all([
      kv.put(memberKey(nextName), JSON.stringify(member)),
      kv.put(workspaceKey(nextName), JSON.stringify(workspace)),
    ]);
    await Promise.all([
      kv.delete(memberKey(currentName)),
      kv.delete(workspaceKey(currentName)),
    ]);
  }
  return publicMember(member);
}

export async function getWorkspace(env, name) {
  const normalized = normalizeUsername(name);
  if (!normalized) throw new Error('账号无效');
  const stored = await requireKv(env).get(workspaceKey(normalized), 'json');
  return {
    integrations: Array.isArray(stored && stored.integrations) ? stored.integrations : [],
    shortcuts: Array.isArray(stored && stored.shortcuts) ? stored.shortcuts : [],
  };
}

async function putWorkspace(env, name, workspace) {
  await requireKv(env).put(workspaceKey(name), JSON.stringify(workspace));
}

export async function addIntegration(env, owner, input, limit) {
  const workspace = await getWorkspace(env, owner);
  if (workspace.integrations.length >= limit) throw new Error(`接入项目已达上限 ${limit} 个`);
  const url = normalizeHttpsUrl(input.url);
  if (!url) throw new Error('接入地址必须是有效的 HTTPS URL');
  const origin = new URL(url).origin;
  if (workspace.integrations.some((item) => new URL(item.url).origin === origin)) {
    throw new Error('该域名已接入');
  }
  const item = {
    id: `integration-${crypto.randomUUID()}`,
    kind: 'integration',
    name: String(input.name || '').trim().slice(0, 40) || new URL(url).hostname,
    url,
    icon: String(input.icon || 'link').slice(0, 20),
    description: String(input.description || '').trim().slice(0, 160),
    details: String(input.details || '').trim().slice(0, 2000),
    secret: String(input.secret || '').trim() || randomSecret(),
    createdAt: new Date().toISOString(),
  };
  if (item.secret.length < 24 || item.secret.length > 200) throw new Error('接入密钥长度需为 24 至 200 位');
  workspace.integrations.push(item);
  await putWorkspace(env, owner, workspace);
  return item;
}

export async function addShortcut(env, owner, input, limit) {
  const workspace = await getWorkspace(env, owner);
  if (workspace.shortcuts.length >= limit) throw new Error(`网站导航已达上限 ${limit} 个`);
  const url = normalizeHttpsUrl(input.url);
  if (!url) throw new Error('网站导航必须是有效的 HTTPS URL');
  const item = {
    id: `shortcut-${crypto.randomUUID()}`,
    kind: 'shortcut',
    name: String(input.name || '').trim().slice(0, 40) || new URL(url).hostname,
    url,
    icon: String(input.icon || 'link').slice(0, 20),
    description: String(input.description || '').trim().slice(0, 160),
    details: String(input.details || '').trim().slice(0, 2000),
    createdAt: new Date().toISOString(),
  };
  workspace.shortcuts.push(item);
  await putWorkspace(env, owner, workspace);
  return item;
}

export async function updateWorkspaceItem(env, owner, kind, id, input) {
  const workspace = await getWorkspace(env, owner);
  const key = kind === 'integration' ? 'integrations' : 'shortcuts';
  const item = workspace[key].find((entry) => entry.id === id);
  if (!item) throw new Error('项目不存在');

  const url = input.url === undefined ? item.url : normalizeHttpsUrl(input.url);
  if (!url) throw new Error(kind === 'integration'
    ? '接入地址必须是有效的 HTTPS URL'
    : '网站导航必须是有效的 HTTPS URL');
  if (kind === 'integration') {
    const origin = new URL(url).origin;
    if (workspace.integrations.some((entry) => entry.id !== id && new URL(entry.url).origin === origin)) {
      throw new Error('该域名已接入');
    }
  }

  item.name = input.name === undefined
    ? item.name
    : String(input.name || '').trim().slice(0, 40) || new URL(url).hostname;
  item.url = url;
  if (input.icon !== undefined) item.icon = String(input.icon || 'link').slice(0, 20);
  if (input.description !== undefined) {
    item.description = String(input.description || '').trim().slice(0, 160);
  }
  if (input.details !== undefined) {
    item.details = String(input.details || '').trim().slice(0, 2000);
  }
  if (kind === 'integration' && input.secret !== undefined && String(input.secret || '').trim()) {
    const secret = String(input.secret).trim();
    if (secret.length < 24 || secret.length > 200) throw new Error('接入密钥长度需为 24 至 200 位');
    item.secret = secret;
  }
  item.updatedAt = new Date().toISOString();
  await putWorkspace(env, owner, workspace);
  return item;
}

export async function removeWorkspaceItem(env, owner, kind, id) {
  const workspace = await getWorkspace(env, owner);
  const key = kind === 'integration' ? 'integrations' : 'shortcuts';
  const before = workspace[key].length;
  workspace[key] = workspace[key].filter((item) => item.id !== id);
  if (workspace[key].length === before) throw new Error('项目不存在');
  await putWorkspace(env, owner, workspace);
}

export function limitsFor(user, member) {
  if (user.role === 'admin') return { integrationLimit: 100, shortcutLimit: 100 };
  return {
    integrationLimit: normalizeLimit(member && member.integrationLimit, DEFAULT_INTEGRATION_LIMIT),
    shortcutLimit: normalizeLimit(member && member.shortcutLimit, DEFAULT_SHORTCUT_LIMIT),
  };
}
