import indexHtml from './static/index.html';
import homeHtml from './static/home.html';
import homeCss from './static/home.css';
import homeBundleJs from './static/home.bundle.js';
import workbenchMotionJs from './static/workbench-motion.bundle.js';
import workbenchHero from './static/assets/workbench-hero.webp';
import stylesCss from './design-system/styles.css';
import componentsJs from './design-system/components.js';
import appJs from './static/app.js';
import appsJson from './apps.json';
import {
  authenticate, loginByMaster, buildSessionCookie, buildLogoutCookie,
  createHandoffTicket, createSession,
} from './auth/auth.js';
import {
  addIntegration, addShortcut, createMember, deleteMember, getMember, getWorkspace, limitsFor,
  getMemberPassword, listMembers, publicMember, removeWorkspaceItem, updateMember,
  updateOwnMember, updateWorkspaceItem, verifyMemberLogin,
} from './data/store.js';
import {
  platformIntegrations, removePlatformIntegration, updatePlatformIntegration,
} from './data/registry.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function readRegistry() {
  try { return JSON.parse(appsJson); } catch (e) { return {}; }
}

function globalApps() {
  return readRegistry();
}

async function currentUser(request, env) {
  const auth = await authenticate(request, env);
  if (!auth.user) return auth;
  if (auth.user.role === 'admin') {
    const expectedName = env.AUTH_MASTER_NAME || 'admin';
    return auth.user.name === expectedName ? auth : { user: null, sid: null };
  }
  const member = await getMember(env, auth.user.name);
  return member && !member.disabled ? { ...auth, member } : { user: null, sid: null };
}

async function effectiveContext(request, env, requestedName = '') {
  const auth = await currentUser(request, env);
  if (!auth.user) return null;
  if (!requestedName || requestedName === auth.user.name) {
    return { actor: auth.user, user: auth.user, member: auth.member || null, viewing: false };
  }
  if (auth.user.role !== 'admin') return null;
  const member = await getMember(env, requestedName);
  if (!member || member.disabled) return null;
  return {
    actor: auth.user,
    user: { name: member.name, role: 'user' },
    member,
    viewing: true,
  };
}

async function workspacePayload(env, context) {
  const registry = globalApps();
  const stored = await getWorkspace(env, context.user.name);
  const apps = {};
  const home = registry.workbench || {
    name: '个人工作台',
    url: '/workbench',
    icon: 'home',
    description: 'Calpher 个人工作台首页',
  };
  apps.workbench = { ...home, kind: 'workbench' };
  for (const app of await platformIntegrations(env, registry, context.user.role)) {
    apps[app.id] = app;
  }
  for (const item of stored.integrations) {
    apps[item.id] = { ...item, secret: undefined, source: 'personal' };
  }
  for (const item of stored.shortcuts) {
    apps[item.id] = { ...item, source: 'personal' };
  }
  const limits = limitsFor(context.user, context.member);
  return {
    apps,
    user: context.actor,
    workspaceUser: context.user,
    viewing: context.viewing,
    limits: {
      ...limits,
      integrationsUsed: stored.integrations.length,
      shortcutsUsed: stored.shortcuts.length,
    },
  };
}

async function childOrigins(env, user) {
  const origins = [];
  if (user && user.role === 'admin') {
    origins.push(...(await platformIntegrations(env, globalApps(), user.role)).map((app) => app.url));
  }
  if (user) {
    const workspace = await getWorkspace(env, user.name);
    origins.push(...workspace.integrations.map((item) => item.url));
  }
  return [...new Set(
    origins
      .filter((value) => value && value !== '/')
      .map((value) => { try { return new URL(value).origin; } catch (e) { return ''; } })
      .filter(Boolean),
  )];
}

function logoutOrchestratorHtml(origins, masterOrigin) {
  const targets = origins.map((origin) => `${origin}/api/auth/logout?partitioned=1`);
  const next = new URL('/api/auth/logout?step=0', masterOrigin).toString();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="color-scheme" content="dark light"><title>正在退出</title>
<style>body{min-height:100vh;margin:0;display:grid;place-items:center;background:#080d0b;color:#dbe5e0;font:14px system-ui,sans-serif}p{padding:20px 24px;border:1px solid #26342d;border-radius:8px;background:#111915}</style>
</head><body><p>正在安全退出所有子项目…</p>
<script>
const targets=${JSON.stringify(targets)};let done=0;let moved=false;
function finish(){if(moved)return;moved=true;location.replace(${JSON.stringify(next)});}
if(!targets.length)finish();
for(const src of targets){const frame=document.createElement('iframe');frame.hidden=true;frame.onload=()=>{done+=1;if(done>=targets.length)finish();};frame.src=src;document.body.appendChild(frame);}
setTimeout(finish,2500);
</script></body></html>`;
}

async function allowedExternalTarget(env, raw, requestOrigin, user) {
  if (!raw) return null;
  let target;
  try { target = new URL(raw, requestOrigin); } catch (e) { return null; }
  if (target.origin === requestOrigin) {
    return { target, secret: String(env.AUTH_COOKIE_SECRET || ''), source: 'local' };
  }
  if (target.protocol !== 'https:') return null;
  if (!user) return null;
  if (user.role === 'admin') {
    const global = (await platformIntegrations(env, globalApps(), user.role)).find((app) => {
      try { return new URL(app.url).origin === target.origin; } catch (e) { return false; }
    });
    if (global) return { target, secret: global.secret, source: 'global', id: global.id };
  }
  const workspace = await getWorkspace(env, user.name);
  const integration = workspace.integrations.find((item) => {
    try { return new URL(item.url).origin === target.origin; } catch (e) { return false; }
  });
  return integration ? { target, secret: integration.secret, source: 'personal' } : null;
}

function mutationAllowed(request, origin) {
  const requestOrigin = request.headers.get('Origin');
  return !requestOrigin || requestOrigin === origin;
}

function requestedWorkspace(url) {
  const direct = url.searchParams.get('as');
  if (direct) return direct;
  try {
    const target = new URL(url.searchParams.get('redirect'));
    return target.searchParams.get('calpher_owner') || '';
  } catch (e) {
    return '';
  }
}

function apiError(error, fallback = '请求失败') {
  return json({ error: error instanceof Error ? error.message : fallback }, 400);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // 登录页（无需鉴权）
    if (method === 'GET' && url.pathname === '/login') {
      const context = await effectiveContext(request, env, requestedWorkspace(url));
      if (context) {
        const allowed = await allowedExternalTarget(
          env, url.searchParams.get('redirect'), url.origin, context.user,
        );
        if (!allowed || allowed.target.origin === url.origin) {
          return Response.redirect(allowed ? allowed.target.toString() : new URL('/workbench', url.origin).toString(), 302);
        }
        const handoff = new URL('/api/auth/handoff', url.origin);
        handoff.searchParams.set('redirect', allowed.target.toString());
        if (context.viewing) handoff.searchParams.set('as', context.user.name);
        return Response.redirect(handoff.toString(), 302);
      }
      const home = new URL('/', url.origin);
      home.searchParams.set('login', '1');
      const redirect = url.searchParams.get('redirect');
      if (redirect) home.searchParams.set('redirect', redirect);
      home.hash = 'login';
      return Response.redirect(home.toString(), 302);
    }

    // 静态资源（仅 GET）
    if (method === 'GET' && url.pathname === '/assets/home.css') {
      return new Response(homeCss, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (method === 'GET' && url.pathname === '/assets/home.bundle.js') {
      return new Response(homeBundleJs, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (method === 'GET' && url.pathname === '/assets/workbench-motion.bundle.js') {
      return new Response(workbenchMotionJs, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (method === 'GET' && url.pathname === '/assets/workbench-hero.webp') {
      return new Response(workbenchHero, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }
    if (method === 'GET' && url.pathname === '/assets/styles.css') {
      return new Response(stylesCss, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (method === 'GET' && url.pathname === '/assets/components.js') {
      return new Response(componentsJs, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (method === 'GET' && url.pathname === '/app.js') {
      return new Response(appJs, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }
    if (method === 'GET' && url.pathname === '/favicon.svg') {
      return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b1210"/><path d="M42 18a18 18 0 1 0 0 28" fill="none" stroke="#2aa9e8" stroke-width="8" stroke-linecap="round"/><path d="M32 20v24M20 32h24" stroke="#f5f7f6" stroke-width="5" stroke-linecap="round"/></svg>`, {
        headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    // 公共门户
    if (method === 'GET' && url.pathname === '/') {
      return new Response(homeHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }
    if (method === 'GET' && url.pathname === '/index.html') {
      return Response.redirect(new URL('/', url.origin).toString(), 302);
    }

    // 已登录工作台
    if (method === 'GET' && url.pathname === '/workbench') {
      const { user } = await currentUser(request, env);
      if (!user) {
        const home = new URL('/', url.origin);
        home.searchParams.set('login', '1');
        home.searchParams.set('redirect', '/workbench');
        home.hash = 'login';
        return Response.redirect(home.toString(), 302);
      }
      return new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }

    if (url.pathname === '/api/workspace' && method === 'GET') {
      const context = await effectiveContext(request, env, requestedWorkspace(url));
      if (!context) return json({ error: '未登录或无权查看该工作台' }, 401);
      return json(await workspacePayload(env, context), 200, { 'Cache-Control': 'no-store' });
    }

    // 兼容旧客户端，只返回当前账号可见项目。
    if (url.pathname === '/api/apps' && method === 'GET') {
      const context = await effectiveContext(request, env, requestedWorkspace(url));
      if (!context) return json({ error: '未登录' }, 401);
      return json((await workspacePayload(env, context)).apps);
    }

    // 鉴权 API
    if (url.pathname === '/api/auth/login' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { name, pass } = body;
      let result = await loginByMaster(env, name, pass);
      if (!result.ok) {
        const member = await verifyMemberLogin(env, name, pass);
        if (member) {
          const user = { name: member.name, role: 'user' };
          result = { ok: true, user, sid: await createSession(env, user) };
        }
      }
      if (!result.ok) return json({ error: '账号或密码错误' }, 401);
      return json({ name: result.user.name, role: result.user.role }, 200, {
        'Set-Cookie': buildSessionCookie(result.sid, request, env),
      });
    }
    if (url.pathname === '/api/auth/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': buildLogoutCookie(request, env) });
    }
    if (url.pathname === '/api/auth/logout' && method === 'GET') {
      const auth = await currentUser(request, env);
      const origins = await childOrigins(env, auth.user);
      const stepValue = url.searchParams.get('step');
      if (stepValue === null) {
        return new Response(logoutOrchestratorHtml(origins, url.origin), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }
      const step = Number.parseInt(stepValue, 10);
      if (!Number.isInteger(step) || step < 0) return json({ error: 'logout step 无效' }, 400);
      if (step >= origins.length) {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': new URL('/?login=1#login', url.origin).toString(),
            'Cache-Control': 'no-store',
            'Set-Cookie': buildLogoutCookie(request, env),
          },
        });
      }
      const childLogout = new URL('/api/auth/logout', origins[step]);
      childLogout.searchParams.set('return', new URL(`/api/auth/logout?step=${step + 1}`, url.origin).toString());
      return new Response(null, {
        status: 302,
        headers: {
          'Location': childLogout.toString(),
          'Cache-Control': 'no-store',
        },
      });
    }
    if (url.pathname === '/api/me' && method === 'GET') {
      const { user } = await currentUser(request, env);
      if (!user) return json({ error: '未登录' }, 401);
      return json({ name: user.name, role: user.role });
    }
    if (url.pathname === '/api/integrations' && method === 'GET') {
      const context = await effectiveContext(request, env, url.searchParams.get('as') || '');
      if (!context) return json({ error: '未登录或无权查看' }, 401);
      const workspace = await getWorkspace(env, context.user.name);
      return json({
        items: workspace.integrations,
        platformItems: await platformIntegrations(env, globalApps(), context.user.role),
        ...limitsFor(context.user, context.member),
        owner: context.user.name,
      }, 200, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/api/integrations' && method === 'POST') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const body = await request.json().catch(() => ({}));
      const context = await effectiveContext(request, env, body.as || '');
      if (!context) return json({ error: '未登录或无权操作' }, 401);
      try {
        const limits = limitsFor(context.user, context.member);
        return json(await addIntegration(env, context.user.name, body, limits.integrationLimit), 201);
      } catch (e) { return apiError(e); }
    }
    if (url.pathname.startsWith('/api/integrations/') && method === 'DELETE') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const context = await effectiveContext(request, env, url.searchParams.get('as') || '');
      if (!context) return json({ error: '未登录或无权操作' }, 401);
      try {
        const id = decodeURIComponent(url.pathname.slice(18));
        if (id.startsWith('global-')) {
          if (context.actor.role !== 'admin' || context.viewing) {
            return json({ error: '仅管理员可删除自己的平台子站接入' }, 403);
          }
          await removePlatformIntegration(env, id);
        } else {
          await removeWorkspaceItem(env, context.user.name, 'integration', id);
        }
        return json({ ok: true });
      } catch (e) { return apiError(e); }
    }
    if (url.pathname.startsWith('/api/integrations/') && method === 'PATCH') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const body = await request.json().catch(() => ({}));
      const context = await effectiveContext(request, env, body.as || url.searchParams.get('as') || '');
      if (!context) return json({ error: '未登录或无权操作' }, 401);
      const id = decodeURIComponent(url.pathname.slice(18));
      if (id.startsWith('global-')) {
        if (context.actor.role !== 'admin' || context.viewing) {
          return json({ error: '仅管理员可修改自己的平台子站接入' }, 403);
        }
        try {
          return json(await updatePlatformIntegration(env, id, { preload: body.preload }));
        } catch (e) { return apiError(e); }
      }
      try {
        return json(await updateWorkspaceItem(env, context.user.name, 'integration', id, body));
      } catch (e) { return apiError(e); }
    }
    if (url.pathname === '/api/shortcuts' && method === 'GET') {
      const context = await effectiveContext(request, env, url.searchParams.get('as') || '');
      if (!context) return json({ error: '未登录或无权查看' }, 401);
      const workspace = await getWorkspace(env, context.user.name);
      return json({
        items: workspace.shortcuts,
        ...limitsFor(context.user, context.member),
        owner: context.user.name,
      }, 200, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/api/shortcuts' && method === 'POST') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const body = await request.json().catch(() => ({}));
      const context = await effectiveContext(request, env, body.as || '');
      if (!context) return json({ error: '未登录或无权操作' }, 401);
      try {
        const limits = limitsFor(context.user, context.member);
        return json(await addShortcut(env, context.user.name, body, limits.shortcutLimit), 201);
      } catch (e) { return apiError(e); }
    }
    if (url.pathname.startsWith('/api/shortcuts/') && method === 'DELETE') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const context = await effectiveContext(request, env, url.searchParams.get('as') || '');
      if (!context) return json({ error: '未登录或无权操作' }, 401);
      try {
        await removeWorkspaceItem(env, context.user.name, 'shortcut', decodeURIComponent(url.pathname.slice(15)));
        return json({ ok: true });
      } catch (e) { return apiError(e); }
    }
    if (url.pathname.startsWith('/api/shortcuts/') && method === 'PATCH') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const body = await request.json().catch(() => ({}));
      const context = await effectiveContext(request, env, body.as || url.searchParams.get('as') || '');
      if (!context) return json({ error: '未登录或无权操作' }, 401);
      try {
        const id = decodeURIComponent(url.pathname.slice(15));
        return json(await updateWorkspaceItem(env, context.user.name, 'shortcut', id, body));
      } catch (e) { return apiError(e); }
    }
    if (url.pathname === '/api/admin/members' && method === 'GET') {
      const { user } = await currentUser(request, env);
      if (!user || user.role !== 'admin') return json({ error: '仅管理员可访问' }, 403);
      return json({ items: (await listMembers(env)).map(publicMember) }, 200, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/api/admin/members' && method === 'POST') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const { user } = await currentUser(request, env);
      if (!user || user.role !== 'admin') return json({ error: '仅管理员可操作' }, 403);
      try {
        const body = await request.json();
        if (String(body.name || '').trim() === (env.AUTH_MASTER_NAME || 'admin')) {
          return json({ error: '普通成员账号不能与管理员账号相同' }, 400);
        }
        return json(await createMember(env, body), 201);
      } catch (e) { return apiError(e); }
    }
    if (url.pathname.startsWith('/api/admin/members/')
      && url.pathname.endsWith('/password') && method === 'GET') {
      const { user } = await currentUser(request, env);
      if (!user || user.role !== 'admin') return json({ error: '仅管理员可查看' }, 403);
      try {
        const path = url.pathname.slice('/api/admin/members/'.length, -'/password'.length);
        return json({ password: await getMemberPassword(env, decodeURIComponent(path)) }, 200, {
          'Cache-Control': 'no-store',
        });
      } catch (e) { return apiError(e); }
    }
    if (url.pathname.startsWith('/api/admin/members/') && method === 'PATCH') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const { user } = await currentUser(request, env);
      if (!user || user.role !== 'admin') return json({ error: '仅管理员可操作' }, 403);
      try {
        const name = decodeURIComponent(url.pathname.slice('/api/admin/members/'.length));
        return json(await updateMember(env, name, await request.json()));
      } catch (e) { return apiError(e); }
    }
    if (url.pathname === '/api/account' && method === 'PATCH') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const auth = await currentUser(request, env);
      if (!auth.user) return json({ error: '未登录' }, 401);
      if (auth.user.role === 'admin') return json({ error: '管理员账号由 Cloudflare 环境变量维护' }, 403);
      try {
        const body = await request.json().catch(() => ({}));
        if (String(body.name || '').trim() === (env.AUTH_MASTER_NAME || 'admin')) {
          return json({ error: '普通成员账号不能与管理员账号相同' }, 400);
        }
        const member = await updateOwnMember(env, auth.user.name, body);
        const user = { name: member.name, role: 'user' };
        const sid = await createSession(env, user);
        return json({ user }, 200, {
          'Cache-Control': 'no-store',
          'Set-Cookie': buildSessionCookie(sid, request, env),
        });
      } catch (e) { return apiError(e); }
    }
    if (url.pathname === '/api/account' && method === 'DELETE') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const auth = await currentUser(request, env);
      if (!auth.user) return json({ error: '未登录' }, 401);
      if (auth.user.role === 'admin') return json({ error: '管理员账号不能在工作台删除' }, 403);
      try {
        await deleteMember(env, auth.user.name);
        return json({ ok: true }, 200, {
          'Cache-Control': 'no-store',
          'Set-Cookie': buildLogoutCookie(request, env),
        });
      } catch (e) { return apiError(e); }
    }
    if (url.pathname.startsWith('/api/admin/members/') && method === 'DELETE') {
      if (!mutationAllowed(request, url.origin)) return json({ error: 'Origin 校验失败' }, 403);
      const { user } = await currentUser(request, env);
      if (!user || user.role !== 'admin') return json({ error: '仅管理员可操作' }, 403);
      try {
        const name = decodeURIComponent(url.pathname.slice('/api/admin/members/'.length));
        await deleteMember(env, name);
        return json({ ok: true });
      } catch (e) { return apiError(e); }
    }
    if (url.pathname === '/api/auth/handoff' && method === 'GET') {
      const context = await effectiveContext(request, env, requestedWorkspace(url));
      if (!context) {
        const login = new URL('/login', url.origin);
        const redirect = url.searchParams.get('redirect');
        if (redirect) login.searchParams.set('redirect', redirect);
        return Response.redirect(login.toString(), 302);
      }
      const allowed = await allowedExternalTarget(
        env, url.searchParams.get('redirect'), url.origin, context.user,
      );
      if (!allowed) return json({ error: 'redirect 不在当前账号的接入白名单中' }, 400);
      if (allowed.target.origin === url.origin) return Response.redirect(allowed.target.toString(), 302);
      const ticket = await createHandoffTicket(
        env, context.user, allowed.target.origin, allowed.target.toString(), Date.now(), allowed.secret,
      );
      const callback = new URL('/.calpher/auth/callback', allowed.target.origin);
      callback.searchParams.set('ticket', ticket);
      return Response.redirect(callback.toString(), 302);
    }
    if (url.pathname === '/api/auth/embed-handoff' && method === 'GET') {
      const context = await effectiveContext(request, env, requestedWorkspace(url));
      if (!context) return json({ error: '未登录或无权查看该工作台' }, 401);
      const allowed = await allowedExternalTarget(
        env, url.searchParams.get('redirect'), url.origin, context.user,
      );
      if (!allowed || allowed.target.origin === url.origin) {
        return json({ error: '嵌入地址不在当前账号的接入白名单中' }, 400);
      }
      allowed.target.searchParams.set('embed', '1');
      const ticket = await createHandoffTicket(
        env, context.user, allowed.target.origin, allowed.target.toString(), Date.now(), allowed.secret,
      );
      const callback = new URL('/.calpher/auth/callback', allowed.target.origin);
      callback.searchParams.set('ticket', ticket);
      return json({ url: callback.toString() }, 200, { 'Cache-Control': 'no-store' });
    }

    return new Response('not found', { status: 404 });
  },
};
