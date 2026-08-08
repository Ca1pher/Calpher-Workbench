(async function () {
  const state = { apps: {}, user: null };

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  async function loadApps() {
    const data = await fetchJSON('/api/apps');
    state.apps = data || {};
    renderNav();
    renderMetrics();
    renderGrid();
  }

  function renderNav() {
    const nav = document.getElementById('primaryNav');
    const entries = Object.entries(state.apps);
    nav.innerHTML = entries.map(([id, app]) =>
      `<button class="cn-nav-item ${id === 'workbench' ? 'active' : ''}" data-id="${id}">
         <span class="cn-live-dot"></span><span>${app.name}</span>
       </button>`
    ).join('');
  }

  function renderMetrics() {
    const grid = document.getElementById('metricGrid');
    const count = Object.keys(state.apps).length;
    grid.innerHTML = [
      `<article class="cn-metric-card"><h3>PROJECTS / 项目</h3><strong>${count}</strong><p>已接入工作台</p></article>`,
      `<article class="cn-metric-card"><h3>AUTH / 登录</h3><strong>${state.user ? 'ON' : 'OFF'}</strong><p>${state.user ? state.user.name : '未登录'}</p></article>`,
    ].join('');
  }

  function renderGrid() {
    const grid = document.getElementById('projectGrid');
    grid.innerHTML = Object.entries(state.apps).map(([id, app]) =>
      `<a class="cn-project-card" href="${app.url}" target="_blank" rel="noopener">
         <h4>${app.name}</h4><p>${app.description || ''}</p>
       </a>`
    ).join('');
  }

  async function checkAuth() {
    try {
      state.user = await fetchJSON('/api/me');
    } catch (e) {
      state.user = null;
    }
    renderUser();
  }

  function renderUser() {
    const box = document.getElementById('userBox');
    box.innerHTML = state.user
      ? `<div style="padding:12px"><b>${state.user.name}</b><small>${state.user.role}</small></div>`
      : `<button class="cn-btn cn-btn-primary" id="loginBtn">登录</button>`;
    const btn = document.getElementById('loginBtn');
    if (btn) btn.addEventListener('click', showLogin);
  }

  function showLogin() {
    const body = `<div style="display:flex;flex-direction:column;gap:10px">
      <input id="loginName" placeholder="账号" style="padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text)" />
      <input id="loginPass" type="password" placeholder="密码" style="padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text)" />
    </div>`;
    Cn.openModal({
      title: '登录',
      body,
      buttons: [
        { text: '取消', onClick: Cn.closeModal },
        { text: '登录', primary: true, onClick: doLogin },
      ],
    });
  }

  async function doLogin() {
    const name = document.getElementById('loginName').value.trim();
    const pass = document.getElementById('loginPass').value;
    try {
      state.user = await fetchJSON('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ name, pass }),
      });
      Cn.closeModal();
      Cn.toast('登录成功');
      renderUser();
      renderMetrics();
    } catch (e) {
      Cn.toast('登录失败: ' + e.message);
    }
  }

  try { await checkAuth(); } catch (e) {}
  try { await loadApps(); } catch (e) { Cn.toast('加载项目失败'); }
  Cn.initThemeToggle('#themeToggleBtn');
})();
