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
    if (!['light', 'dark', 'system'].includes(theme)) return;
    document.documentElement.dataset.theme = theme;
    const resolved = resolveTheme(theme);
    document.documentElement.dataset.themeResolved = resolved;
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    global.dispatchEvent(new CustomEvent('calpher:themechange', {
      detail: { preference: theme, resolved },
    }));
  }

  function setAccent(accent) {
    if (!ACCENTS.includes(accent)) return;
    document.documentElement.dataset.accent = accent;
    try { localStorage.setItem(ACCENT_KEY, accent); } catch (e) {}
  }

  function initThemeToggle(btnSelector) {
    const btn = document.querySelector(btnSelector);
    if (!btn) return;
    const updateLabel = (theme) => {
      const name = { dark: '暗色', light: '亮色', system: '跟随系统' }[theme];
      if (btn.setAttribute) btn.setAttribute('aria-label', `切换显示主题，当前${name}`);
    };
    updateLabel(document.documentElement.dataset.theme || 'dark');
    btn.addEventListener('click', () => {
      const cur = document.documentElement.dataset.themeResolved || document.documentElement.dataset.theme;
      const next = cur === 'dark' ? 'light' : 'dark';
      setTheme(next);
      updateLabel(next);
    });
  }

  global.Cn = { initTheme, setTheme, setAccent, initThemeToggle };
})(globalThis);
(function (global) {
  function openModal(opts) {
    const current = document.getElementById('cn-modal-overlay');
    if (current) current.remove();
    const overlay = document.createElement('div');
    overlay.className = 'cn-modal-overlay';
    overlay.id = 'cn-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'cn-modal' + (opts.className ? ` ${opts.className}` : '');
    const title = opts.title ? `<h2>${opts.title}</h2>` : '';
    modal.innerHTML = title;
    if (typeof opts.body === 'string') modal.insertAdjacentHTML('beforeend', `<div>${opts.body}</div>`);
    const buttons = opts.buttons || [{ text: '关闭', onClick: closeModal }];
    if (buttons.length) {
      const footer = document.createElement('div');
      footer.className = 'cn-modal-footer';
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.className = 'cn-btn' + (b.primary ? ' cn-btn-primary' : '');
        btn.textContent = b.text;
        btn.addEventListener('click', () => { if (b.onClick) b.onClick(); });
        footer.appendChild(btn);
      }
      modal.appendChild(footer);
    }
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && opts.closable !== false) closeModal(); });
    document.body.appendChild(overlay);
    if (global.CalpherMotion) global.CalpherMotion.modalOpened(overlay);
    return overlay;
  }

  function closeModal() {
    const el = document.getElementById('cn-modal-overlay');
    if (!el) return;
    if (global.CalpherMotion) global.CalpherMotion.modalClose(el, () => el.remove());
    else el.remove();
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
