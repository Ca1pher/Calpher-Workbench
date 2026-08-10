import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticate,
  buildSessionCookie,
  buildMasterLoginUrl,
  createHandoffTicket,
  createSession,
  getAuthMode,
  loginByMaster,
  verifyHandoffTicket,
} from './auth.js';
import {
  addIntegration,
  addShortcut,
  createMember,
  deleteMember,
  getMemberPassword,
  getWorkspace,
  updateOwnMember,
  updateMember,
  updateWorkspaceItem,
  verifyMemberLogin,
} from '../data/store.js';
import { platformIntegrations, removePlatformIntegration } from '../data/registry.js';

const env = { AUTH_COOKIE_SECRET: 'test-secret-at-least-not-empty' };
const now = Date.UTC(2026, 7, 8, 12, 0, 0);

class FakeKv {
  constructor() {
    this.values = new Map();
  }

  async get(key, type) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }

  async list({ prefix }) {
    return {
      keys: [...this.values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
    };
  }
}

function memberEnv() {
  return {
    AUTH_COOKIE_SECRET: 'member-vault-test-secret',
    WORKBENCH_KV: new FakeKv(),
  };
}

test('mode requires both master origin and shared secret', () => {
  assert.equal(getAuthMode({}), 'standalone');
  assert.equal(getAuthMode({ AUTH_MASTER_ORIGIN: 'https://main.example' }), 'standalone');
  assert.equal(getAuthMode({ AUTH_COOKIE_SECRET: 'secret' }), 'standalone');
  assert.equal(getAuthMode({
    AUTH_MASTER_ORIGIN: 'https://main.example/path',
    AUTH_COOKIE_SECRET: 'secret',
  }), 'federated');
});

test('session is signed, expires, and authenticates from cookie', async () => {
  const sid = await createSession(env, { name: 'calpher', role: 'admin' }, now);
  const request = new Request('https://child.example/', {
    headers: { Cookie: `calpher_auth=${encodeURIComponent(sid)}` },
  });
  const accepted = await authenticate(request, env, now);
  assert.deepEqual(accepted.user, { name: 'calpher', role: 'admin' });

  const expired = new Request('https://child.example/', {
    headers: { Cookie: `calpher_auth=${encodeURIComponent(await createSession(env, { name: 'old' }, 0))}` },
  });
  assert.equal((await authenticate(expired, env, now)).user, null);
});

test('authentication accepts a valid duplicate cookie after stale and malformed values', async () => {
  const sid = await createSession(env, { name: 'calpher', role: 'admin' }, now);
  const request = new Request('https://child.example/', {
    headers: {
      Cookie: [
        'calpher_auth=stale.invalid',
        'calpher_auth=%E0%A4%A',
        `calpher_auth=${encodeURIComponent(sid)}`,
      ].join('; '),
    },
  });
  const accepted = await authenticate(request, env, now);
  assert.deepEqual(accepted.user, { name: 'calpher', role: 'admin' });
  assert.equal(accepted.sid, sid);
});

test('handoff is bound to exact audience and expiry', async () => {
  const target = 'https://child.example/dashboard?embed=1';
  const ticket = await createHandoffTicket(
    env,
    { name: 'calpher', role: 'admin' },
    'https://child.example',
    target,
    now,
  );
  const accepted = await verifyHandoffTicket(env, ticket, 'https://child.example', now + 30_000);
  assert.equal(accepted.returnUrl, target);
  assert.deepEqual(accepted.user, { name: 'calpher', role: 'admin' });
  assert.equal(await verifyHandoffTicket(env, ticket, 'https://other.example', now + 30_000), null);
  assert.equal(await verifyHandoffTicket(env, ticket, 'https://child.example', now + 120_000), null);
});

test('cookie attributes support unrelated, embedded, and parent-scoped deployments', async () => {
  const sid = await createSession(env, { name: 'calpher' }, now);
  const unrelated = buildSessionCookie(
    sid,
    new Request('https://socks.kypher.kdns.fr/'),
    {
      ...env,
      AUTH_MASTER_ORIGIN: 'https://main.example',
      PARENT_DOMAIN: 'kypher72.indevs.in',
    },
  );
  assert.doesNotMatch(unrelated, /Domain=/);
  assert.match(unrelated, /SameSite=None/);

  const embedded = buildSessionCookie(
    sid,
    new Request('https://socks.kypher.kdns.fr/'),
    {
      ...env,
      AUTH_MASTER_ORIGIN: 'https://main.example',
      PARENT_DOMAIN: 'kypher72.indevs.in',
    },
    { partitioned: true },
  );
  assert.match(embedded, /SameSite=None/);
  assert.match(embedded, /Partitioned/);

  const related = buildSessionCookie(
    sid,
    new Request('https://socks.kypher72.indevs.in/'),
    { ...env, PARENT_DOMAIN: 'kypher72.indevs.in' },
  );
  assert.match(related, /Domain=kypher72\.indevs\.in/);
  assert.match(related, /SameSite=Lax/);
  assert.doesNotMatch(related, /Partitioned/);
});

test('master login URL can return browser API failures to a page instead of the API URL', () => {
  const request = new Request('https://child.example/api/config');
  const login = buildMasterLoginUrl(
    request,
    { AUTH_MASTER_ORIGIN: 'https://main.example' },
    'https://child.example/',
  );
  assert.equal(
    login,
    'https://main.example/login?redirect=https%3A%2F%2Fchild.example%2F',
  );
});

test('admin credentials remain plaintext environment variable credentials', async () => {
  const result = await loginByMaster({
    AUTH_COOKIE_SECRET: 'session-secret',
    AUTH_MASTER_NAME: 'admin',
    AUTH_MASTER_PASS: 'plain-env-password',
  }, 'admin', 'plain-env-password');
  assert.equal(result.ok, true);
  assert.deepEqual(result.user, { name: 'admin', role: 'admin' });
});

test('member credentials are salted and verify through KV', async () => {
  const localEnv = memberEnv();
  await createMember(localEnv, { name: 'alice', password: 'member-pass-123' });
  const raw = JSON.parse(localEnv.WORKBENCH_KV.values.get('member:alice'));
  assert.notEqual(raw.credential.hash, 'member-pass-123');
  assert.notEqual(raw.passwordVault.ciphertext, 'member-pass-123');
  assert.equal(raw.credential.iterations, 100000);
  assert.equal((await verifyMemberLogin(localEnv, 'alice', 'member-pass-123')).name, 'alice');
  assert.equal(await getMemberPassword(localEnv, 'alice'), 'member-pass-123');
  assert.equal(await verifyMemberLogin(localEnv, 'alice', 'wrong-pass'), null);
});

test('member default quotas are enforced and can be expanded by admin', async () => {
  const localEnv = memberEnv();
  const member = await createMember(localEnv, { name: 'quota-user', password: 'member-pass-123' });
  assert.equal(member.integrationLimit, 3);
  assert.equal(member.shortcutLimit, 10);

  for (let i = 0; i < 3; i++) {
    await addIntegration(localEnv, member.name, {
      name: `App ${i}`,
      url: `https://app-${i}.example.com`,
    }, member.integrationLimit);
  }
  await assert.rejects(
    addIntegration(localEnv, member.name, {
      name: 'App 4',
      url: 'https://app-4.example.com',
    }, member.integrationLimit),
    /上限 3/,
  );

  const expanded = await updateMember(localEnv, member.name, {
    integrationLimit: 5,
    shortcutLimit: 12,
  });
  await addIntegration(localEnv, member.name, {
    name: 'App 4',
    url: 'https://app-4.example.com',
  }, expanded.integrationLimit);
  assert.equal((await getWorkspace(localEnv, member.name)).integrations.length, 4);
});

test('workspace records are isolated and shortcuts do not contain auth secrets', async () => {
  const localEnv = memberEnv();
  await createMember(localEnv, { name: 'alice', password: 'member-pass-123' });
  await createMember(localEnv, { name: 'bobby', password: 'member-pass-456' });
  const integration = await addIntegration(localEnv, 'alice', {
    name: 'Alice child',
    url: 'https://alice-child.example.com',
  }, 3);
  const shortcut = await addShortcut(localEnv, 'bobby', {
    name: 'Docs',
    url: 'https://docs.example.com',
  }, 10);
  assert.ok(integration.secret.length >= 24);
  assert.equal(shortcut.secret, undefined);
  assert.equal((await getWorkspace(localEnv, 'alice')).shortcuts.length, 0);
  assert.equal((await getWorkspace(localEnv, 'bobby')).integrations.length, 0);
});

test('workspace items preserve descriptions and details when edited', async () => {
  const localEnv = memberEnv();
  await createMember(localEnv, { name: 'editor', password: 'member-pass-123' });
  const navigation = await addShortcut(localEnv, 'editor', {
    name: 'Docs',
    url: 'https://docs.example.com',
    description: '旧简介',
  }, 10);
  const updated = await updateWorkspaceItem(localEnv, 'editor', 'shortcut', navigation.id, {
    name: 'Reference',
    url: 'https://reference.example.com/path',
    description: '网站简介',
    details: '更长的导航说明',
    icon: 'book',
  });
  assert.equal(updated.name, 'Reference');
  assert.equal(updated.description, '网站简介');
  assert.equal(updated.details, '更长的导航说明');
  assert.equal(updated.icon, 'book');
  assert.equal((await getWorkspace(localEnv, 'editor')).shortcuts[0].url, 'https://reference.example.com/path');
});

test('integration preload preference is persisted and defaults to false', async () => {
  const localEnv = memberEnv();
  await createMember(localEnv, { name: 'preload-user', password: 'member-pass-123' });
  const onDemand = await addIntegration(localEnv, 'preload-user', {
    name: 'On demand',
    url: 'https://on-demand.example.com',
  }, 3);
  const preloaded = await addIntegration(localEnv, 'preload-user', {
    name: 'Preloaded',
    url: 'https://preloaded.example.com',
    preload: true,
  }, 3);
  assert.equal(onDemand.preload, false);
  assert.equal(preloaded.preload, true);
  const disabled = await updateWorkspaceItem(localEnv, 'preload-user', 'integration', preloaded.id, { preload: false });
  assert.equal(disabled.preload, false);
});

test('deleting a member also deletes their workspace', async () => {
  const localEnv = memberEnv();
  await createMember(localEnv, { name: 'cleanup-user', password: 'member-pass-123' });
  await addShortcut(localEnv, 'cleanup-user', {
    name: 'Docs',
    url: 'https://docs.example.com',
  }, 10);
  await deleteMember(localEnv, 'cleanup-user');
  assert.equal(localEnv.WORKBENCH_KV.values.has('member:cleanup-user'), false);
  assert.equal(localEnv.WORKBENCH_KV.values.has('workspace:cleanup-user'), false);
});

test('member rename migrates workspace and password changes remain revealable', async () => {
  const localEnv = memberEnv();
  await createMember(localEnv, { name: 'old-name', password: 'member-pass-123' });
  await addShortcut(localEnv, 'old-name', { name: 'Docs', url: 'https://docs.example.com' }, 10);
  await updateOwnMember(localEnv, 'old-name', { name: 'new-name', password: 'member-pass-456' });
  assert.equal(localEnv.WORKBENCH_KV.values.has('member:old-name'), false);
  assert.equal((await getWorkspace(localEnv, 'new-name')).shortcuts.length, 1);
  assert.equal(await getMemberPassword(localEnv, 'new-name'), 'member-pass-456');
});

test('a personal integration secret signs only that child handoff', async () => {
  const personalSecret = 'personal-integration-secret-123456';
  const target = 'https://personal-child.example.com/?theme=light';
  const ticket = await createHandoffTicket(
    env,
    { name: 'alice', role: 'user' },
    'https://personal-child.example.com',
    target,
    now,
    personalSecret,
  );
  const accepted = await verifyHandoffTicket(
    env,
    ticket,
    'https://personal-child.example.com',
    now + 10_000,
    personalSecret,
  );
  assert.equal(accepted.user.name, 'alice');
  assert.equal(await verifyHandoffTicket(env, ticket, 'https://personal-child.example.com', now + 10_000), null);
});

test('platform integrations are admin-only, isolated, visible, and deletable', async () => {
  const localEnv = memberEnv();
  const registry = {
    workbench: { name: 'Home', url: '/' },
    socks: { name: 'Socks', url: 'https://socks.example.com' },
    sub: { name: 'Sub', url: 'https://sub.example.com' },
  };
  assert.deepEqual(await platformIntegrations(localEnv, registry, 'user'), []);
  const items = await platformIntegrations(localEnv, registry, 'admin');
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'global-socks');
  assert.equal(items[0].readonly, false);
  assert.ok(items[0].secret.length >= 24);
  assert.notEqual(items[0].secret, items[1].secret);
  await removePlatformIntegration(localEnv, 'global-socks');
  assert.deepEqual((await platformIntegrations(localEnv, registry, 'admin')).map((item) => item.id), ['global-sub']);
});
