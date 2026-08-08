(async function () {
  const state = { apps: {}, user: null, selected: 'workbench', view: { mode: 'local' } };
  const $ = (id) => document.getElementById(id);

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  function openApp(app, id) {
    if (!app.url) return;
    if (app.url === '/' || app.url === '') { location.href = '/'; return; }
    window.open(app.url, '_blank', 'noopener');
  }

  function embedUrl(app) {
    return app.url + (app.url.includes('?') ? '&' : '?') + 'embed=1';
  }

  function enterEmbed(id) {
    const app = state.apps[id];
    if (!app || !app.url || app.url === '/') return;
    state.view = { mode: 'embed', id };
    $('embedOpen').href = app.url;
    $('embedTitle').textContent = app.name;
    $('pageTitleMain').textContent = app.name;
    $('embedLoading').style.display = 'grid';
    $('embedFrame').src = embedUrl(app);
    document.getElementById('appShell').classList.add('embed-view');
    selectDetail(id);
  }

  function exitEmbed() {
    state.view = { mode: 'local' };
    $('embedFrame').removeAttribute('src');
    $('embedTitle').textContent = '加载中…';
    document.getElementById('appShell').classList.remove('embed-view');
    $('pageTitleMain').textContent = '个人工作台';
  }

  async function loadApps() {
    const data = await fetchJSON('/api/apps');
    state.apps = data || {};
    renderNav();
    renderMetrics();
    renderProjectList();
    renderProjectGrid();
    selectDetail(state.selected);
  }

  function renderNav() {
    const nav = $('primaryNav');
    const entries = Object.entries(state.apps);
    nav.innerHTML = entries.map(([id, app]) => {
      const active = id === 'workbench' ? ' active' : '';
      const icon = app.icon === 'switch' ? 'i-link' : app.icon === 'sub' ? 'i-book' : app.icon === 'grid' ? 'i-grid' : 'i-grid';
      return `<button class="nav-item${active}" data-id="${id}" title="${app.name}">
        ${id === 'workbench' ? '<span class="live-dot"></span>' : ''}<svg><use href="#${icon}"/></svg>
        <span>${app.name}</span>
      </button>`;
    }).join('');
    nav.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        selectDetail(id);
        nav.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
        closeDrawer();
        const app = state.apps[id];
        if (app && app.url && app.url !== '/') { enterEmbed(id); } else { exitEmbed(); }
      });
    });
  }

  function renderMetrics() {
    const grid = $('metricGrid');
    const count = Object.keys(state.apps).length;
    const subs = Math.max(0, count - 1);
    const user = state.user ? state.user.name : '未登录';
    grid.innerHTML = [
      `<article class="metric-card" data-material="cyan" data-opacity="92" data-blur="20" data-flow="150"><span>PROJECTS / 项目</span><h3>接入项目</h3><strong>${count}<small>个</small></strong><p>统一注册表 · <em>实时拉取</em></p></article>`,
      `<article class="metric-card" data-material="original" data-opacity="88" data-blur="22" data-flow="175"><span>APPS / 子项目</span><h3>独立站点</h3><strong>${subs}<small>个</small></strong><p>独立部署 · <em>各自主域</em></p></article>`,
      `<article class="metric-card" data-material="rain" data-opacity="78" data-blur="26" data-flow="130"><span>AUTH / 登录</span><h3>当前会话</h3><strong>${user}</strong><p>${state.user ? '已通过父域 Cookie 鉴权' : '未登录，无法访问'}</p></article>`,
      `<article class="metric-card" data-material="chrome" data-opacity="94" data-blur="21" data-flow="190"><span>STATUS / 状态</span><h3>工作台</h3><strong>${state.user ? 'ON' : 'OFF'}</strong><p>${state.user ? ('角色 ' + state.user.role) : '请先登录'}</p></article>`,
    ].join('');
    initMetricMotion(grid);
  }

  function initMetricMotion(container) {
    container.querySelectorAll('.metric-card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * 100;
        const py = ((e.clientY - r.top) / r.height) * 100;
        card.style.setProperty('--pointer-x', px + '%');
        card.style.setProperty('--pointer-y', py + '%');
      });
    });
  }

  function renderProjectList() {
    const list = $('projectList');
    const entries = Object.entries(state.apps);
    list.innerHTML = `<div class="queue-group open">
      <button class="group-head"><span><i></i><b>已接入（${entries.length}）</b></span><svg><use href="#i-chevron"/></svg></button>
      <div class="group-items">${entries.map(([id, app]) => {
        const icon = app.icon === 'switch' ? '🔌' : app.icon === 'sub' ? '📡' : app.icon === 'home' ? '🏠' : '▦';
        return `<button class="queue-item" data-id="${id}">
          <span class="qi-icon">${icon}</span>
          <span class="qi-name"><b>${app.name}</b><small>${app.description || ''}</small></span>
          <em>打开</em>
        </button>`;
      }).join('')}</div>
    </div>`;
    list.querySelectorAll('.queue-item').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const app = state.apps[id];
      selectDetail(id);
      closeDrawer();
      if (app && app.url && app.url !== '/') { enterEmbed(id); } else { exitEmbed(); }
    }));
  }

  function renderProjectGrid(filter) {
    const grid = $('projectGrid');
    const q = (filter || '').trim().toLowerCase();
    const entries = Object.entries(state.apps).filter(([, app]) =>
      !q || (app.name + ' ' + (app.description || '')).toLowerCase().includes(q)
    );
    if (!entries.length) { grid.innerHTML = '<p class="project-empty">没有匹配的项目</p>'; return; }
    $('projectCount').textContent = `${entries.length} 个`;
    grid.innerHTML = entries.map(([id, app]) => {
      const icon = app.icon === 'switch' ? '🔌' : app.icon === 'sub' ? '📡' : app.icon === 'home' ? '🏠' : '▦';
      return `<a class="project-card" href="${app.url}" target="_blank" rel="noopener" data-id="${id}">
        <div><div class="pc-head"><span class="pc-icon">${icon}</span><h4>${app.name}</h4></div>
        <p>${app.description || ''}</p></div>
        <div class="pc-url">${app.url}</div>
      </a>`;
    }).join('');
    grid.querySelectorAll('.project-card').forEach((card) => card.addEventListener('click', (e) => {
      e.preventDefault();
      const id = card.dataset.id;
      const app = state.apps[id];
      selectDetail(id);
      if (app && app.url && app.url !== '/') { enterEmbed(id); } else { exitEmbed(); }
    }));
  }

  function selectDetail(id) {
    const app = state.apps[id] || state.apps['workbench'];
    if (!app) return;
    state.selected = id;
    $('detailsHeadingTitle').textContent = '✦ ' + app.name + ' 详情';
    $('detailTitle').textContent = app.name;
    $('detailDescription').textContent = app.description || '';
    $('detailDomain').textContent = app.url === '/' ? (location.hostname.replace(/^www\./, '') || '—') : app.url.replace(/^https?:\/\//, '');
    $('detailStatus').textContent = app.url === '/' ? '主站' : '在线';
    $('detailUser').textContent = state.user ? (state.user.name + ' · ' + state.user.role) : '未登录';
    $('detailMode').textContent = '独立账号';
    const open = $('openWorkbenchBtn');
    open.innerHTML = '<svg><use href="#i-check"/></svg>' + (app.url === '/' ? '工作台首页' : '打开项目');
  }

  function showDocs() {
    Cn.openModal({
      title: '接入说明',
      body: `<div style="font-size:12px;line-height:1.8;color:#aab3ae;display:flex;flex-direction:column;gap:12px">
        <p style="margin:0">本工作台为 <b>Calpher Workbench</b>，聚合你在 Cloudflare 上独立部署的各子服务，统一共享登录与统一视觉。</p>
        <div>
          <h4 style="margin:0 0 4px;font-size:12px;color:var(--accent-300)">如何接入一个新项目？</h4>
          <ol style="margin:0;padding-left:18px">
            <li>子项目独立部署在 Cloudflare，自建站点与自定义域名</li>
            <li>在 <code>apps.json</code> 注册表中登记名称、URL 与图标类型</li>
            <li>共享登录：父域 Cookie（<code>kypher72.indevs.in</code>）一处登录，全站可用</li>
            <li>统一视觉：引用工作台的 <code>styles.css</code> 与 <code>components.js</code>，获取相同的主题、强调色与组件</li>
          </ol>
        </div>
        <div>
          <h4 style="margin:0 0 4px;font-size:12px;color:var(--accent-300)">登录说明</h4>
          <p style="margin:0">账号/密码由主站 <code>AUTH_MASTER_PASS / AUTH_MASTER_TOKEN</code> 环境变量配置，请部署方妥善保管。</p>
        </div>
      </div>`,
      buttons: [{ text: '关闭', onClick: Cn.closeModal }],
    });
  }

  async function checkAuth() {
    try {
      state.user = await fetchJSON('/api/me');
    } catch (e) {
      state.user = null;
      location.href = '/login';
      return;
    }
    renderUser();
  }

  function renderUser() {
    const box = $('userBox');
    const name = state.user ? state.user.name : '未登录';
    box.innerHTML = `<span class="avatar">${name.slice(0, 2).toUpperCase()}<i></i></span>
      <span><b>${name}</b><small>${state.user ? state.user.role : '访客'}</small></span>
      <button class="profile-logout" id="logoutBtn2" title="退出登录">退出</button>`;
    const b = $('logoutBtn2');
    if (b) b.addEventListener('click', doLogout);
    $('detailUser').textContent = state.user ? (state.user.name + ' · ' + state.user.role) : '未登录';
  }

  async function doLogout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    location.href = '/login';
  }

  function openSettings() {
    const accents = [
      ['emerald', '翡翠'], ['ocean', '静海'], ['iris', '鸢尾'], ['amber', '琥珀'], ['sakura', '绯樱'],
    ];
    const cur = document.documentElement.dataset.accent || 'ocean';
    const body = `<div style="display:flex;flex-direction:column;gap:10px">
      <label style="display:flex;flex-direction:column;gap:8px;color:var(--muted);font-size:12px">
        <span>界面强调色</span>
        <select id="settingsAccent" style="padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--text)">
          ${accents.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
    </div>`;
    Cn.openModal({
      title: '工作台设置',
      body,
      buttons: [
        { text: '取消', onClick: Cn.closeModal },
        {
          text: '保存', primary: true, onClick: () => {
            const v = document.getElementById('settingsAccent').value;
            Cn.setAccent(v);
            Cn.closeModal();
            Cn.toast('强调色已更新');
          },
        },
      ],
    });
  }

  const searchInput = $('searchInput');
  searchInput.addEventListener('input', () => renderProjectGrid(searchInput.value));

  document.querySelectorAll('#settingsBtn, #settingsBtn2, #settingsSidebarBtn').forEach((b) => b.addEventListener('click', openSettings));
  $('logoutBtn').addEventListener('click', doLogout);
  $('refreshBtn').addEventListener('click', async () => {
    try { await loadApps(); Cn.toast('数据已刷新'); } catch (e) { Cn.toast('刷新失败'); }
  });
  $('openWorkbenchBtn').addEventListener('click', () => {
    const app = state.apps[state.selected];
    if (app && app.url && app.url !== '/') { enterEmbed(state.selected); return; }
    exitEmbed();
  });
  $('backBtn').addEventListener('click', exitEmbed);
  $('detailDocsBtn').addEventListener('click', showDocs);

  const shell = $('appShell');
  const mqMobile = matchMedia('(max-width: 1180px)');
  function setSidebarCollapsed(c) {
    shell.classList.toggle('sidebar-collapsed', c);
    try { localStorage.setItem('calpher-workbench-sidebar', c ? '1' : '0'); } catch (e) {}
  }
  function setDetailsCollapsed(c) {
    shell.classList.toggle('details-collapsed', c);
    try { localStorage.setItem('calpher-workbench-details', c ? '1' : '0'); } catch (e) {}
  }
  function restoreLayout() {
    if (mqMobile.matches) return;
    try {
      if (localStorage.getItem('calpher-workbench-sidebar') === '1') setSidebarCollapsed(true);
      if (localStorage.getItem('calpher-workbench-details') === '1') setDetailsCollapsed(true);
    } catch (e) {}
  }
  $('sidebarCollapseBtn').addEventListener('click', () => {
    setSidebarCollapsed(!shell.classList.contains('sidebar-collapsed'));
    closeDrawer();
  });
  $('detailsCollapseBtn').addEventListener('click', () => setDetailsCollapsed(!shell.classList.contains('details-collapsed')));

  try { await checkAuth(); } catch (e) {}
  try { await loadApps(); } catch (e) { Cn.toast('加载项目失败'); }
  Cn.initThemeToggle('#themeToggleBtn');
  restoreLayout();
  mqMobile.addEventListener('change', () => {
    if (mqMobile.matches) {
      shell.classList.remove('sidebar-collapsed', 'details-collapsed');
    } else {
      restoreLayout();
    }
  });

  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  document.body.appendChild(backdrop);
  const burger = $('burgerBtn');
  function openDrawer() { sidebar.classList.add('open'); backdrop.classList.add('show'); }
  function closeDrawer() { sidebar.classList.remove('open'); backdrop.classList.remove('show'); }
  burger.addEventListener('click', () => sidebar.classList.contains('open') ? closeDrawer() : openDrawer());
  backdrop.addEventListener('click', closeDrawer);
})();
