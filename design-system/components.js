(function (global) {
  const THEME_KEY = 'calpher-workbench-theme';
  const ACCENT_KEY = 'calpher-workbench-accent';
  const ACCENTS = ['emerald', 'ocean', 'iris', 'amber', 'sakura'];

  function resolveTheme(pref) {
    if (pref === 'system') {
      return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return pref;
  }

  function initTheme() {
    let theme = 'dark';
    try { theme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
    let accent = 'ocean';
    try { accent = localStorage.getItem(ACCENT_KEY) || 'ocean'; } catch (e) {}
    if (!['light', 'dark', 'system'].includes(theme)) theme = 'dark';
    if (!ACCENTS.includes(accent)) accent = 'ocean';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeResolved = resolveTheme(theme);
    document.documentElement.dataset.accent = accent;
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeResolved = resolveTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  function setAccent(accent) {
    if (!ACCENTS.includes(accent)) return;
    document.documentElement.dataset.accent = accent;
    try { localStorage.setItem(ACCENT_KEY, accent); } catch (e) {}
  }

  function initThemeToggle(btnSelector) {
    const btn = document.querySelector(btnSelector);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme;
      const next = cur === 'dark' ? 'light' : cur === 'light' ? 'system' : 'dark';
      setTheme(next);
      const name = { dark: '暗色', light: '亮色', system: '跟随系统' }[next];
      if (btn.setAttribute) btn.setAttribute('aria-label', `切换显示主题，当前${name}`);
    });
  }

  global.Cn = { initTheme, setTheme, setAccent, initThemeToggle };
})(globalThis);
(function (global) {
  function openModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'cn-modal-overlay';
    overlay.id = 'cn-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'cn-modal';
    const title = opts.title ? `<h2 style="margin:0 0 14px;font-size:16px">${opts.title}</h2>` : '';
    let body = '';
    if (opts.body) {
      body = typeof opts.body === 'string' ? `<div>${opts.body}</div>` : '<div></div>';
      if (typeof opts.body === 'string') {
        modal.insertAdjacentHTML('beforeend', `<div>${opts.body}</div>`);
      }
    }
    modal.innerHTML = title;
    if (typeof opts.body === 'string') modal.insertAdjacentHTML('beforeend', `<div>${opts.body}</div>`);
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:18px';
    const buttons = opts.buttons || [{ text: '关闭', onClick: closeModal }];
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'cn-btn' + (b.primary ? ' cn-btn-primary' : '');
      btn.textContent = b.text;
      btn.addEventListener('click', () => { if (b.onClick) b.onClick(); });
      footer.appendChild(btn);
    }
    modal.appendChild(footer);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && opts.closable !== false) closeModal(); });
    document.body.appendChild(overlay);
    return overlay;
  }

  function closeModal() {
    const el = document.getElementById('cn-modal-overlay');
    if (el) el.remove();
  }

  function toast(msg) {
    let el = document.querySelector('.cn-toast');
    if (!el) { el = document.createElement('div'); el.className = 'cn-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 2400);
  }

  const api = global.Cn = global.Cn || {};
  api.openModal = openModal;
  api.closeModal = closeModal;
  api.toast = toast;
})(globalThis);
