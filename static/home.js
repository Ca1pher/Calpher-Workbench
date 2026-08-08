export function initHome(gsapApi, ScrollTriggerApi) {
  var loginLayer = document.getElementById('loginLayer');
  var loginForm = document.getElementById('homeLoginForm');
  var loginError = document.getElementById('homeLoginError');
  var loginName = document.getElementById('homeLoginName');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mediaContext = null;

  if (gsapApi && ScrollTriggerApi) {
    document.documentElement.dataset.motionRuntime = 'ready';
  }

  function destination() {
    var raw = new URLSearchParams(location.search).get('redirect');
    if (!raw) return '/workbench';
    try {
      var target = new URL(raw, location.origin);
      if (target.origin === location.origin) return target.pathname + target.search + target.hash;
      if (target.protocol === 'https:') return '/api/auth/handoff?redirect=' + encodeURIComponent(target.toString());
    } catch (e) {}
    return '/workbench';
  }

  function openLogin() {
    loginLayer.hidden = false;
    document.body.classList.add('login-open');
    history.replaceState(null, '', location.pathname + '?login=1' + (new URLSearchParams(location.search).get('redirect') ? '&redirect=' + encodeURIComponent(new URLSearchParams(location.search).get('redirect')) : '') + '#login');
    requestAnimationFrame(function () {
      loginName.focus();
      if (gsapApi && !reducedMotion.matches) {
        gsapApi.fromTo('.login-backdrop', { autoAlpha: 0 }, { autoAlpha: 1, duration: .28, ease: 'power2.out' });
        gsapApi.fromTo('.login-dialog', { autoAlpha: 0, y: 22, scale: .985 }, { autoAlpha: 1, y: 0, scale: 1, duration: .52, ease: 'power3.out' });
      }
    });
  }

  function closeLogin() {
    function finish() {
      loginLayer.hidden = true;
      document.body.classList.remove('login-open');
      history.replaceState(null, '', '/');
    }
    if (gsapApi && !reducedMotion.matches) {
      gsapApi.to('.login-dialog', { autoAlpha: 0, y: 12, duration: .22, ease: 'power2.in' });
      gsapApi.to('.login-backdrop', { autoAlpha: 0, duration: .24, ease: 'power2.in', onComplete: finish });
    } else {
      finish();
    }
  }

  document.querySelectorAll('#navEnterBtn, #heroEnterBtn, #flowEnterBtn, #closingEnterBtn').forEach(function (button) {
    button.addEventListener('click', openLogin);
  });
  document.querySelectorAll('[data-close-login]').forEach(function (button) {
    button.addEventListener('click', closeLogin);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !loginLayer.hidden) closeLogin();
  });

  loginForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = loginForm.querySelector('button[type="submit"]');
    loginError.hidden = true;
    button.disabled = true;
    button.querySelector('span').textContent = '正在验证';
    try {
      var response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: loginName.value.trim(),
          pass: document.getElementById('homeLoginPass').value,
        }),
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || '登录失败');
      location.href = destination();
    } catch (error) {
      loginError.textContent = error.message;
      loginError.hidden = false;
      button.disabled = false;
      button.querySelector('span').textContent = '登录并继续';
    }
  });

  var themeButton = document.getElementById('homeThemeBtn');
  themeButton.addEventListener('click', function () {
    var current = document.documentElement.dataset.themeResolved || 'dark';
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.dataset.themeResolved = next;
    try { localStorage.setItem('calpher-workbench-theme', next); } catch (e) {}
  });

  fetch('/api/me').then(function (response) {
    if (!response.ok) return null;
    return response.json();
  }).then(function (user) {
    if (!user) return;
    document.querySelectorAll('#navEnterBtn span, #heroEnterBtn span, #flowEnterBtn, #closingEnterBtn span').forEach(function (label) {
      if (label.id === 'flowEnterBtn') label.childNodes[0].nodeValue = '返回工作台 ';
      else label.textContent = '返回工作台';
    });
    document.querySelectorAll('#navEnterBtn, #heroEnterBtn, #flowEnterBtn, #closingEnterBtn').forEach(function (button) {
      button.removeEventListener('click', openLogin);
      button.addEventListener('click', function () { location.href = '/workbench'; });
    });
  }).catch(function () {});

  if (gsapApi && ScrollTriggerApi) {
    gsapApi.registerPlugin(ScrollTriggerApi);
    mediaContext = gsapApi.matchMedia();
    mediaContext.add({
      desktop: '(min-width: 901px)',
      mobile: '(max-width: 900px)',
      reduce: '(prefers-reduced-motion: reduce)',
    }, function (context) {
      var conditions = context.conditions;
      if (conditions.reduce) {
        gsapApi.set('[data-intro], .hero-line i, [data-reveal], [data-system-card], [data-flow-step]', { clearProps: 'all' });
        return;
      }

      var intro = gsapApi.timeline({ defaults: { ease: 'power3.out' } });
      intro
        .from('[data-home-nav]', { y: -28, autoAlpha: 0, duration: .7 })
        .from('.hero-kicker', { y: 14, autoAlpha: 0, duration: .55 }, '-=.35')
        .from('.hero-line i', { yPercent: 110, duration: 1.05, stagger: .1 }, '-=.35')
        .from('.hero-bottom', { y: 26, autoAlpha: 0, duration: .75 }, '-=.55')
        .from('.hero-scroll', { autoAlpha: 0, duration: .5 }, '-=.3');

      gsapApi.to('.hero-media img', {
        yPercent: 8,
        scale: 1.08,
        ease: 'none',
        scrollTrigger: { trigger: '.home-hero', start: 'top top', end: 'bottom top', scrub: .8 },
      });

      gsapApi.utils.toArray('[data-reveal], [data-reveal-text]').forEach(function (element) {
        gsapApi.from(element, {
          y: 54,
          autoAlpha: 0,
          duration: .9,
          ease: 'power3.out',
          scrollTrigger: { trigger: element, start: 'clamp(top 84%)', once: true },
        });
      });

      gsapApi.from('[data-system-card]', {
        y: 70,
        autoAlpha: 0,
        stagger: .12,
        duration: .85,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.system-track', start: 'clamp(top 82%)', once: true },
      });

      gsapApi.utils.toArray('[data-flow-step]').forEach(function (step) {
        gsapApi.from(step.children, {
          x: conditions.desktop ? 38 : 0,
          y: conditions.mobile ? 28 : 0,
          autoAlpha: 0,
          stagger: .08,
          duration: .7,
          ease: 'power2.out',
          scrollTrigger: { trigger: step, start: 'clamp(top 82%)', once: true },
        });
      });

      gsapApi.from('[data-closing] > *', {
        y: 45,
        autoAlpha: 0,
        stagger: .12,
        duration: .85,
        ease: 'power3.out',
        scrollTrigger: { trigger: '[data-closing]', start: 'clamp(top 70%)', once: true },
      });

      if (conditions.desktop && window.matchMedia('(hover: hover)').matches) {
        var pointer = document.querySelector('.hero-pointer');
        var xTo = gsapApi.quickTo(pointer, 'x', { duration: .7, ease: 'power3.out' });
        var yTo = gsapApi.quickTo(pointer, 'y', { duration: .7, ease: 'power3.out' });
        var hero = document.querySelector('.home-hero');
        function movePointer(event) { xTo(event.clientX); yTo(event.clientY); }
        hero.addEventListener('pointermove', movePointer);

        document.querySelectorAll('[data-system-card]').forEach(function (card) {
          var rotateX = gsapApi.quickTo(card, 'rotationX', { duration: .35, ease: 'power2.out' });
          var rotateY = gsapApi.quickTo(card, 'rotationY', { duration: .35, ease: 'power2.out' });
          function tilt(event) {
            var rect = card.getBoundingClientRect();
            rotateX((.5 - (event.clientY - rect.top) / rect.height) * 4);
            rotateY(((event.clientX - rect.left) / rect.width - .5) * 5);
          }
          function reset() { rotateX(0); rotateY(0); }
          card.addEventListener('pointermove', tilt);
          card.addEventListener('pointerleave', reset);
          context.add(function () {
            card.removeEventListener('pointermove', tilt);
            card.removeEventListener('pointerleave', reset);
          });
        });
        context.add(function () { hero.removeEventListener('pointermove', movePointer); });
      }
    }, document.body);
    document.documentElement.dataset.scrollTriggers = String(ScrollTriggerApi.getAll().length);
  }

  if (location.hash === '#login' || new URLSearchParams(location.search).get('login') === '1') openLogin();
  window.addEventListener('pagehide', function () {
    if (mediaContext) mediaContext.revert();
    document.documentElement.dataset.motionRuntime = 'cleaned';
  }, { once: true });
}
