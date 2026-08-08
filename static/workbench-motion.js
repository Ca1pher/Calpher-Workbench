export function initWorkbenchMotion(gsap, Flip, ScrollTrigger) {
  var root = document.getElementById('appShell');
  if (!root) return;

  var media = gsap.matchMedia();
  var ready = false;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var viewTimeline = null;
  var modalTimeline = null;
  var boundElements = new Set();

  document.documentElement.dataset.workbenchMotion = 'ready';

  function clearElementBinding(element) {
    if (!element || !element._calpherMotionCleanup) return;
    element._calpherMotionCleanup();
    delete element._calpherMotionCleanup;
    boundElements.delete(element);
  }

  function bindPressFeedback(container) {
    if (!container || container._calpherPressBound) return;
    var active = null;
    function reset() {
      if (!active) return;
      gsap.to(active, { scale: 1, duration: .24, ease: 'power2.out', overwrite: true, clearProps: 'transform' });
      active = null;
    }
    function press(event) {
      if (reduced || event.button > 0) return;
      var target = event.target.closest('button, .project-card');
      if (!target || target.disabled || !container.contains(target)) return;
      active = target;
      gsap.to(target, { scale: .975, duration: .16, ease: 'power2.out', overwrite: true });
    }
    container.addEventListener('pointerdown', press);
    window.addEventListener('pointerup', reset);
    window.addEventListener('pointercancel', reset);
    container._calpherPressBound = true;
    container._calpherMotionCleanup = function () {
      container.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', reset);
      window.removeEventListener('pointercancel', reset);
    };
    boundElements.add(container);
  }

  function bindMetricCards(container) {
    if (!container) return;
    container.querySelectorAll('.metric-card').forEach(function (card) {
      clearElementBinding(card);
      if (reduced || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      var frame = 0;
      function move(event) {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(function () {
          var rect = card.getBoundingClientRect();
          card.style.setProperty('--pointer-x', ((event.clientX - rect.left) / rect.width * 100).toFixed(1) + '%');
          card.style.setProperty('--pointer-y', ((event.clientY - rect.top) / rect.height * 100).toFixed(1) + '%');
        });
      }
      function enter() {
        gsap.to(card, { y: -4, duration: .3, ease: 'power2.out', overwrite: true });
      }
      function leave() {
        gsap.to(card, { y: 0, duration: .4, ease: 'power3.out', overwrite: true, clearProps: 'transform' });
      }
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerenter', enter);
      card.addEventListener('pointerleave', leave);
      card._calpherMotionCleanup = function () {
        if (frame) cancelAnimationFrame(frame);
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerenter', enter);
        card.removeEventListener('pointerleave', leave);
        gsap.killTweensOf(card);
      };
      boundElements.add(card);
    });
  }

  function bindProjectCards(container) {
    if (!container) return;
    container.querySelectorAll('.project-card').forEach(function (card) {
      clearElementBinding(card);
      if (reduced || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      var icon = card.querySelector('.pc-icon');
      function enter() {
        gsap.to(card, { y: -3, duration: .28, ease: 'power2.out', overwrite: true });
        if (icon) gsap.to(icon, { x: 3, rotation: 3, duration: .28, ease: 'power2.out', overwrite: true });
      }
      function leave() {
        gsap.to(card, { y: 0, duration: .38, ease: 'power3.out', overwrite: true, clearProps: 'transform' });
        if (icon) gsap.to(icon, { x: 0, rotation: 0, duration: .38, ease: 'power3.out', overwrite: true, clearProps: 'transform' });
      }
      card.addEventListener('pointerenter', enter);
      card.addEventListener('pointerleave', leave);
      card._calpherMotionCleanup = function () {
        card.removeEventListener('pointerenter', enter);
        card.removeEventListener('pointerleave', leave);
        gsap.killTweensOf(icon ? [card, icon] : card);
      };
      boundElements.add(card);
    });
  }

  function toggleQueueGroup(group) {
    var items = group && group.querySelector('.group-items');
    if (!items) return;
    var opening = !group.classList.contains('open');
    if (reduced) {
      group.classList.toggle('open', opening);
      return;
    }
    gsap.killTweensOf(items);
    if (opening) {
      group.classList.add('open');
      gsap.fromTo(items,
        { height: 0, autoAlpha: 0 },
        { height: 'auto', autoAlpha: 1, duration: .42, ease: 'power3.out', clearProps: 'height,opacity,visibility' });
    } else {
      gsap.to(items, {
        height: 0,
        autoAlpha: 0,
        duration: .32,
        ease: 'power2.inOut',
        onComplete: function () {
          group.classList.remove('open');
          gsap.set(items, { clearProps: 'height,opacity,visibility' });
        },
      });
    }
  }

  function bindQueue(container) {
    if (!container) return;
    container.querySelectorAll('.queue-group').forEach(function (group) {
      clearElementBinding(group);
      var head = group.querySelector('.group-head');
      function click() { toggleQueueGroup(group); }
      head.addEventListener('click', click);
      group._calpherMotionCleanup = function () {
        head.removeEventListener('click', click);
        gsap.killTweensOf(group.querySelector('.group-items'));
      };
      boundElements.add(group);
    });
  }

  function pageReady() {
    ready = true;
    bindPressFeedback(root);
    if (reduced) {
      gsap.set(root.querySelectorAll('[style]'), { clearProps: 'opacity,visibility,transform' });
      return;
    }

    media.add({
      desktop: '(min-width: 1181px)',
      mobile: '(max-width: 1180px)',
      reduce: '(prefers-reduced-motion: reduce)',
    }, function (context) {
      if (context.conditions.reduce) return;
      if (context.conditions.desktop) {
        gsap.timeline({ defaults: { ease: 'power3.out' } })
          .from('.sidebar', { x: -24, autoAlpha: 0, duration: .72 })
          .from('.topbar > *', { y: -14, autoAlpha: 0, duration: .55, stagger: .06 }, '-=.48')
          .from('.metric-card', { y: 24, autoAlpha: 0, duration: .62, stagger: .07 }, '-=.32')
          .from('.queue-pane, .carousel-panel', { y: 24, autoAlpha: 0, duration: .65, stagger: .08 }, '-=.42')
          .from('.details-panel', { x: 22, autoAlpha: 0, duration: .65 }, '-=.55');
      } else {
        gsap.timeline({ defaults: { ease: 'power3.out' } })
          .from('.topbar', { y: -16, autoAlpha: 0, duration: .55 })
          .from('.metric-card', { y: 20, autoAlpha: 0, duration: .5, stagger: .06 }, '-=.25');

        gsap.utils.toArray('.queue-pane, .carousel-panel, .details-panel').forEach(function (section) {
          gsap.from(section, {
            y: 30,
            autoAlpha: 0,
            duration: .65,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: section,
              start: 'clamp(top 88%)',
              once: true,
            },
          });
        });
        ScrollTrigger.refresh();
      }
    }, root);
    document.documentElement.dataset.workbenchScrollTriggers = String(ScrollTrigger.getAll().length);
  }

  function animateRendered(container, selector, options) {
    if (!ready || reduced || !container) return;
    var targets = container.querySelectorAll(selector);
    if (!targets.length) return;
    gsap.fromTo(targets,
      { y: options.y || 12, autoAlpha: 0 },
      {
        y: 0,
        autoAlpha: 1,
        duration: options.duration || .42,
        stagger: options.stagger || .045,
        ease: options.ease || 'power3.out',
        overwrite: true,
        clearProps: 'opacity,visibility,transform',
      });
  }

  function transitionView(mode, mutate) {
    if (viewTimeline) viewTimeline.kill();
    if (reduced) {
      mutate();
      return Promise.resolve();
    }
    var current = mode === 'embed'
      ? root.querySelectorAll('.metric-grid, .workspace-grid')
      : root.querySelectorAll('.embed-host');
    return new Promise(function (resolve) {
      viewTimeline = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        onComplete: function () {
          viewTimeline = null;
          resolve();
        },
      });
      viewTimeline
        .to(current, { y: mode === 'embed' ? -10 : 10, autoAlpha: 0, duration: .18 })
        .add(mutate)
        .fromTo(
          mode === 'embed' ? '.embed-host' : '.metric-grid, .workspace-grid',
          { y: mode === 'embed' ? 18 : -12, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: .48, ease: 'power3.out', clearProps: 'opacity,visibility,transform' },
        );
    });
  }

  function layoutChange(mutate) {
    if (reduced || matchMedia('(max-width: 1180px)').matches) {
      mutate();
      return;
    }
    var targets = [root.querySelector('.sidebar'), root.querySelector('.core'), root.querySelector('.details-panel')];
    var state = Flip.getState(targets);
    mutate();
    Flip.from(state, {
      duration: .46,
      ease: 'power3.inOut',
      simple: true,
      scale: false,
      prune: true,
    });
  }

  function detailChanged() {
    if (!ready || reduced) return;
    var panel = document.getElementById('detailsContent');
    if (!panel || root.classList.contains('details-collapsed')) return;
    gsap.fromTo(panel.children,
      { x: 10, autoAlpha: 0 },
      { x: 0, autoAlpha: 1, duration: .38, stagger: .045, ease: 'power2.out', overwrite: true, clearProps: 'opacity,visibility,transform' });
  }

  function transitionScreen(show) {
    var layer = document.getElementById('embedLoading');
    if (!layer) return;
    gsap.killTweensOf([layer, layer.querySelectorAll('.transition-brand, .transition-main > *, .transition-progress, .transition-footer')]);
    if (show) {
      layer.style.display = 'grid';
      if (reduced) {
        gsap.set(layer, { autoAlpha: 1 });
        return;
      }
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: .24 })
        .from('.transition-brand', { y: -10, autoAlpha: 0, duration: .42 }, '-=.08')
        .from('.transition-main > *', { y: 18, autoAlpha: 0, duration: .5, stagger: .07 }, '-=.28')
        .from('.transition-progress, .transition-footer', { y: 10, autoAlpha: 0, duration: .4, stagger: .06 }, '-=.3');
    } else if (reduced) {
      layer.style.display = 'none';
    } else {
      gsap.to(layer, {
        autoAlpha: 0,
        duration: .28,
        ease: 'power2.in',
        onComplete: function () {
          layer.style.display = 'none';
          gsap.set(layer, { clearProps: 'opacity,visibility' });
        },
      });
    }
  }

  function modalOpened(overlay) {
    if (!overlay || reduced) return;
    if (modalTimeline) modalTimeline.kill();
    var modal = overlay.querySelector('.cn-modal');
    modalTimeline = gsap.timeline({ defaults: { ease: 'power3.out' } })
      .fromTo(overlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: .24 })
      .fromTo(modal, { y: 22, scale: .985, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: .5 }, '-=.14');
  }

  function modalClose(overlay, remove) {
    if (!overlay) return;
    if (reduced) {
      remove();
      return;
    }
    if (modalTimeline) modalTimeline.kill();
    var modal = overlay.querySelector('.cn-modal');
    modalTimeline = gsap.timeline({ defaults: { ease: 'power2.in' }, onComplete: remove })
      .to(modal, { y: 10, scale: .99, autoAlpha: 0, duration: .2 })
      .to(overlay, { autoAlpha: 0, duration: .2 }, '-=.12');
  }

  function settingsLoaded() {
    if (reduced) return;
    gsap.fromTo('.settings-tabs button, .settings-panel.active > *',
      { y: 10, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: .38, stagger: .035, ease: 'power2.out', clearProps: 'opacity,visibility,transform' });
  }

  function switchPanel(current, next, mutate) {
    if (reduced || !current || !next) {
      mutate();
      return;
    }
    gsap.to(current, {
      x: -8,
      autoAlpha: 0,
      duration: .18,
      ease: 'power2.in',
      onComplete: function () {
        mutate();
        gsap.fromTo(next, { x: 10, autoAlpha: 0 }, {
          x: 0,
          autoAlpha: 1,
          duration: .36,
          ease: 'power3.out',
          clearProps: 'opacity,visibility,transform',
        });
      },
    });
  }

  window.CalpherMotion = {
    pageReady: pageReady,
    metricsRendered: function (container) {
      bindMetricCards(container);
      animateRendered(container, '.metric-card', { y: 14, duration: .46, stagger: .055 });
    },
    projectsRendered: function (container) {
      bindProjectCards(container);
      animateRendered(container, '.project-card, .project-empty', { y: 10, duration: .38, stagger: .035 });
    },
    queueRendered: function (container) {
      bindQueue(container);
      animateRendered(container, '.queue-group', { y: 10, duration: .4, stagger: .06 });
    },
    navRendered: function (container) {
      animateRendered(container, '.nav-item, .nav-section-label', { y: 7, duration: .32, stagger: .025 });
    },
    detailChanged: detailChanged,
    transitionView: transitionView,
    layoutChange: layoutChange,
    transitionScreen: transitionScreen,
    modalOpened: modalOpened,
    modalClose: modalClose,
    settingsLoaded: settingsLoaded,
    switchPanel: switchPanel,
  };

  window.addEventListener('pagehide', function () {
    if (viewTimeline) viewTimeline.kill();
    if (modalTimeline) modalTimeline.kill();
    boundElements.forEach(clearElementBinding);
    media.revert();
    ScrollTrigger.getAll().forEach(function (trigger) { trigger.kill(); });
    document.documentElement.dataset.workbenchMotion = 'cleaned';
  }, { once: true });
}
