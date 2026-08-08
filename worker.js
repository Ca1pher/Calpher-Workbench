import indexHtml from './static/index.html';
import loginHtml from './static/login.html';
import stylesCss from './design-system/styles.css';
import componentsJs from './design-system/components.js';
import appJs from './static/app.js';
import appsJson from './apps.json';
import {
  authenticate, loginByMaster, buildSessionCookie, buildLogoutCookie,
  handleAuthSync,
} from './auth/auth.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request, env, ctx) {
    globalThis.PARENT_DOMAIN = env.PARENT_DOMAIN || 'example.dev';
    const url = new URL(request.url);
    const method = request.method;

    // 登录页（无需鉴权）
    if (method === 'GET' && url.pathname === '/login') {
      return new Response(loginHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }

    // 静态资源（仅 GET）
    if (method === 'GET' && url.pathname === '/assets/styles.css') {
      return new Response(stylesCss, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (method === 'GET' && url.pathname === '/assets/components.js') {
      return new Response(componentsJs, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (method === 'GET' && url.pathname === '/app.js') {
      return new Response(appJs, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }

    // 工作台首页：未登录重定向到登录页
    if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const { user } = await authenticate(request, env);
      if (!user) {
        return Response.redirect(new URL('/login', url.origin).toString(), 302);
      }
      return new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }

    // 项目注册表：需登录
    if (url.pathname === '/api/apps' && method === 'GET') {
      const { user } = await authenticate(request, env);
      if (!user) return json({ error: '未登录' }, 401);
      // apps.json 经 Text rule 导入为字符串，需先解析
      return json(JSON.parse(appsJson));
    }

    // 鉴权 API
    if (url.pathname === '/api/auth/login' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { name, pass } = body;
      const result = await loginByMaster(env, name, pass);
      if (!result.ok) return json({ error: '账号或密码错误' }, 401);
      return json({ name: result.user.name, role: result.user.role }, 200, {
        'Set-Cookie': buildSessionCookie(result.sid),
      });
    }
    if (url.pathname === '/api/auth/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': buildLogoutCookie() });
    }
    if (url.pathname === '/api/me' && method === 'GET') {
      const { user } = await authenticate(request, env);
      if (!user) return json({ error: '未登录' }, 401);
      return json({ name: user.name, role: user.role });
    }
    if (url.pathname === '/api/auth/sync' && method === 'POST') {
      return handleAuthSync(request, env);
    }

    return new Response('not found', { status: 404 });
  },
};
