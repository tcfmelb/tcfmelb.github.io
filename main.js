/* Tamil Christian Fellowship Melbourne — shared site script (every page).
   Header, mobile menu, reveal motion, desktop pointer effects, announcement bar, events and copy buttons.
   Content for events and the announcement bar lives in /data/*.json (edited in Pages CMS). */
(function () {
  'use strict';

  var CAMPUSES = [
    { slug: 'melton', name: 'Melton' },
    { slug: 'mernda', name: 'Mernda' },
    { slug: 'sunshine', name: 'Sunshine' },
    { slug: 'tarneit', name: 'Tarneit' },
    { slug: 'noble-park', name: 'Noble Park' }
  ];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  var root = document.documentElement;
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.menu-toggle');
  var menu = document.getElementById('mobile-menu');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  /* ---------- Header + hero parallax ---------- */
  var heroMedia = document.querySelector('.hero__media');
  var hero = document.querySelector('.hero');
  var heroH = hero ? hero.offsetHeight : 0;
  var announce = null;
  var annH = 0;
  var ticking = false;
  function onScroll() {
    var y = window.scrollY;
    var menuOpen = menu && !menu.hidden;
    if (header) {
      header.classList.toggle('is-solid', y > 24 || menuOpen);
      header.classList.toggle('is-compact', y > 120 && !menuOpen && !reduce.matches);
    }
    if (announce) root.style.setProperty('--ann', Math.max(0, annH - y) + 'px');
    if (heroMedia) {
      heroMedia.style.transform = (reduce.matches || y > heroH) ? '' : 'translate3d(0,' + (y * 0.15).toFixed(1) + 'px,0)';
    }
    fxParallax();
    ticking = false;
  }

  /* ---------- Section backgrounds (.bgfx) ----------
     Animations run only while a section is on screen and the tab is visible
     (CSS pauses .bgfx without .is-live). Parallax moves [data-depth] layers with
     transforms only, at 768px and wider, and never with reduced motion. */
  var fxWide = window.matchMedia('(min-width: 768px)');
  var fxBoxes = [];
  var fxOn = false;
  function fxParallax() {
    var on = fxWide.matches && !reduce.matches;
    if (!on && !fxOn) return;
    var vh = window.innerHeight;
    for (var i = 0; i < fxBoxes.length; i++) {
      var b = fxBoxes[i];
      if (!on) { b.layers.forEach(function (l) { l.style.transform = ''; }); continue; }
      if (!b.visible) continue;
      var r = b.el.getBoundingClientRect();
      var off = (r.top + r.height / 2) - vh / 2;
      b.layers.forEach(function (l) {
        l.style.transform = 'translate3d(0,' + (off * -l._depth).toFixed(1) + 'px,0)';
      });
    }
    fxOn = on;
  }
  (function initFx() {
    var nodes = document.querySelectorAll('.bgfx');
    if (!nodes.length) return;
    nodes.forEach(function (el) {
      var layers = Array.prototype.slice.call(el.querySelectorAll('[data-depth]'));
      layers.forEach(function (l) { l._depth = parseFloat(l.getAttribute('data-depth')) || 0; });
      fxBoxes.push({ el: el, layers: layers, visible: false });
    });
    function sync() {
      fxBoxes.forEach(function (b) { b.el.classList.toggle('is-live', b.visible && !document.hidden); });
    }
    if ('IntersectionObserver' in window) {
      var fio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          for (var i = 0; i < fxBoxes.length; i++) if (fxBoxes[i].el === en.target) fxBoxes[i].visible = en.isIntersecting;
        });
        sync();
        fxParallax();
      }, { rootMargin: '120px 0px' });
      fxBoxes.forEach(function (b) { fio.observe(b.el); });
    } else {
      fxBoxes.forEach(function (b) { b.visible = true; });
      sync();
    }
    document.addEventListener('visibilitychange', sync);
    fxWide.addEventListener('change', fxParallax);
    reduce.addEventListener('change', fxParallax);
  })();
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  window.addEventListener('resize', function () {
    heroH = hero ? hero.offsetHeight : 0;
    if (announce) annH = announce.offsetHeight;
    onScroll();
  }, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  if (toggle && menu) {
    var setMenu = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      menu.hidden = !open;
      onScroll();
    };
    toggle.addEventListener('click', function () { setMenu(menu.hidden); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) { setMenu(false); toggle.focus(); }
    });
    window.matchMedia('(min-width: 60rem)').addEventListener('change', function (e) { if (e.matches) setMenu(false); });
  }

  /* ---------- Dropdowns (Services menu, "Change campus") ----------
     Native <details> already works with keyboard and touch. This adds: only one open
     at a time, close on outside click/tap, close when focus leaves, and Escape to close. */
  var drops = Array.prototype.slice.call(document.querySelectorAll('details[data-drop]'));
  function closeDrop(d, focus) {
    if (!d.open) return;
    d.open = false;
    if (focus) d.querySelector('summary').focus();
  }
  drops.forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) drops.forEach(function (o) { if (o !== d) closeDrop(o); });
    });
    d.addEventListener('focusout', function (e) {
      if (e.relatedTarget && !d.contains(e.relatedTarget)) closeDrop(d);
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && d.open) { e.stopPropagation(); closeDrop(d, true); }
    });
  });
  document.addEventListener('click', function (e) {
    drops.forEach(function (d) { if (!d.contains(e.target)) closeDrop(d); });
  });

  /* ---------- Latest message: click-to-load YouTube (youtube-nocookie.com) ----------
     Nothing is requested from YouTube until the button is pressed. If the player cannot load
     (offline, blocked, or no response), the player area is removed and only the
     "Watch all messages" button remains. */
  document.querySelectorAll('[data-yt-list]').forEach(function (box) {
    var btn = box.querySelector('.watch__facade');
    if (!btn) return;
    function fail() {
      var section = box.closest('section');
      var fallback = section && section.querySelector('.section-foot a');
      var hadFocus = box.contains(document.activeElement);
      box.remove();
      if (hadFocus && fallback) fallback.focus();
    }
    btn.addEventListener('click', function () {
      if (navigator.onLine === false) { fail(); return; }
      var list = box.getAttribute('data-yt-list');
      if (!/^[A-Za-z0-9_-]+$/.test(list)) { fail(); return; }
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/videoseries?list=' + list + '&autoplay=1&rel=0&modestbranding=1';
      f.title = 'Latest message — Tamil Christian Fellowship Melbourne on YouTube';
      f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      var timer = setTimeout(fail, 15000);
      f.addEventListener('load', function () { clearTimeout(timer); });
      f.addEventListener('error', function () { clearTimeout(timer); fail(); });
      box.replaceChild(f, btn);
      f.focus();
    });
  });

  /* ---------- Announcement bar (/data/announcement.json) ---------- */
  getJSON('/data/announcement.json').then(function (a) {
    if (!a || !a.enabled || !a.text) return;
    announce = document.createElement('div');
    announce.className = 'announce';
    announce.setAttribute('role', 'region');
    announce.setAttribute('aria-label', 'Announcement');
    var link = typeof a.link === 'string' ? a.link.trim() : '';
    announce.innerHTML = /^(https?:\/\/|\/)/.test(link)
      ? '<a href="' + esc(link) + '">' + esc(a.text) + '</a>'
      : esc(a.text);
    var skip = document.querySelector('.skip-link');
    document.body.insertBefore(announce, skip ? skip.nextSibling : document.body.firstChild);
    annH = announce.offsetHeight;
    onScroll();
  }).catch(function () { /* no announcement — nothing to show */ });

  /* ---------- Reveal on scroll ----------
     Staggered within each batch that enters together. With reduced motion
     the CSS turns this into a plain opacity fade. */
  function clearDelay(el) {
    el.addEventListener('transitionend', function done(ev) {
      if (ev.propertyName === 'opacity') { el.style.transitionDelay = ''; el.removeEventListener('transitionend', done); }
    });
  }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    var batch = entries.filter(function (en) { return en.isIntersecting; }).map(function (en) { return en.target; });
    batch.sort(function (a, b) { return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
    batch.forEach(function (el, i) {
      if (i) { el.style.transitionDelay = Math.min(i, 6) * 90 + 'ms'; clearDelay(el); }
      el.classList.add('is-in');
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
  function reveal(el) { if (io) io.observe(el); else el.classList.add('is-in'); }

  /* ---------- Pointer effects (desktop only) ----------
     Gold dot that follows the pointer exactly, a soft ring that trails it and
     grows over links, buttons and cards, a gold glow on light sections and a
     spotlight on navy ones, a gold border glow that follows the pointer on the
     card under it, and a magnetic pull (max 6px) on buttons.
     Only with a fine pointer + hover, 768px and wider, and no reduced motion.
     Everything moves with transform/translate/opacity inside one
     requestAnimationFrame loop that stops when idle and when the tab is hidden;
     the card glow updates a gradient position on the one card under the pointer. */
  (function pointerFx() {
    var wideFx = window.matchMedia('(min-width: 768px)');
    var CARD = '.campus, .sunday, .event, .expect, .connect-card, .give-card, .ministry, .faq details';
    var HOT = 'a, button, summary, [role="button"], input, select, textarea, label';
    var DARK = '.on-dark, .hero, .site-footer, .campus--info, .watch__player';
    var layer, dot, ring, glow, spot, raf = 0, seen = false;
    var tx = 0, ty = 0, rx = 0, ry = 0, gx = 0, gy = 0;
    var card = null, cx = 0, cy = 0, btn = null, bx = 0, by = 0;
    function enabled() { return fine.matches && wideFx.matches && !reduce.matches; }
    function clamp(v) { return Math.max(-6, Math.min(6, v)); }
    function build() {
      layer = document.createElement('div');
      layer.className = 'pfx';
      layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = '<div class="pfx__glow"></div><div class="pfx__spot"></div><div class="pfx__ring"></div><div class="pfx__dot"></div>';
      document.body.appendChild(layer);
      glow = layer.children[0]; spot = layer.children[1]; ring = layer.children[2]; dot = layer.children[3];
    }
    function setCard(c) {
      if (c === card) return;
      if (card) card.classList.remove('is-glow');
      card = c;
      if (card) card.classList.add('is-glow');
    }
    function setBtn(b) {
      if (b === btn) return;
      if (btn) btn.style.translate = '';
      btn = b; bx = by = 0;
    }
    function frame() {
      raf = 0;
      rx += (tx - rx) * 0.2; ry += (ty - ry) * 0.2;
      gx += (tx - gx) * 0.1; gy += (ty - gy) * 0.1;
      dot.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)';
      ring.style.transform = 'translate3d(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px,0)';
      glow.style.transform = spot.style.transform = 'translate3d(' + gx.toFixed(1) + 'px,' + gy.toFixed(1) + 'px,0)';
      if (card) { card.style.setProperty('--mx', cx.toFixed(0) + 'px'); card.style.setProperty('--my', cy.toFixed(0) + 'px'); }
      if (btn) btn.style.translate = bx.toFixed(1) + 'px ' + by.toFixed(1) + 'px';
      if (Math.abs(tx - gx) > 0.3 || Math.abs(ty - gy) > 0.3) raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (layer) layer.classList.remove('is-on');
      setCard(null); setBtn(null);
      seen = false;
    }
    function update(t) {
      var hot = !!t.closest(HOT);
      var c = t.closest(CARD);
      layer.classList.add('is-on');
      layer.classList.toggle('is-hot', hot);
      layer.classList.toggle('is-card', !!c && !hot);
      layer.classList.toggle('is-dark', !!t.closest(DARK));
      setCard(c);
      if (card) { var r = card.getBoundingClientRect(); cx = tx - r.left; cy = ty - r.top; }
      setBtn(t.closest('.btn'));
      if (btn) {
        var br = btn.getBoundingClientRect();
        bx = clamp((tx - (br.left + br.width / 2)) * 0.18);
        by = clamp((ty - (br.top + br.height / 2)) * 0.3);
      }
      if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
    }
    document.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || !enabled()) { stop(); return; }
      if (!layer) build();
      tx = e.clientX; ty = e.clientY;
      if (!seen) { rx = gx = tx; ry = gy = ty; seen = true; }
      update(e.target.closest ? e.target : document.body);
    }, { passive: true });
    // Scrolling under a still pointer: re-check what is under it (once per frame)
    var scrollPending = false;
    window.addEventListener('scroll', function () {
      if (!seen || scrollPending || document.hidden) return;
      scrollPending = true;
      requestAnimationFrame(function () {
        scrollPending = false;
        if (!seen) return;
        var el = document.elementFromPoint(tx, ty);
        if (el) update(el);
      });
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', stop);
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });
    [wideFx, reduce, fine].forEach(function (m) { m.addEventListener('change', function () { if (!enabled()) stop(); }); });
  })();

  function enhance(scope) {
    scope.querySelectorAll('.reveal').forEach(reveal);
  }
  enhance(document);

  /* ---------- Events (/data/events.json) ----------
     Each [data-events] block renders:
       data-mode="all"       every event, past ones dimmed with a "Past" label (/events/)
       data-mode="upcoming"  only today and later (home + campus pages)
       data-campus="slug"    only events for that campus (or for "all" campuses)
     Events dated on a Sunday are grouped into one card per date ("Sunday services");
     everything else is listed under "Gatherings". */
  var today = new Date(); today.setHours(0, 0, 0, 0);
  function parseDate(d) {
    var p = String(d || '').split('-');
    if (p.length !== 3) return null;
    var dt = new Date(+p[0], p[1] - 1, +p[2]);
    return isNaN(dt) ? null : dt;
  }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function campusList(c) {
    var list = Array.isArray(c) ? c : [c];
    list = list.map(function (x) { return String(x || '').trim().toLowerCase(); }).filter(Boolean);
    return list.indexOf('all') > -1 || !list.length ? ['all'] : list;
  }
  function campusName(slug) {
    if (slug === 'all') return 'All campuses';
    for (var i = 0; i < CAMPUSES.length; i++) if (CAMPUSES[i].slug === slug) return CAMPUSES[i].name;
    return slug;
  }
  function campusIndex(slug) {
    if (slug === 'all') return -1;
    for (var i = 0; i < CAMPUSES.length; i++) if (CAMPUSES[i].slug === slug) return i;
    return 99;
  }
  function chip(ev) {
    var d = ev._d;
    return '<time class="date-chip" datetime="' + esc(ev.date) + '"><b>' + ('0' + d.getDate()).slice(-2) +
      '</b><small>' + MONTHS[d.getMonth()].slice(0, 3) + '</small></time>';
  }
  function badge(cls, text) { return ' <span class="badge ' + cls + '">' + text + '</span>'; }
  function timeText(t) {
    t = String(t || '').trim();
    return !t ? '' : (/^\d/.test(t) ? 'at ' + t : t);
  }
  function isWith(s) { return /^with\b/i.test(String(s || '').trim()); }

  function sundayCard(group, opts) {
    var d = group.date;
    var slots = group.slots.slice().sort(function (a, b) { return a.idx - b.idx; });
    var descs = slots.map(function (s) { return s.desc; });
    var shared = slots.length > 1 && descs[0] && descs.every(function (x) { return x === descs[0]; }) &&
      slots.every(function (s) { return !s.label; });
    var cls = 'sunday reveal' + (group.past ? ' is-past' : '') + (group.next ? ' is-next' : '');
    var html = '<article class="' + cls + '" data-date="' + esc(group.iso) + '">' +
      '<div class="sunday__head">' + chip({ _d: d, date: group.iso }) + '<div>' +
      '<p class="sunday__title">Sunday, ' + MONTHS[d.getMonth()] + ' ' + ordinal(d.getDate()) +
      (group.past ? badge('badge--past', 'Past') : '') + (group.next ? badge('badge--next', 'Next') : '') + '</p>' +
      (shared ? '<p class="sunday__note">' + esc(descs[0]) + '</p>' : '') +
      '</div></div><ul class="slots">';
    slots.forEach(function (s) {
      var who = [s.label, shared ? '' : s.desc].filter(Boolean).join(' — ');
      html += '<li' + (s.cancelled ? ' class="is-cancelled"' : '') + '><span class="where">' + esc(s.where) + '</span>' +
        '<span class="when">' + (s.cancelled ? '<s>' + esc(s.time) + '</s>Cancelled' : esc(s.time)) + '</span>' +
        (who ? '<span class="who">' + esc(who) + '</span>' : '') + '</li>';
    });
    return html + '</ul></article>';
  }

  function gatheringCard(ev) {
    var d = ev._d;
    var where = ev._campuses.map(campusName).join(' & ');
    var when = DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + ordinal(d.getDate()) + ', ' + d.getFullYear();
    var t = timeText(ev.time);
    var line = esc(when) + (t ? ', ' + (ev.cancelled ? '<s>' + esc(t) + '</s>' : esc(t)) : '') + ' @ ' + esc(where);
    var cls = 'event reveal' + (ev._past ? ' is-past' : '');
    return '<article class="' + cls + '" data-date="' + esc(ev.date) + '">' + chip(ev) + '<div>' +
      '<h4>' + esc(ev.title) + (ev._past ? badge('badge--past', 'Past') : '') + (ev.cancelled ? badge('badge--cancel', 'Cancelled') : '') + '</h4>' +
      '<p' + (ev.cancelled ? ' class="is-cancelled"' : '') + '>' + line + '</p>' +
      (ev.description ? '<p' + (isWith(ev.description) ? ' class="who"' : '') + '>' + esc(ev.description) + '</p>' : '') +
      '</div></article>';
  }

  function renderEvents(block, all) {
    var mode = block.getAttribute('data-mode') || 'all';
    var campus = block.getAttribute('data-campus');
    var sWrap = block.querySelector('[data-ev-sundays-wrap]');
    var gWrap = block.querySelector('[data-ev-gatherings-wrap]');
    var sList = block.querySelector('[data-ev-sundays]');
    var gList = block.querySelector('[data-ev-gatherings]');
    var sTitle = block.querySelector('[data-ev-sundays-title]');

    var events = all.map(function (e) {
      var d = parseDate(e && e.date);
      if (!d || !e.title) return null;
      return {
        title: String(e.title), date: e.date, time: e.time, description: e.description ? String(e.description) : '',
        cancelled: e.cancelled === true || e.cancelled === 'true',
        _d: d, _past: d < today, _campuses: campusList(e.campuses)
      };
    }).filter(Boolean).filter(function (e) {
      if (mode === 'upcoming' && e._past) return false;
      if (campus && e._campuses.indexOf('all') < 0 && e._campuses.indexOf(campus) < 0) return false;
      return true;
    });

    /* Sundays: one card per date */
    var groups = {}, order = [];
    events.filter(function (e) { return e._d.getDay() === 0; }).forEach(function (e) {
      if (!groups[e.date]) { groups[e.date] = { iso: e.date, date: e._d, past: e._past, slots: [] }; order.push(e.date); }
      var label = /^sunday service$/i.test(e.title.trim()) ? '' : e.title;
      var slugs = e._campuses.indexOf('all') > -1 ? ['all'] : e._campuses.filter(function (c) { return !campus || c === campus; });
      slugs.forEach(function (c) {
        groups[e.date].slots.push({ where: campusName(c), idx: campusIndex(c), time: e.time, desc: e.description, label: label, cancelled: e.cancelled });
      });
    });
    var sundays = order.map(function (k) { return groups[k]; }).sort(function (a, b) { return a.date - b.date; });
    for (var i = 0; i < sundays.length; i++) { if (!sundays[i].past) { sundays[i].next = true; break; } }

    /* Gatherings: upcoming soonest first, then past most recent first */
    var gatherings = events.filter(function (e) { return e._d.getDay() !== 0; }).sort(function (a, b) {
      if (a._past !== b._past) return a._past ? 1 : -1;
      return a._past ? b._d - a._d : a._d - b._d;
    });

    if (sTitle) {
      var months = [];
      sundays.forEach(function (g) { var m = MONTHS[g.date.getMonth()]; if (months.indexOf(m) < 0) months.push(m); });
      sTitle.textContent = 'Sunday services' + (months.length ? ' — ' + months.join(' & ') : '');
    }
    sList.innerHTML = sundays.map(sundayCard).join('');
    gList.innerHTML = gatherings.map(gatheringCard).join('');
    sWrap.hidden = !sundays.length;
    gWrap.hidden = !gatherings.length;
    block.classList.toggle('events-layout--single', !sundays.length || !gatherings.length);

    var empty = block.querySelector('[data-ev-empty]');
    if (empty) empty.hidden = !!(sundays.length || gatherings.length);
    block.removeAttribute('aria-busy');
    enhance(block);
  }

  function eventsFailed(block) {
    block.removeAttribute('aria-busy');
    block.classList.add('events-layout--single');
    block.innerHTML = '<p class="events-msg" role="status">We couldn’t load the latest events just now. ' +
      'Please <a href="/contact/">contact us</a> for service times and updates.</p>';
  }

  var blocks = document.querySelectorAll('[data-events]');
  if (blocks.length) {
    getJSON('/data/events.json').then(function (data) {
      if (!Array.isArray(data)) throw new Error('events.json is not a list');
      blocks.forEach(function (b) {
        try { renderEvents(b, data); } catch (e) { eventsFailed(b); }
      });
    }).catch(function () { blocks.forEach(eventsFailed); });
  }

  /* ---------- Copy bank details ---------- */
  var status = document.getElementById('copy-status');
  function say(t) { if (status) status.textContent = t; }
  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      var done = function () {
        btn.classList.add('is-done');
        btn.innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>';
        say('Copied ' + text);
        setTimeout(function () {
          btn.classList.remove('is-done');
          btn.innerHTML = '<svg aria-hidden="true"><use href="#i-copy"/></svg>';
        }, 1800);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () { say('Copy failed — please copy ' + text + ' manually'); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'absolute'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { say('Please copy ' + text + ' manually'); }
        document.body.removeChild(ta);
      }
    });
  });
})();
