import { randomSecret } from './store.js';

function requireKv(env) {
  if (!env.WORKBENCH_KV) throw new Error('WORKBENCH_KV 未配置');
  return env.WORKBENCH_KV;
}

function platformKey(id) {
  return `platform-integration:${id}`;
}

export async function platformIntegrations(env, registry, role, options = {}) {
  if (role !== 'admin' || !registry || typeof registry !== 'object') return [];
  const includeDeleted = Boolean(options.includeDeleted);
  const result = [];
  for (const [id, app] of Object.entries(registry)) {
    if (id === 'workbench') continue;
    const key = platformKey(id);
    let stored = await requireKv(env).get(key, 'json');
    if (!stored) {
      stored = {
        id: `global-${id}`,
        secret: randomSecret(),
        deleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await requireKv(env).put(key, JSON.stringify(stored));
    }
    if (stored.deleted && !includeDeleted) continue;
    result.push({
      ...(app || {}),
      id: `global-${id}`,
      kind: 'integration',
      source: 'global',
      readonly: false,
      secret: stored.secret,
      deleted: Boolean(stored.deleted),
    });
  }
  return result;
}

export async function removePlatformIntegration(env, id) {
  const registryId = String(id || '').replace(/^global-/, '');
  const key = platformKey(registryId);
  const stored = await requireKv(env).get(key, 'json');
  if (!stored || stored.deleted) throw new Error('平台子站不存在');
  stored.deleted = true;
  stored.updatedAt = new Date().toISOString();
  await requireKv(env).put(key, JSON.stringify(stored));
}
