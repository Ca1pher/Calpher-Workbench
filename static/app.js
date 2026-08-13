(async function () {
  const state = {
    apps: {},
    user: null,
    workspaceUser: null,
    limits: {},
    asUser: '',
    selected: 'workbench',
    view: { mode: 'local' },
    loadingTimers: [],
    detailsOverrides: {},
    activeFrame: null,
    preloadFrames: new Map(),
    preloadRun: 0,
  };
  const $ = (id) => document.getElementById(id);
  const isMobile = () => window.matchMedia('(max-width: 1180px)').matches;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function withAs(url, name = state.asUser) {
    if (!name) return url;
    const parsed = new URL(url, location.origin);
    parsed.searchParams.set('as', name);
    return parsed.pathname + parsed.search;
  }

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  function resolvedTheme() {
    return document.documentElement.dataset.themeResolved
      || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }

  function resolvedAccent() {
    return document.documentElement.dataset.accent || 'ocean';
  }

  function appIcon(app) {
    if (app.icon === 'sub') return 'i-book';
    if (app.icon === 'switch') return 'i-link';
    if (app.icon === 'user') return 'i-user';
    if (app.icon === 'folder') return 'i-folder';
    if (app.icon === 'book') return 'i-book';
    if (app.icon === 'spark') return 'i-spark';
    if (app.icon === 'link' || app.kind === 'shortcut') return 'i-link';
    return 'i-grid';
  }

  function displayName(user = state.workspaceUser || state.user) {
    if (!user) return 'Workbench';
    return user.role === 'admin' ? 'Calpher' : user.name;
  }

  function themedTarget(app, options = {}) {
    const target = new URL(app.url, location.origin);
    target.searchParams.set('theme', resolvedTheme());
    target.searchParams.set('accent', resolvedAccent());
    if (options.embed) target.searchParams.set('embed', '1');
    if (options.fromWorkbench) target.searchParams.set('from', 'workbench');
    if (state.asUser) target.searchParams.set('calpher_owner', state.asUser);
    return target;
  }

  function handoffUrl(app, options = {}) {
    const endpoint = new URL(options.embed ? '/api/auth/embed-handoff' : '/api/auth/handoff', location.origin);
    endpoint.searchParams.set('redirect', themedTarget(app, options).toString());
    if (state.asUser) endpoint.searchParams.set('as', state.asUser);
    return endpoint.toString();
  }

  async function embedUrl(app) {
    if (app.kind === 'shortcut') return themedTarget(app, { embed: true }).toString();
    const handoff = await fetchJSON(handoffUrl(app, { embed: true }));
    return handoff.url;
  }

  function frameHost() {
    return $('embedLoading').parentElement;
  }

  function makeEmbedFrame(id) {
    const frame = document.createElement('iframe');
    frame.className = 'embed-iframe';
    frame.title = state.apps[id]?.name || '子项目';
    frame.dataset.appId = id;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox');
    return frame;
  }

  function mountFrame(frame) {
    if (frame && frame.parentElement !== frameHost()) frameHost().appendChild(frame);
    return frame;
  }

  function cleanupInactivePreloads() {
    state.preloadFrames.forEach((entry, id) => {
      if (!state.apps[id]?.preload && state.activeFrame !== entry.frame) {
        entry.frame.remove();
        state.preloadFrames.delete(id);
      }
    });
  }

  function frameForApp(id) {
    const app = state.apps[id];
    if (app && app.preload) {
      let entry = state.preloadFrames.get(id);
      if (!entry) {
        entry = { frame: makeEmbedFrame(id), status: 'idle' };
        state.preloadFrames.set(id, entry);
      }
      return mountFrame(entry.frame);
    }
    return mountFrame($('embedFrame'));
  }

  function activateFrame(frame) {
    mountFrame(frame);
    frameHost().querySelectorAll('.embed-iframe').forEach((item) => {
      item.classList.toggle('is-active', item === frame);
      item.setAttribute('aria-hidden', item === frame ? 'false' : 'true');
    });
    state.activeFrame = frame;
    cleanupInactivePreloads();
  }

  function deactivateFrames() {
    frameHost().querySelectorAll('.embed-iframe').forEach((frame) => {
      frame.classList.remove('is-active');
      frame.setAttribute('aria-hidden', 'true');
    });
    state.activeFrame = null;
    cleanupInactivePreloads();
  }

  function revealFrameAfterLayout(frame) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (state.activeFrame === frame && frame.isConnected) hideTransition();
    }));
  }

  function refreshEmbedLaunchUrl() {
    const current = state.view;
    if (!current || current.mode !== 'embed') return;
    const app = state.apps[current.id];
    if (!app) return;
    $('embedOpen').href = app.kind === 'shortcut'
      ? themedTarget(app, { fromWorkbench: true }).toString()
      : handoffUrl(app, { fromWorkbench: true });
  }

  function sendThemeToFrame(frame, target) {
    if (!frame?.contentWindow || !target?.url) return;
    frame.contentWindow.postMessage({
      source: 'kypher-embed',
      type: 'theme',
      theme: resolvedTheme(),
      accent: resolvedAccent(),
    }, new URL(target.url, location.origin).origin);
  }

  function sendEmbedTheme() {
    const current = state.view;
    if (current?.mode === 'embed') sendThemeToFrame(state.activeFrame || $('embedFrame'), state.apps[current.id]);
    state.preloadFrames.forEach((entry, id) => sendThemeToFrame(entry.frame, state.apps[id]));
  }

  function clearLoadingTimers() {
    state.loadingTimers.forEach(clearTimeout);
    state.loadingTimers = [];
  }

  function showTransition(app) {
    clearLoadingTimers();
    $('transitionName').textContent = app.name;
    $('transitionDomain').textContent = new URL(app.url).hostname;
    $('transitionStatus').textContent = '验证工作台会话';
    if (window.CalpherMotion) window.CalpherMotion.transitionScreen(true);
    else $('embedLoading').style.display = 'grid';
    state.loadingTimers.push(setTimeout(() => {
      $('transitionStatus').textContent = '建立安全连接';
    }, 520));
    state.loadingTimers.push(setTimeout(() => {
      $('transitionStatus').textContent = '应用显示主题';
    }, 1150));
  }

  function hideTransition() {
    clearLoadingTimers();
    if (window.CalpherMotion) window.CalpherMotion.transitionScreen(false);
    else $('embedLoading').style.display = 'none';
  }

  function openShortcut(app) {
    window.open(themedTarget(app, { fromWorkbench: true }).toString(), '_blank', 'noopener');
  }

  function openItem(id) {
    const app = state.apps[id];
    if (!app) return;
    selectDetail(id);
    closeDrawer();
    if (app.kind === 'shortcut') return openShortcut({ ...app, id });
    if (id === 'workbench' || !app.url) {
      exitEmbed();
      return;
    }
    enterEmbed(id);
  }

  async function enterEmbed(id) {
    const app = state.apps[id];
    if (!app || id === 'workbench' || !app.url) return;
    if (isMobile()) {
      location.href = app.kind === 'shortcut'
        ? themedTarget(app, { fromWorkbench: true }).toString()
        : handoffUrl(app, { fromWorkbench: true });
      return;
    }

    state.view = { mode: 'embed', id };
    refreshEmbedLaunchUrl();
    $('embedTitle').textContent = app.name;
    $('pageTitleMain').textContent = app.name;
    const frame = frameForApp(id);
    activateFrame(frame);
    if (!app.preload) frame.removeAttribute('src');
    showTransition(app);
    const preload = app.preload && state.preloadFrames.get(id);
    if (preload && preload.status === 'ready') revealFrameAfterLayout(frame);
    else if (!frame.src) requestAnimationFrame(async () => {
      try {
        if (preload) preload.status = 'loading';
        frame.src = await embedUrl(app);
      } catch (e) {
        if (preload) preload.status = 'error';
        hideTransition();
        Cn.toast(e.message || '子项目鉴权初始化失败');
      }
    });
    const mutate = () => {
      $('appShell').classList.add('embed-view', 'details-collapsed');
      selectDetail(id);
      $('appShell').classList.add('details-collapsed');
    };
    if (window.CalpherMotion) await window.CalpherMotion.transitionView('embed', mutate);
    else mutate();
  }

  function exitEmbed() {
    state.view = { mode: 'local' };
    hideTransition();
    deactivateFrames();
    $('embedTitle').textContent = '加载中…';
    const mutate = () => {
      $('appShell').classList.remove('embed-view', 'details-available');
      const owner = displayName();
      $('pageTitleMain').textContent = state.asUser ? `${owner} 的工作台` : `${owner} 工作台`;
    };
    if (window.CalpherMotion) window.CalpherMotion.transitionView('local', mutate);
    else mutate();
  }

  $('embedFrame').addEventListener('load', () => {
    sendEmbedTheme();
    const current = state.view;
    const app = current && state.apps[current.id];
    if (app && app.kind === 'shortcut') revealFrameAfterLayout($('embedFrame'));
    else if (app && state.activeFrame === $('embedFrame')) revealFrameAfterLayout($('embedFrame'));
  });
  $('embedOpen').addEventListener('click', (event) => {
    const current = state.view;
    const app = current && current.mode === 'embed' ? state.apps[current.id] : null;
    if (!app) return;
    event.preventDefault();
    window.open(app.kind === 'shortcut'
      ? themedTarget(app, { fromWorkbench: true }).toString()
      : handoffUrl(app, { fromWorkbench: true }), '_blank', 'noopener');
  });

  window.addEventListener('message', (event) => {
    const entry = [...state.preloadFrames.values()].find((item) => item.frame.contentWindow === event.source);
    const frame = entry ? entry.frame : $('embedFrame').contentWindow === event.source ? $('embedFrame') : null;
    if (!frame) return;
    const id = frame.dataset.appId || (state.view.mode === 'embed' ? state.view.id : '');
    const app = state.apps[id];
    if (!app?.url) return;
    if (event.origin !== new URL(app.url, location.origin).origin) return;
    const data = event.data;
    if (!data || data.source !== 'kypher-embed') return;
    if (data.type === 'ready') {
      if (entry) entry.status = 'ready';
      sendThemeToFrame(frame, app);
      if (state.view.mode === 'embed' && state.view.id === id && state.activeFrame === frame) revealFrameAfterLayout(frame);
    } else if (state.view.mode === 'embed' && state.view.id === id && state.activeFrame === frame && data.type === 'title' && data.title) {
      $('pageTitleMain').textContent = data.title;
      $('embedTitle').textContent = data.title;
    } else if (state.view.mode === 'embed' && state.view.id === id && state.activeFrame === frame && data.type === 'exit') {
      exitEmbed();
    }
  });

  function schedulePreloads() {
    state.preloadRun += 1;
    const run = state.preloadRun;
    cleanupInactivePreloads();
    const candidates = Object.entries(state.apps)
      .filter(([, app]) => app.kind === 'integration' && app.preload)
      .slice(0, 3);
    if (isMobile() || document.visibilityState !== 'visible'
      || navigator.connection?.saveData
      || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const loadNext = async (index) => {
      if (run !== state.preloadRun || index >= candidates.length) return;
      const [id, app] = candidates[index];
      let entry = state.preloadFrames.get(id);
      if (!entry) {
        entry = { frame: makeEmbedFrame(id), status: 'idle' };
        state.preloadFrames.set(id, entry);
      }
      if (entry.status === 'idle' || entry.status === 'error') {
        entry.status = 'loading';
        mountFrame(entry.frame);
        entry.frame.addEventListener('load', () => {
          if (entry.status === 'loading') entry.status = 'loaded';
          if (state.view.mode === 'embed' && state.view.id === id && state.activeFrame === entry.frame) {
            revealFrameAfterLayout(entry.frame);
          }
        }, { once: true });
        try {
          entry.frame.src = await embedUrl(app);
        } catch (e) {
          entry.status = 'error';
        }
      }
      const next = () => loadNext(index + 1);
      if (window.requestIdleCallback) requestIdleCallback(next, { timeout: 1800 });
      else setTimeout(next, 180);
    };

    const start = () => loadNext(0);
    if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 1200 });
    else setTimeout(start, 160);
  }

  async function loadWorkspace(asUser = state.asUser) {
    const query = asUser ? `?as=${encodeURIComponent(asUser)}` : '';
    const data = await fetchJSON(`/api/workspace${query}`);
    state.apps = data.apps || {};
    state.user = data.user;
    state.workspaceUser = data.workspaceUser;
    state.limits = data.limits || {};
    state.asUser = data.viewing ? data.workspaceUser.name : '';
    if (state.view.mode === 'embed' && !state.apps[state.view.id]) exitEmbed();
    if (state.apps[state.selected]?.kind === 'shortcut' || state.selected === 'shortcuts') {
      state.selected = 'workbench';
    }
    if (!state.apps[state.selected]) state.selected = 'workbench';
    renderAll();
    schedulePreloads();
  }

  function renderAll() {
    renderNav();
    renderMetrics();
    renderProjectGrid($('searchInput').value);
    renderUser();
    selectDetail(state.selected);
    const owner = displayName();
    $('brandName').textContent = owner;
    $('brandMark').textContent = owner.trim().slice(0, 1).toUpperCase() || 'C';
    $('pageTitleMain').textContent = state.asUser ? `${owner} 的工作台` : `${owner} 工作台`;
    document.title = `${owner} Workbench`;
  }

  function renderNav() {
    const entries = Object.entries(state.apps);
    const integrations = entries.filter(([, app]) => app.kind !== 'shortcut');
    const makeButton = ([id, app]) => `<button class="nav-item${id === state.selected ? ' active' : ''}" data-id="${esc(id)}" title="${esc(app.name)}">
      ${id === 'workbench' ? '<span class="live-dot"></span>' : `<svg><use href="#${appIcon(app)}"/></svg>`}
      <span>${esc(app.name)}</span>
    </button>`;
    $('primaryNav').innerHTML = integrations.map(makeButton).join('');
    $('primaryNav').querySelectorAll('.nav-item').forEach((button) => {
      button.addEventListener('click', () => openItem(button.dataset.id));
    });
    if (window.CalpherMotion) window.CalpherMotion.navRendered($('primaryNav'));
  }

  function renderMetrics() {
    const platformIntegrations = Object.values(state.apps)
      .filter((app) => app.kind === 'integration' && app.source === 'global').length;
    const personalIntegrations = state.limits.integrationsUsed || 0;
    const shortcuts = Object.values(state.apps).filter((app) => app.kind === 'shortcut').length;
    const owner = displayName(state.workspaceUser);
    $('metricGrid').innerHTML = [
      `<article class="metric-card" data-material="cyan"><span>CHILD SITES / 子站</span><h3>已接入子站</h3><strong>${platformIntegrations + personalIntegrations}</strong><p>平台 ${platformIntegrations} · 个人 ${personalIntegrations}/${state.limits.integrationLimit || 0}</p></article>`,
      `<article class="metric-card" data-material="original"><span>LINKS / 网站导航</span><h3>网站导航</h3><strong>${shortcuts}<small> / ${state.limits.shortcutLimit || 0}</small></strong><p>普通网址 · <em>不参与签票</em></p></article>`,
      `<article class="metric-card" data-material="rain"><span>WORKSPACE / 空间</span><h3>当前工作台</h3><strong>${esc(owner)}</strong><p>${state.asUser ? '管理员查看成员空间' : '当前账号的独立配置'}</p></article>`,
      `<article class="metric-card" data-material="chrome"><span>AUTH / 身份</span><h3>当前会话</h3><strong>${state.user && state.user.role === 'admin' ? 'ADMIN' : 'USER'}</strong><p>${esc(displayName(state.user))}</p></article>`,
    ].join('');
    if (window.CalpherMotion) window.CalpherMotion.metricsRendered($('metricGrid'));
  }

  function itemRow([id, app]) {
    return `<button class="queue-item" data-id="${esc(id)}">
      <span class="qi-icon"><svg><use href="#${appIcon(app)}"/></svg></span>
      <span class="qi-name"><b>${esc(app.name)}</b><small>${esc(app.description || new URL(app.url, location.origin).hostname)}</small></span>
      <em>${app.kind === 'shortcut' ? '跳转' : '打开'}</em>
    </button>`;
  }

  function renderProjectGrid(filter = '') {
    const query = filter.trim().toLowerCase();
    const matches = Object.entries(state.apps).filter(([, app]) =>
      !query || `${app.name} ${app.description || ''}`.toLowerCase().includes(query));
    const integrations = matches.filter(([, app]) => app.kind === 'integration');
    const shortcuts = matches.filter(([, app]) => app.kind === 'shortcut');
    const totalIntegrations = Object.values(state.apps).filter((app) => app.kind === 'integration').length;
    const totalShortcuts = Object.values(state.apps).filter((app) => app.kind === 'shortcut').length;
    $('projectCount').textContent = query ? `${integrations.length} / ${totalIntegrations}` : `${integrations.length} 个子站`;
    $('shortcutCount').textContent = query ? `${shortcuts.length} / ${totalShortcuts}` : `${shortcuts.length} 个入口`;
    $('appShell').classList.toggle('navigation-led-workspace', totalIntegrations === 0 && totalShortcuts > 0);
    const integrationCards = integrations.map(([id, app]) => `<a class="project-card" href="${esc(app.url)}" data-id="${esc(id)}">
      <div><div class="pc-head"><span class="pc-icon"><svg><use href="#${appIcon(app)}"/></svg></span><h4>${esc(app.name)}</h4></div>
      <p>${esc(app.description || '统一鉴权子项目')}</p></div>
      <div class="pc-url">${esc(app.url)}</div>
    </a>`).join('');
    $('projectGrid').innerHTML = integrationCards
      || `<p class="project-empty">${query ? '没有匹配的子站' : '还没有接入子站'}</p>`;
    $('shortcutGrid').innerHTML = shortcuts.map(([id, app]) => `<a class="shortcut-link" href="${esc(themedTarget(app, { fromWorkbench: true }).toString())}" target="_blank" rel="noopener noreferrer" data-id="${esc(id)}" title="在新窗口打开 ${esc(app.name)}">
      <span class="shortcut-link-icon"><svg><use href="#${appIcon(app)}"/></svg></span>
      <span><b>${esc(app.name)}</b><small>${esc(app.description || new URL(app.url, location.origin).hostname)}</small></span>
      <svg class="shortcut-link-arrow"><use href="#i-external"/></svg>
    </a>`).join('') || `<p class="project-empty">${query ? '没有匹配的网站导航' : '还没有收藏网址'}</p>`;
    $('projectGrid').querySelectorAll('.project-card').forEach((card) => {
      card.addEventListener('click', (event) => {
        event.preventDefault();
        openItem(card.dataset.id);
      });
    });
    if (window.CalpherMotion) window.CalpherMotion.projectsRendered($('projectGrid'));
    if (window.CalpherMotion) window.CalpherMotion.projectsRendered($('shortcutGrid'));
  }

  function selectDetail(id) {
    const app = state.apps[id] || state.apps.workbench;
    if (!app) return;
    const isWorkbench = id === 'workbench';
    state.selected = id;
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.id === id));
    $('detailsHeadingTitle').textContent = `${app.name} 详情`;
    $('detailTitle').textContent = app.name;
    $('detailDescription').textContent = app.description || '';
    $('detailDomain').textContent = isWorkbench ? location.hostname.replace(/^www\./, '') : new URL(app.url, location.origin).hostname;
    $('detailStatus').textContent = isWorkbench ? '主站' : '在线';
    $('detailUser').textContent = state.workspaceUser ? `${displayName(state.workspaceUser)} · ${state.workspaceUser.role}` : '未登录';
    $('detailMode').textContent = app.kind === 'shortcut' ? '网站导航 / 桌面窗口' : isWorkbench ? '主站会话' : '独立密钥统一鉴权';
    $('detailTheme').textContent = resolvedTheme() === 'light' ? '亮色' : '暗色';
    $('openWorkbenchBtn').innerHTML = `<svg><use href="#i-check"/></svg>${isWorkbench ? '工作台首页' : app.kind === 'shortcut' ? '访问网址' : '打开项目'}`;
    const details = String(app.details || '').trim();
    $('appShell').classList.toggle('details-available', isWorkbench || Boolean(details));
    $('detailNote').hidden = !isWorkbench && !details;
    $('detailNoteTitle').textContent = isWorkbench ? '关于本工作台' : '子站详情';
    $('workbenchDetailList').hidden = !isWorkbench;
    $('childDetailText').hidden = isWorkbench;
    $('childDetailText').textContent = details;
    $('detailDocsBtn').hidden = !isWorkbench;
    if (!isMobile() && state.detailsOverrides[id] === undefined) {
      let collapsed = !isWorkbench && !details;
      if (!collapsed) {
        try { collapsed = localStorage.getItem('calpher-workbench-details') === '1'; } catch (e) {}
      }
      setDetailsCollapsed(collapsed, false);
    }
    if (window.CalpherMotion) window.CalpherMotion.detailChanged();
  }

  function renderUser() {
    const name = state.user ? displayName(state.user) : '未登录';
    const viewing = state.asUser ? `<button class="profile-view-exit" id="viewExitBtn" title="返回管理员工作台">返回</button>` : '';
    $('userBox').innerHTML = `<span class="avatar">${esc(name.slice(0, 2).toUpperCase())}<i></i></span>
      <span><b>${esc(name)}</b><small>${state.asUser ? `查看 ${esc(displayName())}` : esc(state.user ? state.user.role : '访客')}</small></span>
      ${viewing}<button class="profile-logout" id="logoutBtn2" title="退出登录">退出</button>`;
    $('logoutBtn2').addEventListener('click', doLogout);
    if ($('viewExitBtn')) $('viewExitBtn').addEventListener('click', async () => {
      state.asUser = '';
      state.selected = 'workbench';
      exitEmbed();
      await loadWorkspace('');
    });
  }

  function showDocs() {
    Cn.openModal({
      title: '接入说明',
      body: `<div class="settings-copy">
        <p>接入子站需要主站地址和该子站的独立密钥，二者齐全时走统一鉴权；缺少任一项时仍是完整独立站。</p>
        <p>网站导航只是当前账号的导航入口，不会收到 handoff 票据，也不要求目标站适配工作台协议。</p>
        <p>普通成员默认可接入 3 个项目和 10 个网站导航，管理员可以在成员管理中调整。</p>
      </div>`,
      buttons: [{ text: '关闭', onClick: Cn.closeModal }],
    });
  }

  function formValue(id) {
    const element = $(id);
    return element ? element.value.trim() : '';
  }

  const iconChoices = [
    ['grid', '应用'], ['switch', '网络'], ['sub', '订阅'],
    ['folder', '主机'], ['book', '文档'], ['spark', '工具'], ['link', '链接'],
  ];

  function iconPicker(name, selected = 'grid') {
    return `<div class="icon-picker">${iconChoices.map(([value, label]) => `<label title="${label}">
      <input type="radio" name="${name}" value="${value}" ${value === selected ? 'checked' : ''}>
      <span><svg><use href="#${appIcon({ icon: value })}"/></svg></span>
    </label>`).join('')}</div>`;
  }

  function selectedIcon(name) {
    const input = document.querySelector(`input[name="${name}"]:checked`);
    return input ? input.value : 'grid';
  }

  function confirmAction(title, message, confirmText = '确认删除') {
    const activeTab = document.querySelector('.settings-tabs button.active')?.dataset.tab || '';
    return new Promise((resolve) => {
      Cn.openModal({
        title,
        body: `<div class="confirm-copy"><p>${esc(message)}</p><small>此操作无法撤销。</small></div>`,
        closable: false,
        buttons: [
          {
            text: '取消',
            onClick: async () => {
              Cn.closeModal();
              if (activeTab) await openSettings(activeTab);
              resolve(false);
            },
          },
          { text: confirmText, primary: true, onClick: () => { Cn.closeModal(); resolve(true); } },
        ],
      });
    });
  }

  function openAddSite(defaultKind = 'integration') {
    const isIntegration = defaultKind === 'integration';
    const body = `<form id="quickAddForm" class="quick-add-form">
      <input type="hidden" id="quickAddKind" value="${defaultKind}">
      <label><span>${isIntegration ? '侧边栏名称' : '导航名称'}</span><input id="quickAddName" maxlength="40" required></label>
      <label><span>${isIntegration ? '子站地址' : '网站地址'}</span><input id="quickAddUrl" type="url" placeholder="${isIntegration ? 'https://child.example.com' : 'https://www.example.com'}" required></label>
      <label><span>简介</span><input id="quickAddDescription" maxlength="160"></label>
      ${isIntegration ? '<label><span>详情</span><textarea id="quickAddDetails" maxlength="2000" rows="4" placeholder="可选，将显示在子站详情区域"></textarea></label>' : ''}
      ${isIntegration ? '<label id="quickAddPreloadField"><span>加载策略</span><span class="toggle-field"><input id="quickAddPreload" type="checkbox"><b>提前加载子站</b></span></label>' : ''}
      <div><span class="field-label">${isIntegration ? '子站图标' : '导航图标'}</span>${iconPicker('quickAddIcon')}</div>
      <button class="manage-primary" type="submit">${isIntegration ? '接入子站' : '添加导航'}</button>
    </form>`;
    Cn.openModal({ title: isIntegration ? '添加子站' : '添加网站导航', body, className: 'cn-modal-add', buttons: [] });
    $('quickAddForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const kind = $('quickAddKind').value;
      try {
        await fetchJSON(kind === 'integration' ? '/api/integrations' : '/api/shortcuts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            as: state.asUser,
            name: formValue('quickAddName'),
            url: formValue('quickAddUrl'),
            description: formValue('quickAddDescription'),
            details: isIntegration ? formValue('quickAddDetails') : '',
            icon: selectedIcon('quickAddIcon'),
            preload: isIntegration && ($('quickAddPreload')?.checked || false),
          }),
        });
        Cn.closeModal();
        await loadWorkspace();
        Cn.toast(kind === 'integration' ? '子站已接入，独立密钥已生成' : '网站导航已添加');
      } catch (e) { Cn.toast(e.message); }
    });
  }

  function settingsTabs(active, isAdmin) {
    return `<div class="settings-tabs">
      <button data-tab="appearance" class="${active === 'appearance' ? 'active' : ''}">外观</button>
      <button data-tab="integrations" class="${active === 'integrations' ? 'active' : ''}">接入子站</button>
      <button data-tab="shortcuts" class="${active === 'shortcuts' ? 'active' : ''}">网站导航</button>
      ${isAdmin ? `<button data-tab="members" class="${active === 'members' ? 'active' : ''}">成员</button>` : ''}
      ${!isAdmin ? `<button data-tab="account" class="${active === 'account' ? 'active' : ''}">账号</button>` : ''}
    </div>`;
  }

  function openEditSite(item, kind) {
    const isIntegration = kind === 'integration';
    const body = `<form id="editSiteForm" class="quick-add-form">
      <label><span>侧边栏名称</span><input id="editSiteName" maxlength="40" value="${esc(item.name)}" required></label>
      <label><span>网站地址</span><input id="editSiteUrl" type="url" value="${esc(item.url)}" required></label>
      <label><span>网站简介</span><input id="editSiteDescription" maxlength="160" value="${esc(item.description || '')}"></label>
      <label><span>详情</span><textarea id="editSiteDetails" maxlength="2000" rows="5" placeholder="可选，将显示在子站详情区域">${esc(item.details || '')}</textarea></label>
      ${isIntegration ? `<label><span>加载策略</span><span class="toggle-field"><input id="editSitePreload" type="checkbox" ${item.preload ? 'checked' : ''}><b>提前加载子站</b></span></label>` : ''}
      ${isIntegration ? '<label><span>替换密钥</span><input id="editSiteSecret" placeholder="留空保留当前密钥"></label>' : ''}
      <div><span class="field-label">图标</span>${iconPicker('editSiteIcon', item.icon || (isIntegration ? 'grid' : 'link'))}</div>
      <button class="manage-primary" type="submit">保存修改</button>
    </form>`;
    Cn.openModal({
      title: isIntegration ? '编辑接入子站' : '编辑网站导航',
      body,
      className: 'cn-modal-add',
      buttons: [{ text: '取消', onClick: () => openSettings(isIntegration ? 'integrations' : 'shortcuts') }],
    });
    $('editSiteForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        as: state.asUser,
        name: formValue('editSiteName'),
        url: formValue('editSiteUrl'),
        description: formValue('editSiteDescription'),
        details: formValue('editSiteDetails'),
        icon: selectedIcon('editSiteIcon'),
      };
      if (isIntegration) payload.secret = formValue('editSiteSecret');
      if (isIntegration) payload.preload = $('editSitePreload').checked;
      try {
        await fetchJSON(`/${isIntegration ? 'api/integrations' : 'api/shortcuts'}/${encodeURIComponent(item.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        Cn.closeModal();
        await loadWorkspace();
        await openSettings(isIntegration ? 'integrations' : 'shortcuts');
        Cn.toast('信息已更新');
      } catch (e) { Cn.toast(e.message); }
    });
  }

  async function openSettings(active = 'appearance') {
    const isAdmin = state.user && state.user.role === 'admin';
    Cn.openModal({
      title: state.asUser ? `${state.asUser} 的工作台设置` : '工作台设置',
      body: '<div class="settings-loading"><i></i><span>正在读取工作台设置</span></div>',
      className: 'cn-modal-wide',
      buttons: [{ text: '关闭', onClick: Cn.closeModal }],
    });
    const [integrations, shortcuts, members] = await Promise.all([
      fetchJSON(withAs('/api/integrations')),
      fetchJSON(withAs('/api/shortcuts')),
      isAdmin ? fetchJSON('/api/admin/members') : Promise.resolve({ items: [] }),
    ]);
    const accents = [['emerald', '翡翠'], ['ocean', '静海'], ['iris', '鸢尾'], ['amber', '琥珀'], ['sakura', '绯樱']];
    const platformRows = (integrations.platformItems || []).map((item) => `<div class="manage-row">
      <div><strong>${esc(item.name)}</strong><small>${esc(item.url)}</small><code>${esc(item.secret)}</code></div>
      <div class="manage-actions"><label class="preload-switch" title="进入工作台后提前加载该子站"><input type="checkbox" data-platform-preload="${esc(item.id)}" ${item.preload ? 'checked' : ''}><span>预加载</span></label><span class="manage-badge">平台</span><button data-copy="${esc(item.secret)}">复制</button><button data-delete-integration="${esc(item.id)}">删除</button></div>
    </div>`).join('');
    const integrationRows = integrations.items.map((item) => `<div class="manage-row">
      <div><strong>${esc(item.name)}</strong><small>${esc(item.url)}</small><code>${esc(item.secret)}</code></div>
      <div class="manage-actions"><button data-copy="${esc(item.secret)}" title="复制密钥">复制</button><button data-edit-integration="${esc(item.id)}">编辑</button><button data-delete-integration="${esc(item.id)}">删除</button></div>
    </div>`).join('') || '<p class="manage-empty">还没有个人接入项目</p>';
    const shortcutRows = shortcuts.items.map((item) => `<div class="manage-row">
      <div><strong>${esc(item.name)}</strong><small>${esc(item.url)}</small></div>
      <div class="manage-actions"><button data-edit-shortcut="${esc(item.id)}">编辑</button><button data-delete-shortcut="${esc(item.id)}">删除</button></div>
    </div>`).join('') || '<p class="manage-empty">还没有网站导航</p>';
    const memberRows = members.items.map((member) => `<div class="member-row" data-member="${esc(member.name)}">
      <div class="member-name"><strong>${esc(member.name)}</strong><small data-password-for="${esc(member.name)}">密码 ••••••••</small></div>
      <label>接入上限<input data-field="integrationLimit" type="number" min="0" max="1000" value="${member.integrationLimit}"></label>
      <label>导航上限<input data-field="shortcutLimit" type="number" min="0" max="1000" value="${member.shortcutLimit}"></label>
      <label class="member-check"><input data-field="disabled" type="checkbox" ${member.disabled ? 'checked' : ''}>停用</label>
      <div class="manage-actions"><button data-reveal-member="${esc(member.name)}" title="显示密码"><svg><use href="#i-eye"/></svg></button><button data-view-member="${esc(member.name)}">查看</button><button data-save-member="${esc(member.name)}">保存</button><button data-delete-member="${esc(member.name)}">删除</button></div>
    </div>`).join('') || '<p class="manage-empty">还没有普通成员</p>';
    const body = `<div class="settings-shell">
      ${settingsTabs(active, isAdmin)}
      <section class="settings-panel ${active === 'appearance' ? 'active' : ''}" data-panel="appearance">
        <div class="settings-section-head"><div><strong>界面外观</strong><small>主题切换会实时同步到当前子项目</small></div></div>
        <label class="manage-field"><span>强调色</span><select id="settingsAccent">${accents.map(([value, label]) => `<option value="${value}" ${value === (document.documentElement.dataset.accent || 'ocean') ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <button class="manage-primary" id="saveAppearance">保存外观</button>
      </section>
      <section class="settings-panel ${active === 'integrations' ? 'active' : ''}" data-panel="integrations">
        <div class="settings-section-head"><div><strong>统一鉴权子站</strong><small>每个项目使用独立密钥，删除后立即停止签票</small></div></div>
        ${platformRows ? `<div class="manage-group-head"><strong>平台接入</strong><small>${integrations.platformItems.length} 个，元数据来自 apps.json</small></div>
        <div class="manage-list">${platformRows}</div>` : ''}
        <div class="manage-group-head"><strong>个人接入</strong><small>${integrations.items.length} / ${integrations.integrationLimit}，不包含平台项目</small></div>
        <div class="manage-list">${integrationRows}</div>
        <form id="integrationForm" class="manage-form">
          <input id="integrationName" placeholder="侧边栏名称" required>
          <input id="integrationUrl" type="url" placeholder="https://child.example.com" required>
          <input id="integrationSecret" placeholder="留空自动生成密钥">
          <input id="integrationDescription" maxlength="160" placeholder="网站简介">
          <textarea id="integrationDetails" maxlength="2000" rows="3" placeholder="详情（可选）"></textarea>
          <label class="manage-wide"><span>加载策略</span><span class="toggle-field"><input id="integrationPreload" type="checkbox"><b>提前加载子站</b></span></label>
          ${iconPicker('integrationIcon')}
          <button class="manage-primary" type="submit">新增接入</button>
        </form>
      </section>
      <section class="settings-panel ${active === 'shortcuts' ? 'active' : ''}" data-panel="shortcuts">
        <div class="settings-section-head"><div><strong>网站导航</strong><small>${shortcuts.items.length} / ${shortcuts.shortcutLimit}，仅作为个人导航入口</small></div></div>
        <div class="manage-list">${shortcutRows}</div>
        <form id="shortcutForm" class="manage-form">
          <input id="shortcutName" placeholder="显示名称" required>
          <input id="shortcutUrl" type="url" placeholder="https://example.com" required>
          <input id="shortcutDescription" maxlength="160" placeholder="网站简介">
          <textarea id="shortcutDetails" maxlength="2000" rows="3" placeholder="详情（可选）"></textarea>
          ${iconPicker('shortcutIcon', 'link')}
          <button class="manage-primary" type="submit">新增网站导航</button>
        </form>
      </section>
      ${isAdmin ? `<section class="settings-panel ${active === 'members' ? 'active' : ''}" data-panel="members">
        <div class="settings-section-head"><div><strong>普通成员</strong><small>管理员凭据仍由 Cloudflare 环境变量维护</small></div></div>
        <div class="member-list">${memberRows}</div>
        <form id="memberForm" class="manage-form member-form">
          <input id="memberName" placeholder="账号，至少 3 位" required>
          <input id="memberPassword" type="password" placeholder="初始密码，至少 8 位" required>
          <input id="memberIntegrationLimit" type="number" min="0" value="3" aria-label="接入上限">
          <input id="memberShortcutLimit" type="number" min="0" value="10" aria-label="网站导航上限">
          <button class="manage-primary" type="submit">新建成员</button>
        </form>
      </section>` : ''}
      ${!isAdmin ? `<section class="settings-panel ${active === 'account' ? 'active' : ''}" data-panel="account">
        <div class="settings-section-head"><div><strong>账号资料</strong><small>修改账号后会保留当前工作台中的所有接入</small></div></div>
        <form id="accountForm" class="account-form">
          <label><span>用户名</span><input id="accountName" value="${esc(state.user.name)}" required></label>
          <label><span>新密码</span><input id="accountPassword" type="password" placeholder="不修改请留空"></label>
          <button class="manage-primary" type="submit">保存账号</button>
        </form>
        <div class="danger-zone"><div><strong>删除账号</strong><small>同时删除成员资料、项目接入与网站导航</small></div><button id="deleteAccountBtn">删除我的账号</button></div>
      </section>` : ''}
    </div>`;
    const modalBody = document.querySelector('#cn-modal-overlay .cn-modal > div');
    if (!modalBody) return;
    modalBody.innerHTML = body;
    bindSettingsEvents(integrations, shortcuts);
    if (window.CalpherMotion) window.CalpherMotion.settingsLoaded();
  }

  function switchSettingsTab(active) {
    const current = document.querySelector('.settings-panel.active');
    const next = document.querySelector(`.settings-panel[data-panel="${CSS.escape(active)}"]`);
    if (!next || current === next) return;
    const mutate = () => {
      document.querySelectorAll('.settings-tabs button').forEach((button) => {
        button.classList.toggle('active', button.dataset.tab === active);
      });
      document.querySelectorAll('.settings-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.panel === active);
      });
    };
    if (window.CalpherMotion) window.CalpherMotion.switchPanel(current, next, mutate);
    else mutate();
  }

  function bindSettingsEvents(integrations, shortcuts) {
    document.querySelectorAll('.settings-tabs button').forEach((button) => {
      button.addEventListener('click', () => switchSettingsTab(button.dataset.tab));
    });
    if ($('saveAppearance')) $('saveAppearance').addEventListener('click', () => {
      Cn.setAccent($('settingsAccent').value);
      sendEmbedTheme();
      refreshEmbedLaunchUrl();
      Cn.toast('强调色已更新');
    });
    document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        Cn.toast('密钥已复制');
      } catch (e) {
        Cn.toast('复制失败，请手动选中密钥');
      }
    }));
    document.querySelectorAll('[data-platform-preload]').forEach((input) => input.addEventListener('change', async () => {
      input.disabled = true;
      try {
        await fetchJSON(`/api/integrations/${encodeURIComponent(input.dataset.platformPreload)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preload: input.checked }),
        });
        await loadWorkspace();
        Cn.toast(input.checked ? '已启用子站预加载' : '已改为按需加载');
      } catch (e) {
        input.checked = !input.checked;
        Cn.toast(e.message);
      } finally {
        input.disabled = false;
      }
    }));
    if ($('integrationForm')) $('integrationForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await fetchJSON('/api/integrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            as: state.asUser,
            name: formValue('integrationName'),
            url: formValue('integrationUrl'),
            secret: formValue('integrationSecret'),
            description: formValue('integrationDescription'),
            details: formValue('integrationDetails'),
            icon: selectedIcon('integrationIcon'),
            preload: $('integrationPreload').checked,
          }),
        });
        await loadWorkspace();
        await openSettings('integrations');
        Cn.toast('接入子站已创建');
      } catch (e) { Cn.toast(e.message); }
    });
    if ($('shortcutForm')) $('shortcutForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await fetchJSON('/api/shortcuts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            as: state.asUser,
            name: formValue('shortcutName'),
            url: formValue('shortcutUrl'),
            description: formValue('shortcutDescription'),
            details: formValue('shortcutDetails'),
            icon: selectedIcon('shortcutIcon'),
          }),
        });
        await loadWorkspace();
        await openSettings('shortcuts');
        Cn.toast('网站导航已添加');
      } catch (e) { Cn.toast(e.message); }
    });
    document.querySelectorAll('[data-edit-integration]').forEach((button) => button.addEventListener('click', () => {
      const item = integrations.items.find((entry) => entry.id === button.dataset.editIntegration);
      if (item) openEditSite(item, 'integration');
    }));
    document.querySelectorAll('[data-edit-shortcut]').forEach((button) => button.addEventListener('click', () => {
      const item = shortcuts.items.find((entry) => entry.id === button.dataset.editShortcut);
      if (item) openEditSite(item, 'shortcut');
    }));
    document.querySelectorAll('[data-delete-integration]').forEach((button) => button.addEventListener('click', async () => {
      if (!await confirmAction('删除子站接入', '删除后工作台将不再展示该子站，也不会再为它签发登录票据。')) return;
      await fetchJSON(withAs(`/api/integrations/${encodeURIComponent(button.dataset.deleteIntegration)}`), { method: 'DELETE' });
      await loadWorkspace();
      await openSettings('integrations');
      Cn.toast('子站接入已删除');
    }));
    document.querySelectorAll('[data-delete-shortcut]').forEach((button) => button.addEventListener('click', async () => {
      if (!await confirmAction('删除网站导航', '确认从当前工作台移除这个网站入口？')) return;
      await fetchJSON(withAs(`/api/shortcuts/${encodeURIComponent(button.dataset.deleteShortcut)}`), { method: 'DELETE' });
      await loadWorkspace();
      await openSettings('shortcuts');
      Cn.toast('网站导航已删除');
    }));
    if ($('memberForm')) $('memberForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await fetchJSON('/api/admin/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formValue('memberName'),
            password: formValue('memberPassword'),
            integrationLimit: formValue('memberIntegrationLimit'),
            shortcutLimit: formValue('memberShortcutLimit'),
          }),
        });
        await openSettings('members');
        Cn.toast('成员已创建');
      } catch (e) { Cn.toast(e.message); }
    });
    document.querySelectorAll('[data-save-member]').forEach((button) => button.addEventListener('click', async () => {
      const row = button.closest('.member-row');
      await fetchJSON(`/api/admin/members/${encodeURIComponent(button.dataset.saveMember)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integrationLimit: row.querySelector('[data-field="integrationLimit"]').value,
          shortcutLimit: row.querySelector('[data-field="shortcutLimit"]').value,
          disabled: row.querySelector('[data-field="disabled"]').checked,
        }),
      });
      await openSettings('members');
      Cn.toast('成员配额已更新');
    }));
    document.querySelectorAll('[data-delete-member]').forEach((button) => button.addEventListener('click', async () => {
      if (!await confirmAction('删除普通成员', `确认删除 ${button.dataset.deleteMember} 及其全部工作台数据？`)) return;
      await fetchJSON(`/api/admin/members/${encodeURIComponent(button.dataset.deleteMember)}`, {
        method: 'DELETE',
      });
      await openSettings('members');
      Cn.toast('成员已删除');
    }));
    document.querySelectorAll('[data-reveal-member]').forEach((button) => button.addEventListener('click', async () => {
      const label = document.querySelector(`[data-password-for="${CSS.escape(button.dataset.revealMember)}"]`);
      if (button.dataset.visible === '1') {
        label.textContent = '密码 ••••••••';
        button.dataset.visible = '0';
        return;
      }
      try {
        const data = await fetchJSON(`/api/admin/members/${encodeURIComponent(button.dataset.revealMember)}/password`);
        label.textContent = `密码 ${data.password}`;
        button.dataset.visible = '1';
      } catch (e) { Cn.toast(e.message); }
    }));
    document.querySelectorAll('[data-view-member]').forEach((button) => button.addEventListener('click', async () => {
      Cn.closeModal();
      exitEmbed();
      state.selected = 'workbench';
      await loadWorkspace(button.dataset.viewMember);
    }));
    if ($('accountForm')) $('accountForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = await fetchJSON('/api/account', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formValue('accountName'),
            password: formValue('accountPassword'),
          }),
        });
        state.user = data.user;
        state.asUser = '';
        Cn.closeModal();
        await loadWorkspace();
        Cn.toast('账号资料已更新');
      } catch (e) { Cn.toast(e.message); }
    });
    if ($('deleteAccountBtn')) $('deleteAccountBtn').addEventListener('click', async () => {
      if (!await confirmAction('删除我的账号', '账号、项目接入、网站导航和工作台数据将被永久删除。', '永久删除')) return;
      try {
        await fetchJSON('/api/account', { method: 'DELETE' });
        location.href = '/?login=1&redirect=%2Fworkbench#login';
      } catch (e) { Cn.toast(e.message); }
    });
  }

  function doLogout() {
    location.href = '/api/auth/logout';
  }

  $('searchInput').addEventListener('input', () => renderProjectGrid($('searchInput').value));
  document.querySelectorAll('#settingsBtn, #settingsBtn2, #settingsSidebarBtn').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.id === 'settingsSidebarBtn') closeDrawer();
      openSettings().catch((e) => Cn.toast(e.message));
    });
  });
  $('logoutBtn').addEventListener('click', doLogout);
  $('refreshBtn').addEventListener('click', async () => {
    try { await loadWorkspace(); Cn.toast('数据已刷新'); } catch (e) { Cn.toast('刷新失败'); }
  });
  $('openWorkbenchBtn').addEventListener('click', () => openItem(state.selected));
  $('backBtn').addEventListener('click', exitEmbed);
  $('detailDocsBtn').addEventListener('click', showDocs);
  $('addSiteBtn').addEventListener('click', () => openAddSite('integration'));
  $('addShortcutBtn').addEventListener('click', () => openAddSite('shortcut'));

  const shell = $('appShell');
  const mqMobile = matchMedia('(max-width: 1180px)');
  function setSidebarCollapsed(collapsed) {
    shell.classList.toggle('sidebar-collapsed', collapsed);
    try { localStorage.setItem('calpher-workbench-sidebar', collapsed ? '1' : '0'); } catch (e) {}
  }
  function setDetailsCollapsed(collapsed, persist = true) {
    shell.classList.toggle('details-collapsed', collapsed);
    if (persist) {
      state.detailsOverrides[state.selected] = collapsed;
      try { localStorage.setItem('calpher-workbench-details', collapsed ? '1' : '0'); } catch (e) {}
    }
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
  $('detailsCollapseBtn').addEventListener('click', () => {
    const mutate = () => setDetailsCollapsed(!shell.classList.contains('details-collapsed'));
    if (window.CalpherMotion) window.CalpherMotion.layoutChange(mutate);
    else mutate();
  });
  $('detailsRestoreBtn').addEventListener('click', () => {
    const mutate = () => setDetailsCollapsed(false);
    if (window.CalpherMotion) window.CalpherMotion.layoutChange(mutate);
    else mutate();
  });

  Cn.initThemeToggle('#themeToggleBtn');
  window.addEventListener('calpher:themechange', () => {
    sendEmbedTheme();
    refreshEmbedLaunchUrl();
    $('detailTheme').textContent = resolvedTheme() === 'light' ? '亮色' : '暗色';
  });
  restoreLayout();
  mqMobile.addEventListener('change', () => {
    if (mqMobile.matches) shell.classList.remove('sidebar-collapsed', 'details-collapsed');
    else restoreLayout();
  });

  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  document.body.appendChild(backdrop);
  function openDrawer() { sidebar.classList.add('open'); backdrop.classList.add('show'); }
  function closeDrawer() { sidebar.classList.remove('open'); backdrop.classList.remove('show'); }
  $('burgerBtn').addEventListener('click', () => sidebar.classList.contains('open') ? closeDrawer() : openDrawer());
  backdrop.addEventListener('click', closeDrawer);

  try {
    await loadWorkspace();
    if (window.CalpherMotion) window.CalpherMotion.pageReady();
  } catch (e) {
    location.href = '/?login=1&redirect=%2Fworkbench#login';
    return;
  }

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__kypherEmbedTest__ = {
      enterEmbed,
      exitEmbed,
      refreshEmbedLaunchUrl,
      resolvedTheme,
      state,
    };
  }
})();
