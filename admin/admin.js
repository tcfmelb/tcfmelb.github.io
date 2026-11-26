/* Tamil Christian Fellowship Melbourne — editor admin (/admin/).
   Login with Supabase Auth (email + password). Uses only the PUBLISHABLE key:
   what an editor may change is decided by Row Level Security in supabase/schema.sql.
   Nothing editable is shown, and no editor data is requested, until a login is confirmed. */
(function () {
  'use strict';

  var SB_URL = 'https://ahrwrjxlsaprqbbtjvzk.supabase.co';
  var SB_KEY = 'sb_publishable_CmYHlzu_nPM0MM1SkMOOZA_uIYVYz4o'; // publishable (public) key
  var BUCKET = 'gallery';
  var TYPES = ['Sunday service', 'Prayer', 'Meeting', 'Service change', 'Cancellation', 'Special event'];
  // The website's Title Case rule (main.js, loaded first with data-shared): "prayer meeting" → "Prayer Meeting"
  function tc(s) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); // "Sunday  Service" → "Sunday Service"
    return window.tcfTitleCase ? window.tcfTitleCase(t) : t;
  }
  // Tidy a typed time into the style the website uses: "04:30 pm" → "4:30pm", "10:00 am to 12:30 pm" → "10am to 12:30pm"
  function normTime(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      .replace(/\b0?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b\.?/gi, function (m, h, mi, ap) {
        return +h + (mi && mi !== '00' ? ':' + mi : '') + ap.toLowerCase() + 'm';
      });
  }
  var BADGE = { 'Prayer': ['badge--prayer', 'Prayer'], 'Meeting': ['badge--meeting', 'Meeting'], 'Service change': ['badge--change', 'Service Change'], 'Cancellation': ['badge--cancel', 'Cancelled'], 'Special event': ['badge--special', 'Special Event'], 'Combined service': ['badge--combined', 'Combined Service'] };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MAX_W = 1600, THUMB_W = 600, MAX_BYTES = 500 * 1024;

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- Dates (always Australia/Melbourne) ---------- */
  function melToday() {
    var o = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).forEach(function (p) { o[p.type] = p.value; });
    return o.year + '-' + o.month + '-' + o.day;
  }
  function isoParts(iso) { var p = String(iso).split('-'); return new Date(Date.UTC(+p[0], p[1] - 1, +p[2])); }
  function isSunday(iso) { return !!iso && isoParts(iso).getUTCDay() === 0; }
  function longDate(iso) {
    var d = isoParts(iso);
    return DAYS[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  var stampFmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  function stamp(row) {
    if (!row.updated_at && !row.created_at) return '';
    var when = stampFmt.format(new Date(row.updated_at || row.created_at));
    return 'Last changed by ' + (row.updated_by || 'unknown') + ' on ' + when;
  }

  /* ---------- UI helpers ---------- */
  var toastTimer = 0;
  function toast(msg, undo) {
    var t = $('adm-toast');
    clearTimeout(toastTimer);
    t.innerHTML = '<span>' + esc(msg) + '</span>';
    if (undo) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'adm-link adm-link--light'; b.textContent = 'Undo';
      b.addEventListener('click', function () { t.classList.remove('is-on'); undo(); });
      t.appendChild(b);
    }
    t.classList.add('is-on');
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, undo ? 10000 : 5000);
  }
  function flash(msg) { var f = $('adm-flash'); f.textContent = msg || ''; f.hidden = !msg; }
  function showError(el, msg) { el.setAttribute('role', 'alert'); el.textContent = msg || ''; el.hidden = !msg; }
  function busy(btn, on, label) {
    if (on) { btn._label = btn.textContent; btn.textContent = label || 'Saving…'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    else { btn.textContent = btn._label || btn.textContent; btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
  function friendly(err) {
    var m = (err && (err.message || err.error_description)) || String(err || '');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Couldn’t reach the server. Check your internet connection and try again.';
    if (/Invalid login credentials/i.test(m)) return 'That email and password don’t match. Please try again.';
    if (/Email not confirmed/i.test(m)) return 'This account hasn’t been confirmed yet. Please use the invite email first.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a few minutes and try again.';
    if (/should be different/i.test(m)) return 'Please choose a password you haven’t used before.';
    if (/Password should be at least/i.test(m)) return m;
    if (/combined_with/i.test(m) && /column|schema cache/i.test(m)) return 'A cancellation combined with another campus can’t be saved until the database has been updated. Ask the administrator to run supabase/add-combined-with.sql in Supabase.';
    if (/location/i.test(m) && /column|schema cache/i.test(m)) return 'Events with a location can’t be saved until the database has been updated. Ask the administrator to run supabase/special-events.sql in Supabase.';
    if (/events_campuses_check/i.test(m)) return 'Please tick a campus, or tick “Not at a campus” and fill in the venue name.';
    if (/events_location_url_check/i.test(m)) return 'The map or info link must start with https://';
    if (/events_type_check/i.test(m)) return 'This type can’t be saved until the database has been updated. Ask the administrator to run supabase/special-events.sql in Supabase.';
    if (/events_combined_with/i.test(m)) return 'This cancellation can’t be combined with another campus yet. Leave “Combined with another campus” empty, or ask the administrator to run supabase/status-cleanup.sql in Supabase.';
    if (/violates check constraint/i.test(m)) return 'Something in the form isn’t allowed (it may be too long). Please check and try again.';
    if (/payload too large|exceeded the maximum allowed size/i.test(m)) return 'That photo is too large to upload.';
    return 'Something went wrong: ' + m;
  }

  /* Confirmation dialog. Resolves true when the editor confirms. */
  function confirmBox(opts) {
    var dlg = $('adm-confirm'), ok = $('confirm-ok'), cancel = $('confirm-cancel');
    $('confirm-title').textContent = opts.title;
    $('confirm-body').innerHTML = opts.html;
    ok.textContent = opts.ok || 'Confirm';
    ok.className = 'btn ' + (opts.danger ? 'adm-danger' : 'btn--navy');
    var opener = document.activeElement;
    return new Promise(function (resolve) {
      function done(v) {
        ok.removeEventListener('click', yes); cancel.removeEventListener('click', no); dlg.removeEventListener('cancel', no);
        if (dlg.open) dlg.close();
        if (opener && opener.focus && document.contains(opener)) opener.focus();
        resolve(v);
      }
      function yes() { done(true); }
      function no(e) { if (e) e.preventDefault(); done(false); }
      ok.addEventListener('click', yes); cancel.addEventListener('click', no); dlg.addEventListener('cancel', no);
      dlg.showModal();
      cancel.focus();
    });
  }

  /* ---------- Supabase client ---------- */
  if (!window.supabase || !window.supabase.createClient) {
    $('adm-loading').hidden = true;
    flash('The login system couldn’t load. Check your internet connection, then refresh this page.');
    return;
  }
  // Read the reset-link details from the address before the client tidies it up.
  var hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  var recovering = hash.get('type') === 'recovery';
  var linkError = hash.get('error_description');

  var sb = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'tcf-admin-auth' }
  });

  var state = { user: null, campuses: [], events: [], gallery: [], appOn: false, signingOut: false };

  function view(name) {
    $('adm-loading').hidden = true;
    ['login', 'forgot', 'newpass'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    var first = name && $('view-' + name).querySelector('input');
    if (first) first.focus();
  }

  function stopApp() {
    state.appOn = false; state.user = null; state.events = []; state.gallery = []; state.campuses = [];
    $('app-root').innerHTML = '';
    $('adm-user').hidden = true;
    $('adm-user-email').textContent = '';
  }

  /* Any request refused because the login expired lands here. */
  function sessionEnded(msg) {
    stopApp();
    sb.auth.signOut({ scope: 'local' }).catch(function () {});
    view('login');
    flash(msg || 'Your login has expired. Please log in again — nothing you saved before this was lost.');
  }
  function isAuthError(e) {
    if (!e) return false;
    return e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT|jwt expired|not authenticated|session/i.test(e.message || '');
  }
  function SessionGone() { this.message = 'session'; }
  function must(res) {
    if (res.error) {
      if (isAuthError(res.error)) { sessionEnded(); throw new SessionGone(); }
      throw res.error;
    }
    return res.data;
  }
  /* Writes must change exactly the rows we expect; zero rows means the login is no longer valid. */
  function mustChange(res) {
    var data = must(res);
    if (Array.isArray(data) && !data.length) { sessionEnded(); throw new SessionGone(); }
    return data;
  }
  function report(errEl, e) {
    if (e instanceof SessionGone) return;
    if (errEl) showError(errEl, friendly(e)); else toast(friendly(e));
  }

  sb.auth.onAuthStateChange(function (event, session) {
    // Supabase advises not to await other Supabase calls inside this callback.
    setTimeout(function () {
      if (event === 'PASSWORD_RECOVERY' || (recovering && session)) { stopApp(); view('newpass'); return; }
      if (event === 'SIGNED_OUT') {
        var mine = state.signingOut; state.signingOut = false;
        if (state.appOn || mine) {
          stopApp(); view('login');
          flash(mine ? '' : 'Your login has expired. Please log in again.');
          if (mine) toast('You have signed out.');
        } else if ($('adm-loading').hidden === false) view('login');
        return;
      }
      if (session && session.user) { startApp(session.user); return; }
      if (event === 'INITIAL_SESSION') {
        view('login');
        if (linkError) flash(/expired|invalid/i.test(linkError) ? 'That email link has expired or was already used. Please request a new one.' : linkError);
      }
    }, 0);
  });
  // Coming back to the tab after a long time: make sure the login is still valid.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !state.appOn) return;
    sb.auth.getUser().then(function (r) { if ((r.error && isAuthError(r.error)) || (!r.error && !r.data.user)) sessionEnded(); });
  });

  /* ---------- Login, forgot password, new password ---------- */
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('login-email'), pass = $('login-password'), err = $('login-error'), btn = e.target.querySelector('[type=submit]');
    showError(err, ''); flash('');
    [email, pass].forEach(function (i) { i.removeAttribute('aria-invalid'); });
    if (!email.value.trim() || !pass.value) {
      if (!email.value.trim()) email.setAttribute('aria-invalid', 'true');
      if (!pass.value) pass.setAttribute('aria-invalid', 'true');
      showError(err, 'Please enter your email and password.');
      return;
    }
    busy(btn, true, 'Logging in…');
    sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value }).then(function (r) {
      busy(btn, false);
      if (r.error) { showError(err, friendly(r.error)); pass.select(); return; }
      pass.value = '';
    }, function (x) { busy(btn, false); showError(err, friendly(x)); });
  });
  $('show-forgot').addEventListener('click', function () {
    $('forgot-email').value = $('login-email').value;
    showError($('forgot-error'), ''); showError($('forgot-ok'), ''); flash('');
    view('forgot');
  });
  $('show-login').addEventListener('click', function () { flash(''); view('login'); });
  $('forgot-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('forgot-email').value.trim(), btn = e.target.querySelector('[type=submit]');
    showError($('forgot-error'), ''); showError($('forgot-ok'), '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError($('forgot-error'), 'Please enter a valid email address.'); return; }
    busy(btn, true, 'Sending…');
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/admin/' }).then(function (r) {
      busy(btn, false);
      if (r.error && !/not found/i.test(r.error.message)) { showError($('forgot-error'), friendly(r.error)); return; }
      // Same message whether or not the address is an editor, so it can't be used to find editors' emails.
      showError($('forgot-ok'), 'If that address belongs to an editor, a reset link is on its way. Check your inbox (and junk folder). The link works once and expires after an hour.');
    }, function (x) { busy(btn, false); showError($('forgot-error'), friendly(x)); });
  });
  $('newpass-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var a = $('newpass-1').value, b = $('newpass-2').value, err = $('newpass-error'), btn = e.target.querySelector('[type=submit]');
    showError(err, '');
    if (a.length < 10) { showError(err, 'Please use at least 10 characters.'); return; }
    if (a !== b) { showError(err, 'The two passwords don’t match.'); return; }
    busy(btn, true);
    sb.auth.updateUser({ password: a }).then(function (r) {
      busy(btn, false);
      if (r.error) { showError(err, friendly(r.error)); return; }
      recovering = false;
      history.replaceState(null, '', location.pathname);
      $('newpass-1').value = $('newpass-2').value = '';
      toast('Your new password is saved.');
      sb.auth.getSession().then(function (s) { if (s.data.session) startApp(s.data.session.user); else view('login'); });
    }, function (x) { busy(btn, false); showError(err, friendly(x)); });
  });
  $('adm-signout').addEventListener('click', function () {
    state.signingOut = true;
    sb.auth.signOut().then(function (r) { if (r.error) { stopApp(); view('login'); } });
  });

  /* ---------- App ---------- */
  function startApp(user) {
    if (state.appOn && state.user && state.user.id === user.id) return;
    stopApp();
    state.user = user; state.appOn = true;
    ['login', 'forgot', 'newpass'].forEach(function (v) { $('view-' + v).hidden = true; });
    $('adm-loading').hidden = true;
    flash('');
    $('adm-user-email').textContent = user.email || '';
    $('adm-user').hidden = false;
    $('app-root').appendChild($('app-tpl').content.cloneNode(true));
    initTabs();
    initEvents();
    initTimes();
    initGallery();
    loadAll();
  }

  function loadAll() {
    return Promise.all([
      sb.from('campuses').select('*').order('sort'),
      sb.from('events').select('*').order('date', { ascending: true }),
      sb.from('gallery').select('*').order('sort').order('created_at', { ascending: false })
    ]).then(function (r) {
      if (!state.appOn) return;
      state.campuses = must(r[0]) || [];
      state.events = must(r[1]) || [];
      // Has supabase/add-combined-with.sql been run? (select * returns the column if it exists)
      state.hasCombined = state.events.some(function (e) { return 'combined_with' in e; });
      // Has supabase/special-events.sql been run? (the location columns exist)
      state.hasLocation = state.events.some(function (e) { return 'location' in e; });
      state.gallery = must(r[2]) || [];
      renderCampusChecks();
      renderEvents();
      renderCampuses();
      renderGallery();
    }).catch(function (e) { report(null, e); if (!(e instanceof SessionGone)) flash(friendly(e)); });
  }

  function campusName(slug) {
    if (slug === 'all') return 'All campuses';
    for (var i = 0; i < state.campuses.length; i++) if (state.campuses[i].slug === slug) return state.campuses[i].name;
    return slug;
  }
  function campusNames(list) { return (list && list.length ? list : ['all']).map(campusName).join(' & '); }
  // Where an event is, for the list: its campuses, or its location when it isn't at a campus
  function whereText(e) { return e.campuses && !e.campuses.length && e.location ? e.location : campusNames(e.campuses); }

  /* Tabs (WAI-ARIA pattern: arrow keys move between tabs) */
  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[role=tab]'));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        $(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        var n = null;
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === 'Home') n = tabs[0];
        if (e.key === 'End') n = tabs[tabs.length - 1];
        if (n) { e.preventDefault(); select(n, true); }
      });
    });
  }

  /* =====================================================================
     EVENTS
     ===================================================================== */
  var editing = null; // id of the event being edited, or null for a new one

  function renderCampusChecks() {
    var box = $('ev-campuses');
    var opts = [{ slug: 'all', name: 'All campuses' }].concat(state.campuses, [{ slug: 'none', name: 'Not at a campus' }]);
    box.innerHTML = opts.map(function (c) {
      return '<label class="check"><input type="checkbox" name="ev-campus" value="' + esc(c.slug) + '"> ' + esc(c.name) + '</label>';
    }).join('');
    // The same campuses, for the “Add a month of Sundays” form (all ticked the first time) and the list filter
    var keep = bulk.campuses || state.campuses.map(function (c) { return c.slug; });
    $('bs-campuses').innerHTML = state.campuses.map(function (c) {
      return '<label class="check"><input type="checkbox" name="bs-campus" value="' + esc(c.slug) + '"' + (keep.indexOf(c.slug) > -1 ? ' checked' : '') + '> ' + esc(c.name) + '</label>';
    }).join('');
    var f = $('ev-filter');
    f.innerHTML = '<option value="">All campuses</option>' + state.campuses.map(function (c) {
      return '<option value="' + esc(c.slug) + '"' + (c.slug === evFilter ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
  }
  function checkedCampuses() {
    return Array.prototype.slice.call(document.querySelectorAll('input[name=ev-campus]:checked')).map(function (i) { return i.value; });
  }
  function setCampuses(list) {
    document.querySelectorAll('input[name=ev-campus]').forEach(function (i) { i.checked = list.indexOf(i.value) > -1; });
  }

  /* Status is stored with the existing fields:
       Normal     type Sunday service / Prayer / Meeting / Service change, combined_with empty
       Cancelled  type Cancellation; combined_with (optional) = the campus everyone joins instead
     (Before supabase/status-cleanup.sql, a combined service was a Service change + combined_with.) */
  function statusOf(e) {
    return e.type === 'Cancellation' || (e.type === 'Service change' && e.combined_with) ? 'cancelled' : 'normal';
  }
  function isCombined(e) { return statusOf(e) === 'cancelled' && !!e.combined_with; }
  function badgeKey(e) { return statusOf(e) === 'cancelled' ? 'Cancellation' : e.type; }

  function formValues() {
    var campuses = checkedCampuses();
    if (campuses.indexOf('all') > -1) campuses = ['all'];
    if (campuses.indexOf('none') > -1) campuses = []; // "Not at a campus": the location says where
    var status = $('ev-status').value;
    var end = normTime($('ev-time-end').value), start = normTime($('ev-time').value);
    var v = {
      title: tc($('ev-title').value),       // stored in Title Case
      type: status === 'cancelled' ? 'Cancellation' : $('ev-type').value,
      date: $('ev-date').value,
      // A cancellation has no time of its own (so nobody types the other campus's time)
      time: status === 'normal' ? [start, end].filter(Boolean).join(' to ') || null : null,
      campuses: campuses,
      note: $('ev-note').value.trim() || null
    };
    // Only send combined_with when it is needed or the column exists, so ordinary saves keep
    // working before supabase/add-combined-with.sql has been run.
    var combined = status === 'cancelled' ? $('ev-combined').value || null : null;
    if (combined || state.hasCombined) v.combined_with = combined;
    // Location: only sent when filled in or the columns exist (before supabase/special-events.sql)
    var loc = { location: $('ev-loc-name').value.trim() || null, location_address: $('ev-loc-address').value.trim() || null, location_url: $('ev-loc-url').value.trim() || null };
    if (loc.location || loc.location_address || loc.location_url || state.hasLocation) Object.assign(v, loc);
    return v;
  }

  /* "Combined with another campus": every campus except the ones being cancelled; empty = not combined */
  function renderCombinedOptions(selected) {
    var sel = $('ev-combined');
    var current = selected !== undefined ? selected : sel.value;
    var mine = checkedCampuses();
    var opts = state.campuses.filter(function (c) { return mine.indexOf(c.slug) < 0; });
    sel.innerHTML = '<option value="">Not combined</option>' + opts.map(function (c) {
      return '<option value="' + esc(c.slug) + '"' + (c.slug === current ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
  }
  function syncStatus() {
    var st = $('ev-status').value;
    $('ev-type-wrap').hidden = st !== 'normal';      // the status decides the stored type
    $('ev-combined-wrap').hidden = st !== 'cancelled';
    $('ev-time-wrap').hidden = st !== 'normal';      // no time to type, so nobody enters the other campus's time
    $('ev-end-wrap').hidden = st !== 'normal';
  }
  /* ---------- Cancelled Sunday services, optionally combined (same rule as main.js) ----------
     On a Sunday they REPLACE the service of each campus they list: that campus's own "Sunday service"
     rows are hidden on the website, and it shows "Cancelled" (+ "Combined with Tarneit, 4:30pm"). */
  function isService(e) { return /^sunday service$/i.test(String(e.title || '').trim()); }
  function replaces(e) { return isSunday(e.date) && (isCombined(e) || (statusOf(e) === 'cancelled' && isService(e))); }
  function campusesOf(e) { return e.campuses && e.campuses.length ? e.campuses : ['all']; }
  function covers(e, slug) { var c = campusesOf(e); return c.indexOf('all') > -1 || c.indexOf(slug) > -1; }
  function andList(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function others(v) { return state.events.filter(function (e) { return !e.deleted_at && e.id !== editing && e.date === v.date; }); }
  // The replacement that hides this campus's service that day, if any
  function replacedBy(e, slug, list) {
    if (!isSunday(e.date) || !isService(e) || replaces(e) || statusOf(e) === 'cancelled') return null;
    return (list || others(e)).filter(function (o) { return o !== e && o.id !== e.id && replaces(o) && covers(o, slug); })[0] || null;
  }
  // The joined campus's time that day: its own Sunday service row, else its regular Sunday time
  function joinTime(v, list) {
    var row = (list || others(v)).filter(function (o) { return isService(o) && !replaces(o) && statusOf(o) !== 'cancelled' && covers(o, v.combined_with); })[0];
    return (row && row.time) || campusTime(v.combined_with) || '';
  }
  // After the "Cancelled" badge: "Combined with Tarneit, 4:30pm", or nothing
  function noServiceText(v) {
    if (!isCombined(v)) return '';
    var time = joinTime(v);
    return 'Combined with ' + campusName(v.combined_with) + (time ? ', ' + time : '');
  }
  function joiningText(names) { return 'Includes the ' + andList(names) + ' service' + (names.length > 1 ? 's' : ''); }
  function extraNote(v) {
    var n = String(v.note || '').trim();
    if (!n || !isCombined(v)) return n;
    var at = campusName(v.combined_with).toLowerCase(), low = n.toLowerCase().replace(/[.!]+$/, '');
    return low.indexOf('combined service at ' + at) === 0 || low.indexOf('join us at ' + at) === 0 ? '' : n;
  }

  /* Same markup and classes as the public site (main.js), so the preview matches */
  function badge(type) { if (type === 'Sunday service') return ''; var b = BADGE[type] || BADGE.Meeting; return '<span class="badge ' + b[0] + '">' + b[1] + '</span>'; }
  function previewHTML(v) {
    if (!v.date || !v.title) return '<p class="adm-hint">Fill in the title and date to see a preview.</p>';
    var d = isoParts(v.date);
    var chip = '<time class="date-chip" datetime="' + esc(v.date) + '"><b>' + ('0' + d.getUTCDate()).slice(-2) + '</b><small>' + MONTHS[d.getUTCMonth()].slice(0, 3) + '</small></time>';
    var cancelled = v.type === 'Cancellation';
    var bk = badgeKey(v);
    var camps = v.campuses.length ? v.campuses : ['all'];
    var special = v.type === 'Special event';
    if (isSunday(v.date) && !special && replaces(v)) {
      // Each campus: no time, "Cancelled" (+ "Combined with …") and the note; the joined campus keeps its row
      var extra = extraNote(v), text = noServiceText(v);
      var rows = camps.map(function (c) {
        return '<li class="is-cancelled"><span class="where">' + esc(campusName(c)) + '</span><span class="when"></span>' +
          '<span class="who">' + badge(bk) + (text ? ' ' + esc(text) : '') + '</span>' +
          (extra ? '<span class="who who--plain">' + esc(extra) + '</span>' : '') + '</li>';
      });
      if (isCombined(v)) {
        rows.push('<li><span class="where">' + esc(campusName(v.combined_with)) + '</span><span class="when">' + esc(joinTime(v)) + '</span>' +
          '<span class="who who--plain">' + esc(joiningText(camps.map(campusName))) + '</span></li>');
      }
      return '<article class="sunday"><div class="sunday__head">' + chip + '<div><p class="sunday__title">Sunday, ' + MONTHS[d.getUTCMonth()] + ' ' + ordinal(d.getUTCDate()) + '</p></div></div><ul class="slots">' + rows.join('') + '</ul></article>';
    }
    if (isSunday(v.date) && !special) {
      var hiddenAt = camps.filter(function (c) { return replacedBy(v, c); });
      if (hiddenAt.length && hiddenAt.length === camps.length) {
        var by = replacedBy(v, hiddenAt[0]);
        return '<p class="adm-hint">Not shown on the website: ' + esc(andList(hiddenAt.map(campusName))) + (hiddenAt.length > 1 ? ' have ' : ' has ') +
          'a cancellation' + (isCombined(by) ? ' (combined with ' + esc(campusName(by.combined_with)) + ')' : '') + ' that day.</p>';
      }
      camps = camps.filter(function (c) { return hiddenAt.indexOf(c) < 0; });
      var label = /^sunday service$/i.test(v.title) ? '' : v.title;
      var who = [label, v.note].filter(Boolean).map(esc).join(' — ');
      var slots = camps.map(function (c) {
        return '<li' + (cancelled ? ' class="is-cancelled"' : '') + '><span class="where">' + esc(campusName(c)) + '</span>' +
          '<span class="when">' + esc(v.time || '') + (cancelled ? ' ' + badge(bk) : '') + '</span>' +
          (cancelled ? (who ? '<span class="who">' + who + '</span>' : '')
            : bk === 'Sunday service' ? (who ? '<span class="who' + (!label && /^with\b/i.test(v.note || '') ? '' : ' who--plain') + '">' + who + '</span>' : '')
            : '<span class="who">' + badge(bk) + (who ? ' ' + who : '') + '</span>') + '</li>';
      }).join('');
      return '<article class="sunday"><div class="sunday__head">' + chip + '<div><p class="sunday__title">Sunday, ' + MONTHS[d.getUTCMonth()] + ' ' + ordinal(d.getUTCDate()) + '</p></div></div><ul class="slots">' + slots + '</ul></article>';
    }
    var t = v.time ? (/^\d/.test(v.time) ? 'at ' + v.time : v.time) : '';
    var where = v.location && (special || !v.campuses.length) ? '' : campusNames(camps);
    var line = esc(longDate(v.date)) + (t ? ', ' + esc(t) : '') + (where ? ' @ ' + esc(where) : '');
    var place = '';
    if (v.location) {
      // Same as the public site: venue, address, and "Get directions" (the editor's link, else Google Maps)
      var url = /^https:\/\/\S+$/i.test(v.location_url || '') ? v.location_url
        : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([v.location, v.location_address].filter(Boolean).join(', '));
      place = '<p class="event__place"><strong>' + esc(v.location) + '</strong>' + (v.location_address ? ', ' + esc(v.location_address) : '') + '</p>' +
        '<p class="event__map"><a href="' + esc(url) + '" target="_blank" rel="noopener">Get Directions<span class="visually-hidden"> to ' + esc(v.location) + ' (opens in a new tab)</span></a></p>';
    }
    return '<article class="event">' + chip + '<div><h4>' + esc(v.title) + ' ' + badge(bk) + '</h4>' +
      '<p>' + line + '</p>' + place +
      (v.note ? '<p' + (/^with\b/i.test(v.note) ? ' class="who"' : '') + '>' + esc(v.note) + '</p>' : '') + '</div></article>';
  }
  function updatePreview() { $('ev-preview').innerHTML = previewHTML(formValues()); }

  function campusTime(slug) {
    for (var i = 0; i < state.campuses.length; i++) if (state.campuses[i].slug === slug) return state.campuses[i].sunday_time;
    return '';
  }
  /* Helpful defaults: a Sunday + one campus fills in that campus's regular time */
  var typeTouched = false; // the editor chose a type themselves
  function autoFill() {
    var type = $('ev-type');
    if (!typeTouched && !editing) {
      var sunday = isSunday($('ev-date').value);
      if (sunday && type.value === 'Meeting') type.value = 'Sunday service';
      if (!sunday && type.value === 'Sunday service') type.value = 'Meeting';
    }
    var v = formValues();
    var time = $('ev-time');
    if ($('ev-status').value === 'normal' && !time.value.trim() && isSunday(v.date) && v.campuses.length === 1 && v.campuses[0] !== 'all') time.value = campusTime(v.campuses[0]) || '';
    var title = $('ev-title');
    if (!title.value.trim() && isSunday(v.date) && (v.type === 'Cancellation' || v.type === 'Service change' || v.type === 'Sunday service')) title.value = 'Sunday Service';
  }

  // copy: start a NEW event from a past one (same details, no date), leaving the past event as it was
  function openForm(ev, copy) {
    editing = ev && !copy ? ev.id : null;
    var f = $('ev-form');
    $('ev-form-title').textContent = copy ? 'Add an event (copied from ' + tc(ev.title) + ', ' + longDate(ev.date) + ')' : ev ? 'Edit event' : 'Add an event';
    $('ev-title').value = ev ? ev.title : '';
    $('ev-status').value = ev ? statusOf(ev) : 'normal';
    typeTouched = false;
    $('ev-type').value = ev && ['Sunday service', 'Prayer', 'Meeting', 'Service change', 'Special event'].indexOf(ev.type) > -1 ? ev.type
      : ev && isSunday(ev.date) && /^sunday service$/i.test(ev.title.trim()) ? 'Sunday service' : 'Meeting';
    $('ev-date').value = ev && !copy ? ev.date : '';
    // "4pm to 6pm" opens as Time "4pm" and End time "6pm"
    var range = ev && /^(.*?\S)\s+to\s+(\S.*)$/i.exec(ev.time || '');
    $('ev-time').value = range ? range[1] : ev ? (ev.time || '') : '';
    $('ev-time-end').value = range ? range[2] : '';
    $('ev-loc-name').value = ev ? (ev.location || '') : '';
    $('ev-loc-address').value = ev ? (ev.location_address || '') : '';
    $('ev-loc-url').value = ev ? (ev.location_url || '') : '';
    $('ev-note').value = ev ? (ev.note || '') : '';
    setCampuses(ev ? (ev.campuses && !ev.campuses.length ? ['none'] : ev.campuses) : []);
    renderCombinedOptions(ev && ev.combined_with ? ev.combined_with : '');
    syncStatus();
    $('bs-form').hidden = true;
    $('ev-repeat').value = 'none'; $('ev-repeat-until').value = ''; $('ev-repeat-until').removeAttribute('aria-invalid');
    syncRepeat();
    showError($('ev-error'), '');
    f.querySelectorAll('[aria-invalid]').forEach(function (x) { x.removeAttribute('aria-invalid'); });
    f.hidden = false;
    updatePreview();
    f.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $(copy ? 'ev-date' : 'ev-title').focus({ preventScroll: true });
  }
  function closeForm() { $('ev-form').hidden = true; editing = null; $('ev-add').focus(); }

  function validate(v) {
    var problems = [];
    var f = $('ev-form');
    f.querySelectorAll('[aria-invalid]').forEach(function (x) { x.removeAttribute('aria-invalid'); });
    if (!v.title) { problems.push('a title'); $('ev-title').setAttribute('aria-invalid', 'true'); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) { problems.push('a date'); $('ev-date').setAttribute('aria-invalid', 'true'); }
    var notAtCampus = checkedCampuses().indexOf('none') > -1;
    if (!v.campuses.length && !notAtCampus) problems.push('at least one campus (or “Not at a campus”)');
    if (notAtCampus && !v.location) { problems.push('the venue name'); $('ev-loc-name').setAttribute('aria-invalid', 'true'); }
    if (v.location_url && !/^https:\/\/\S+$/i.test(v.location_url)) {
      $('ev-loc-url').setAttribute('aria-invalid', 'true');
      return 'The map or info link must start with https://';
    }
    if (TYPES.indexOf(v.type) < 0) problems.push('a type');
    if (v.combined_with && v.campuses.indexOf('all') > -1) {
      $('ev-combined').setAttribute('aria-invalid', 'true');
      return 'To combine with another campus, tick the campuses that are cancelled instead of “All campuses”.';
    }
    return problems.length ? 'Please add ' + problems.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' : '';
  }

  /* =====================================================================
     BULK TOOLS: a month of Sundays, repeating events, changing several at once
     ===================================================================== */
  var selected = {};   // event id → true: the events ticked in the Upcoming list
  var evFilter = '';   // campus slug shown in the Upcoming list ('' = all campuses)
  var bulk = { month: '', picks: {}, edits: {}, campuses: null }; // the “Add a month of Sundays” form

  function addDays(iso, n) { var d = isoParts(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function shortDate(iso) { var d = isoParts(iso); return DAYS[d.getUTCDay()].slice(0, 3) + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3); }
  function monthLabel(ym) { var p = ym.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function nextSunday(iso) { while (!isSunday(iso)) iso = addDays(iso, 1); return iso; }
  function sundaysIn(ym) {
    var p = ym.split('-'), out = [], d = new Date(Date.UTC(+p[0], +p[1] - 1, 1));
    while (d.getUTCMonth() === +p[1] - 1) { if (d.getUTCDay() === 0) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); }
  function liveEvents() { return state.events.filter(function (e) { return !e.deleted_at; }); }

  /* Is a campus's Sunday already dealt with? 'has' = a regular service row is there,
     'cancelled' = a cancellation replaces it that day, '' = nothing yet. */
  function sundayStatus(date, slug) {
    var rows = liveEvents().filter(function (e) { return e.date === date && e.type !== 'Special event' && covers(e, slug); });
    if (rows.some(function (e) { return replaces(e); })) return 'cancelled';
    // Tolerates stray spaces (“Sunday  Service”) so an existing row is never offered for adding twice
    if (rows.some(function (e) { return /^sunday\s+service$/i.test(String(e.title || '').trim()) && statusOf(e) !== 'cancelled'; })) return 'has';
    return '';
  }
  /* Looks 40 Sundays ahead for the first one where some campus has nothing yet. */
  function coverage() {
    var d = nextSunday(melToday()), prev = null;
    for (var i = 0; i < 40; i++, d = addDays(d, 7)) {
      if (state.campuses.some(function (c) { return sundayStatus(d, c.slug) === ''; })) return { gap: d, prev: prev };
      prev = d;
    }
    return { gap: null, prev: prev };
  }
  function renderCoverage() {
    var box = $('ev-coverage'), txt = $('ev-coverage-text'), btn = $('ev-coverage-btn');
    if (!state.campuses.length) { box.hidden = true; return; }
    var c = coverage(), soon = !c.gap ? false : (isoParts(c.gap) - isoParts(melToday())) / 864e5 < 35;
    box.hidden = false;
    box.className = soon ? 'adm-note' : 'adm-hint';
    if (!c.gap) { txt.textContent = 'Sunday services are set up for the next 40 weeks.'; btn.hidden = true; return; }
    var ym = c.gap.slice(0, 7);
    txt.textContent = (c.prev ? 'Sunday services are set up to ' + shortDate(c.prev) + '. ' : 'No upcoming Sunday services have been added yet. ') +
      (soon ? monthLabel(ym) + ' still needs adding.' : '');
    btn.hidden = false; btn.textContent = 'Add ' + monthLabel(ym); btn.setAttribute('data-ym', ym);
  }

  /* ---------- Add a month of Sundays ---------- */
  function bulkCampuses() {
    return Array.prototype.slice.call(document.querySelectorAll('input[name=bs-campus]:checked')).map(function (i) { return i.value; });
  }
  function bulkKey(date, slug) { return date + '|' + slug; }
  function bulkRows() {
    var rows = [], missing = [];
    sundaysIn(bulk.month).forEach(function (date) {
      bulk.campuses.forEach(function (slug) {
        var key = bulkKey(date, slug);
        if (sundayStatus(date, slug) !== '' || bulk.picks[key] === false) return;
        var ed = bulk.edits[key] || {};
        var time = normTime(ed.time != null ? ed.time : campusTime(slug));
        if (!time) { missing.push(campusName(slug) + ' on ' + shortDate(date)); return; }
        var r = { title: 'Sunday Service', type: 'Sunday service', date: date, time: time, campuses: [slug], note: String(ed.note || '').trim() || null };
        if (state.hasCombined) r.combined_with = null;
        if (state.hasLocation) { r.location = null; r.location_address = null; r.location_url = null; }
        rows.push(r);
      });
    });
    return { rows: rows, missing: missing };
  }
  function renderBulk() {
    var dates = sundaysIn(bulk.month), html = '', skipped = 0;
    if (!bulk.campuses.length) html = '<li class="adm-empty">Tick at least one campus.</li>';
    (bulk.campuses.length ? dates : []).forEach(function (date) {
      var rows = '', open = 0;
      bulk.campuses.forEach(function (slug) {
        var key = bulkKey(date, slug), st = sundayStatus(date, slug), name = campusName(slug), id = 'bs-' + date + '-' + slug;
        var label = name + ' on ' + shortDate(date);
        if (st) {
          skipped++;
          rows += '<li class="bs-row is-done"><span class="bs-who">' + esc(name) + '</span><span class="bs-status">' +
            (st === 'cancelled' ? 'Cancelled that day, nothing to add' : 'Already added') + '</span></li>';
          return;
        }
        open++;
        var ed = bulk.edits[key] || {}, on = bulk.picks[key] !== false;
        rows += '<li class="bs-row"><label class="check bs-who"><input type="checkbox" data-bs-pick="' + esc(key) + '"' + (on ? ' checked' : '') + '> ' + esc(name) +
          '<span class="visually-hidden"> on ' + esc(shortDate(date)) + ': include</span></label>' +
          '<input class="bs-time" id="' + id + '-t" data-bs-time="' + esc(key) + '" maxlength="40" value="' + esc(ed.time != null ? ed.time : campusTime(slug)) + '" aria-label="Time for ' + esc(label) + '" autocomplete="off">' +
          '<input class="bs-note" id="' + id + '-n" data-bs-note="' + esc(key) + '" maxlength="500" value="' + esc(ed.note || '') + '" placeholder="Note (optional), e.g. with Ps Name (Guest Speaker, Country)" aria-label="Note for ' + esc(label) + '" autocomplete="off"></li>';
      });
      html += '<li class="bs-day"><div class="bs-day__head"><h4>' + esc(longDate(date)) + '</h4>' +
        (open ? '<span><button type="button" class="adm-link" data-bs-all="' + date + '" data-on="1">Tick all<span class="visually-hidden"> on ' + esc(shortDate(date)) + '</span></button>' +
          '<button type="button" class="adm-link" data-bs-all="' + date + '" data-on="0">Untick all<span class="visually-hidden"> on ' + esc(shortDate(date)) + '</span></button></span>' : '') +
        '</div><ul class="bs-rows">' + rows + '</ul></li>';
    });
    $('bs-list').innerHTML = html;
    updateBulkSummary(skipped);
  }
  function updateBulkSummary(skipped) {
    var n = bulkRows().rows.length, btn = $('bs-save');
    btn.textContent = n ? 'Add ' + plural(n, 'service') : 'Nothing to add';
    btn.disabled = !n;
    var skip = skipped != null ? skipped : $('bs-list').querySelectorAll('.is-done').length;
    $('bs-summary').textContent = n ? plural(n, 'service') + ' will be added for ' + monthLabel(bulk.month) + (skip ? ' (' + skip + ' already there or cancelled, skipped)' : '') + '.' : 'Every Sunday here is already added, cancelled or unticked.';
  }
  function openBulk(ym) {
    var c = coverage(), months = [], d = melToday().slice(0, 7);
    for (var i = 0; i < 8; i++) {
      months.push(d);
      var p = d.split('-'), y = +p[0], m = +p[1];
      d = m === 12 ? (y + 1) + '-01' : y + '-' + ('0' + (m + 1)).slice(-2);
    }
    bulk.month = months.indexOf(ym) > -1 ? ym : months.indexOf((c.gap || '').slice(0, 7)) > -1 ? c.gap.slice(0, 7) : months[1];
    bulk.picks = {}; bulk.edits = {};
    $('bs-month').innerHTML = months.map(function (m) { return '<option value="' + m + '"' + (m === bulk.month ? ' selected' : '') + '>' + esc(monthLabel(m)) + '</option>'; }).join('');
    bulk.campuses = bulkCampuses().length ? bulkCampuses() : state.campuses.map(function (x) { return x.slug; });
    $('ev-form').hidden = true; editing = null;
    showError($('bs-error'), '');
    $('bs-form').hidden = false;
    renderCampusChecks();
    renderBulk();
    $('bs-form').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('bs-month').focus({ preventScroll: true });
  }
  function closeBulk() { $('bs-form').hidden = true; $('bs-open').focus(); }
  function saveBulk() {
    var r = bulkRows(), err = $('bs-error'), btn = $('bs-save');
    showError(err, '');
    if (r.missing.length) { showError(err, 'Please add a time for ' + andList(r.missing.slice(0, 3)) + (r.missing.length > 3 ? ' and ' + (r.missing.length - 3) + ' more' : '') + ', or untick it.'); return; }
    if (!r.rows.length) return;
    var byDate = {};
    r.rows.forEach(function (x) { (byDate[x.date] = byDate[x.date] || []).push(campusName(x.campuses[0]) + ' ' + x.time + (x.note ? ' (' + x.note + ')' : '')); });
    confirmBox({
      title: 'Add ' + plural(r.rows.length, 'Sunday service') + '?',
      html: '<p>These go on the website straight away:</p><ul class="adm-changes">' + Object.keys(byDate).sort().map(function (d) {
        return '<li><strong>' + esc(shortDate(d)) + ':</strong> ' + esc(byDate[d].join(', ')) + '</li>';
      }).join('') + '</ul><p class="adm-hint">You can delete any of them afterwards, and “Undo” appears after saving.</p>',
      ok: 'Add services'
    }).then(function (yes) {
      if (!yes) return;
      busy(btn, true);
      sb.from('events').insert(r.rows).select().then(function (res) {
        busy(btn, false);
        var rows = mustChange(res);
        state.events = state.events.concat(rows);
        $('bs-form').hidden = true;
        renderEvents();
        var ids = rows.map(function (x) { return x.id; });
        toast(plural(rows.length, 'Sunday service') + ' added. They are on the website now.', function () {
          setDeletedMany(ids, true).then(function () { toast('Those ' + rows.length + ' services were removed.'); }).catch(function (x) { report(null, x); });
        });
        $('bs-open').focus();
      }).catch(function (x) { busy(btn, false); report(err, x); });
    });
  }
  function initBulk() {
    $('bs-open').addEventListener('click', function () { openBulk(); });
    $('ev-coverage-btn').addEventListener('click', function () { openBulk(this.getAttribute('data-ym')); });
    $('bs-cancel').addEventListener('click', closeBulk);
    $('bs-month').addEventListener('change', function () { bulk.month = this.value; bulk.picks = {}; bulk.edits = {}; renderBulk(); });
    $('bs-campuses').addEventListener('change', function () { bulk.campuses = bulkCampuses(); renderBulk(); });
    var list = $('bs-list');
    list.addEventListener('input', function (e) {
      var t = e.target, k;
      if ((k = t.getAttribute('data-bs-time')) != null) (bulk.edits[k] = bulk.edits[k] || {}).time = t.value;
      else if ((k = t.getAttribute('data-bs-note')) != null) (bulk.edits[k] = bulk.edits[k] || {}).note = t.value;
      else return;
      updateBulkSummary();
    });
    list.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-bs-pick');
      if (k == null) return;
      bulk.picks[k] = e.target.checked;
      updateBulkSummary();
    });
    list.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-bs-all]');
      if (!b) return;
      var on = b.getAttribute('data-on') === '1', date = b.getAttribute('data-bs-all');
      bulk.campuses.forEach(function (slug) { if (!sundayStatus(date, slug)) bulk.picks[bulkKey(date, slug)] = on; });
      renderBulk();
      var again = document.querySelector('button[data-bs-all="' + date + '"][data-on="' + (on ? 1 : 0) + '"]');
      if (again) again.focus();
    });
    $('bs-form').addEventListener('submit', function (e) { e.preventDefault(); saveBulk(); });
  }

  /* ---------- Repeating an event ---------- */
  function repeatDates(start, mode, until) {
    var out = [start], d = start, y, m, sd, nth, wd;
    if (mode === 'month') {
      sd = isoParts(start); nth = Math.ceil(sd.getUTCDate() / 7); wd = sd.getUTCDay(); y = sd.getUTCFullYear(); m = sd.getUTCMonth();
      while (out.length < 60) {
        m++; if (m > 11) { m = 0; y++; }
        var off = (wd - new Date(Date.UTC(y, m, 1)).getUTCDay() + 7) % 7, day = 1 + off + (nth - 1) * 7;
        if (day > new Date(Date.UTC(y, m + 1, 0)).getUTCDate()) day -= 7; // no 5th weekday this month: use the last one
        var iso = new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
        if (iso > until) break;
        out.push(iso);
      }
    } else {
      var step = mode === 'fortnight' ? 14 : 7;
      while (out.length < 60) { d = addDays(d, step); if (d > until) break; out.push(d); }
    }
    return out;
  }
  function syncRepeat() {
    var mode = $('ev-repeat').value, wrap = $('ev-repeat-until-wrap');
    var ok = !editing && $('ev-status').value === 'normal';
    $('ev-repeat-wrap').hidden = !ok;
    wrap.hidden = !ok || mode === 'none';
    var info = $('ev-repeat-count'), start = $('ev-date').value, until = $('ev-repeat-until').value;
    info.textContent = '';
    if (!wrap.hidden && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(until) && until > start) {
      var n = repeatDates(start, mode, until).length;
      info.textContent = n + ' events, ' + shortDate(start) + ' to ' + shortDate(repeatDates(start, mode, until)[n - 1]) + (n >= 60 ? ' (the most that can be added at once)' : '') + '.';
    }
  }
  // Is there already a live event the same day, with the same title, at an overlapping campus?
  function isDuplicate(v) {
    var a = campusesOf(v), title = String(v.title).trim().toLowerCase();
    return others(v).some(function (o) {
      var b = campusesOf(o);
      return String(o.title).trim().toLowerCase() === title && (a.indexOf('all') > -1 || b.indexOf('all') > -1 || a.some(function (x) { return b.indexOf(x) > -1; }));
    });
  }

  /* ---------- Several events at once: tick them in the Upcoming list ---------- */
  function selectedEvents() { return state.events.filter(function (e) { return selected[e.id] && !e.deleted_at; }); }
  function renderBulkBar() {
    var list = selectedEvents(), bar = $('ev-bulkbar');
    bar.hidden = !list.length;
    $('ev-bulk-count').textContent = plural(list.length, 'event') + ' selected';
  }
  function setDeletedMany(ids, on) {
    return sb.from('events').update({ deleted_at: on ? new Date().toISOString() : null }).in('id', ids).select().then(function (res) {
      var rows = mustChange(res);
      rows.forEach(function (row) { var i = state.events.findIndex(function (x) { return x.id === row.id; }); if (i > -1) state.events[i] = row; });
      renderEvents();
      return rows;
    });
  }
  function mergeRows(rows) {
    rows.forEach(function (row) { var i = state.events.findIndex(function (x) { return x.id === row.id; }); if (i > -1) state.events[i] = row; });
  }
  function bulkDelete() {
    var list = selectedEvents();
    if (!list.length) return;
    confirmBox({
      title: 'Delete ' + plural(list.length, 'event') + '?',
      html: '<p>These will be removed from the website:</p><ul class="adm-changes">' + list.slice(0, 12).map(function (e) {
        return '<li><strong>' + esc(tc(e.title)) + '</strong>, ' + esc(shortDate(e.date)) + ' (' + esc(whereText(e)) + ')</li>';
      }).join('') + (list.length > 12 ? '<li>and ' + (list.length - 12) + ' more</li>' : '') + '</ul><p>You can put them back from “Recently deleted”.</p>',
      ok: 'Delete ' + plural(list.length, 'event'), danger: true
    }).then(function (yes) {
      if (!yes) return;
      var ids = list.map(function (e) { return e.id; });
      setDeletedMany(ids, true).then(function () {
        selected = {}; renderEvents();
        toast(plural(ids.length, 'event') + ' deleted.', function () {
          setDeletedMany(ids, false).then(function () { toast('Events restored. They are back on the website.'); }).catch(function (x) { report(null, x); });
        });
      }).catch(function (x) { report(null, x); });
    });
  }
  function bulkEdit() {
    var list = selectedEvents();
    if (!list.length) return;
    var cancelled = list.filter(function (e) { return statusOf(e) === 'cancelled'; }).length;
    confirmBox({
      title: 'Change ' + plural(list.length, 'event') + '?',
      html: '<p>Fill in only what you want to change. A box left empty keeps what each event has now.</p>' +
        '<div class="fld"><label for="bk-time">New time</label><input id="bk-time" maxlength="40" autocomplete="off"><p class="hint">e.g. 4pm, or 4pm to 6pm.' +
        (cancelled ? ' ' + plural(cancelled, 'cancelled event') + ' (no time) will keep ' + (cancelled === 1 ? 'its' : 'their') + ' empty time.' : '') + '</p></div>' +
        '<div class="fld"><label for="bk-note">New note</label><input id="bk-note" maxlength="500" autocomplete="off"></div>' +
        '<label class="check"><input type="checkbox" id="bk-clear"> Clear the note instead</label>',
      ok: 'Save changes'
    }).then(function (yes) {
      if (!yes) return;
      var time = normTime($('bk-time').value), note = $('bk-note').value.trim(), clear = $('bk-clear').checked;
      if (!time && !note && !clear) { toast('Nothing was changed.'); return; }
      var all = list.map(function (e) { return e.id; });
      var timed = list.filter(function (e) { return statusOf(e) === 'normal'; }).map(function (e) { return e.id; });
      var steps = [];
      if (time && timed.length) steps.push(sb.from('events').update({ time: time }).in('id', timed).select());
      if (note || clear) steps.push(sb.from('events').update({ note: clear ? null : note }).in('id', all).select());
      if (!steps.length) { toast('Nothing was changed.'); return; }
      Promise.all(steps).then(function (rs) {
        rs.forEach(function (res) { mergeRows(mustChange(res)); });
        selected = {}; renderEvents();
        toast(plural(list.length, 'event') + ' updated. The website shows the changes now.');
      }).catch(function (x) { report(null, x); });
    });
  }

  function initEvents() {
    initBulk();
    $('ev-add').addEventListener('click', function () { $('bs-form').hidden = true; openForm(null); });
    $('ev-cancel').addEventListener('click', closeForm);
    $('ev-campuses').addEventListener('change', function (e) {
      var t = e.target;
      if (t.name !== 'ev-campus' || !t.checked) return;
      // "All campuses" and individual campuses are exclusive
      document.querySelectorAll('input[name=ev-campus]').forEach(function (i) {
        if (t.value === 'all' || t.value === 'none' ? i.value !== t.value : i.value === 'all' || i.value === 'none') i.checked = false;
      });
    });
    ['ev-title', 'ev-type', 'ev-date', 'ev-time', 'ev-note'].forEach(function (id) { $(id).addEventListener('input', updatePreview); });
    $('ev-type').addEventListener('change', function () {
      typeTouched = true;
      if ($('ev-type').value === 'Special event' && !checkedCampuses().length) setCampuses(['none']);
    });
    ['ev-time-end', 'ev-loc-name', 'ev-loc-address', 'ev-loc-url'].forEach(function (id) { $(id).addEventListener('input', updatePreview); });
    ['ev-type', 'ev-date'].forEach(function (id) { $(id).addEventListener('change', function () { autoFill(); updatePreview(); syncRepeat(); }); });
    $('ev-campuses').addEventListener('change', function () { renderCombinedOptions(); autoFill(); updatePreview(); });
    $('ev-status').addEventListener('change', function () { syncStatus(); renderCombinedOptions(); autoFill(); updatePreview(); syncRepeat(); });
    $('ev-combined').addEventListener('change', updatePreview);
    ['ev-repeat', 'ev-repeat-until'].forEach(function (id) { $(id).addEventListener('change', syncRepeat); });

    // Upcoming list: filter by campus, tick several events
    $('ev-filter').addEventListener('change', function () { evFilter = this.value; renderEvents(); });
    $('ev-upcoming').addEventListener('change', function (e) {
      var t = e.target, id = t.getAttribute('data-sel'), day = t.getAttribute('data-seldate');
      if (id) { if (t.checked) selected[id] = true; else delete selected[id]; }
      else if (day) {
        document.querySelectorAll('input[data-sel][data-date="' + day + '"]').forEach(function (i) {
          i.checked = t.checked;
          if (t.checked) selected[i.getAttribute('data-sel')] = true; else delete selected[i.getAttribute('data-sel')];
        });
      } else return;
      renderBulkBar();
    });
    $('ev-bulk-del').addEventListener('click', bulkDelete);
    $('ev-bulk-edit').addEventListener('click', bulkEdit);
    $('ev-bulk-clear').addEventListener('click', function () { selected = {}; renderEvents(); $('ev-filter').focus(); });

    $('ev-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = formValues(), err = $('ev-error'), btn = $('ev-save');
      var problem = validate(v);
      // Repeating (new events only): the dates to add, from the first date up to “Repeat until”
      var mode = editing ? 'none' : $('ev-repeat').value, dates = [v.date];
      if (!problem && mode !== 'none' && !$('ev-repeat-wrap').hidden) {
        var until = $('ev-repeat-until').value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= v.date) {
          problem = 'Please choose a “Repeat until” date after the first date.';
          $('ev-repeat-until').setAttribute('aria-invalid', 'true');
        } else dates = repeatDates(v.date, mode, until);
      }
      showError(err, problem);
      if (problem) { var bad = $('ev-form').querySelector('[aria-invalid]') || document.querySelector('input[name=ev-campus]'); if (bad) bad.focus(); return; }
      var rows = dates.map(function (d) { return Object.assign({}, v, { date: d }); });

      // Questions to answer before saving, in order. Any “no” stops the save.
      var asks = [];
      if (!editing) {
        var dupes = rows.filter(isDuplicate);
        if (dupes.length) asks.push(function () {
          return confirmBox({
            title: 'This may already be added',
            html: '<p>There is already <strong>' + esc(v.title) + '</strong> at the same campus on ' + (dupes.length === 1 ? '<strong>' + esc(longDate(dupes[0].date)) + '</strong>' : plural(dupes.length, 'of these dates')) + '. Add it again anyway?</p>',
            ok: 'Add anyway', danger: true
          });
        });
      }
      if (v.type === 'Cancellation') asks.push(function () {
        return confirmBox({
          title: 'Post this cancellation?',
          html: '<p><strong>' + esc(v.title) + '</strong> at <strong>' + esc(campusNames(v.campuses)) + '</strong> on <strong>' + esc(longDate(v.date)) + '</strong>' +
            ' will be shown as <strong>Cancelled</strong>' + (v.combined_with ? ', combined with <strong>' + esc(campusName(v.combined_with)) + '</strong>,' : '') + ' on the website straight away.</p>' +
            '<p class="adm-hint">This is how it will look:</p><div class="adm-preview adm-preview--plain">' + previewHTML(v) + '</div>',
          ok: 'Yes, post cancellation', danger: true
        });
      });
      if (rows.length > 1) asks.push(function () {
        return confirmBox({
          title: 'Add ' + plural(rows.length, 'event') + '?',
          html: '<p><strong>' + esc(v.title) + '</strong> (' + esc(whereText(v)) + (v.time ? ', ' + esc(v.time) : '') + ') on:</p><p>' + esc(rows.map(function (r) { return shortDate(r.date); }).join(', ')) + '</p>' +
            '<p class="adm-hint">You can edit or delete any one of them afterwards.</p>',
          ok: 'Add ' + plural(rows.length, 'event')
        });
      });
      var ask = asks.reduce(function (p, fn) { return p.then(function (ok) { return ok ? fn() : false; }); }, Promise.resolve(true));

      ask.then(function (yes) {
        if (!yes) return;
        busy(btn, true);
        var q = editing ? sb.from('events').update(v).eq('id', editing).select() : sb.from('events').insert(rows).select();
        return q.then(function (res) {
          busy(btn, false);
          var saved = mustChange(res);
          saved.forEach(function (row) {
            var i = state.events.findIndex(function (x) { return x.id === row.id; });
            if (i > -1) state.events[i] = row; else state.events.push(row);
          });
          var wasNew = !editing, row = saved[0];
          $('ev-form').hidden = true; editing = null;
          renderEvents();
          if (saved.length > 1) {
            var ids = saved.map(function (x) { return x.id; });
            toast(plural(saved.length, 'event') + ' added. They are on the website now.', function () {
              setDeletedMany(ids, true).then(function () { toast('Those ' + saved.length + ' events were removed.'); }).catch(function (x) { report(null, x); });
            });
          } else toast(wasNew ? 'Event added. It is on the website now.' : 'Event saved. The website shows the change now.');
          var b = document.querySelector('[data-edit="' + row.id + '"]');
          (b || $('ev-add')).focus();
        }).catch(function (x) { busy(btn, false); report(err, x); });
      });
    });

    $('panel-events').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-edit], button[data-copy], button[data-del], button[data-restore]');
      if (!b) return;
      var id = b.getAttribute('data-edit') || b.getAttribute('data-copy') || b.getAttribute('data-del') || b.getAttribute('data-restore');
      var ev = state.events.find(function (x) { return x.id === id; });
      if (!ev) return;
      if (b.hasAttribute('data-edit')) openForm(ev);
      if (b.hasAttribute('data-copy')) openForm(ev, true);
      if (b.hasAttribute('data-del')) deleteEvent(ev);
      if (b.hasAttribute('data-restore')) restoreEvent(ev);
    });
  }

  function setDeleted(ev, on) {
    return sb.from('events').update({ deleted_at: on ? new Date().toISOString() : null }).eq('id', ev.id).select().then(function (res) {
      var row = mustChange(res)[0];
      var i = state.events.findIndex(function (x) { return x.id === row.id; });
      if (i > -1) state.events[i] = row;
      renderEvents();
      return row;
    });
  }
  function deleteEvent(ev) {
    confirmBox({
      title: 'Delete this event?',
      html: '<p><strong>' + esc(tc(ev.title)) + '</strong> on ' + esc(longDate(ev.date)) + ' (' + esc(campusNames(ev.campuses)) + ') will be removed from the website.</p><p>You can put it back from “Recently deleted”.</p>',
      ok: 'Delete event', danger: true
    }).then(function (yes) {
      if (!yes) return;
      setDeleted(ev, true).then(function () {
        $('ev-add').focus();
        toast('Event deleted.', function () { restoreEvent(ev); });
      }).catch(function (x) { report(null, x); });
    });
  }
  function restoreEvent(ev) {
    setDeleted(ev, false).then(function (row) {
      toast('Event restored. It is back on the website.');
      var b = document.querySelector('[data-edit="' + row.id + '"]');
      if (b) b.focus();
    }).catch(function (x) { report(null, x); });
  }

  function hiddenLine(ev, mode) {
    if (mode === 'deleted') return '';
    var live = state.events.filter(function (e) { return !e.deleted_at && e.date === ev.date; });
    var hit = campusesOf(ev).map(function (c) { return { c: c, by: replacedBy(ev, c, live) }; }).filter(function (x) { return x.by; });
    if (!hit.length) return '';
    var by = hit[0].by;
    return '<p class="adm-item__hidden">Not shown on the website' + (hit.length < campusesOf(ev).length ? ' for ' + esc(andList(hit.map(function (x) { return campusName(x.c); }))) : '') +
      ': replaced by the cancellation' + (isCombined(by) ? ' (combined with ' + esc(campusName(by.combined_with)) + ')' : '') + '.</p>';
  }
  function eventItem(ev, mode) {
    var label = esc(tc(ev.title)) + ', ' + esc(longDate(ev.date));
    var actions = mode === 'deleted'
      ? '<button type="button" class="btn btn--navy btn--sm" data-restore="' + ev.id + '">Restore<span class="visually-hidden"> ' + label + '</span></button>'
      : (mode === 'past' ? '<button type="button" class="btn btn--navy btn--sm" data-copy="' + ev.id + '">Copy<span class="visually-hidden"> ' + label + ' to a new date</span></button>' : '') +
        '<button type="button" class="btn btn--outline btn--sm" data-edit="' + ev.id + '">Edit<span class="visually-hidden"> ' + label + '</span></button>' +
        '<button type="button" class="btn btn--sm adm-danger" data-del="' + ev.id + '">Delete<span class="visually-hidden"> ' + label + '</span></button>';
    var st = statusOf(ev);
    // In the grouped Upcoming list the day heading already shows the date
    var meta = [mode === 'up' ? '' : longDate(ev.date), replaces(ev) ? 'no service' : ev.time, whereText(ev), isCombined(ev) ? 'combined with ' + campusName(ev.combined_with) : ''].filter(Boolean).map(esc).join(' · ');
    var del = mode === 'deleted' && ev.deleted_at ? ' · deleted ' + esc(stampFmt.format(new Date(ev.deleted_at))) : '';
    var pick = mode === 'up'
      ? '<label class="adm-item__pick"><input type="checkbox" data-sel="' + ev.id + '" data-date="' + esc(ev.date) + '"' + (selected[ev.id] ? ' checked' : '') + '><span class="visually-hidden">Select ' + label + '</span></label>' : '';
    return '<li class="adm-item' + (st === 'cancelled' ? ' is-cancel' : '') + (pick ? ' has-pick' : '') + '">' + pick + '<div class="adm-item__main">' +
      '<p class="adm-item__title">' + badge(badgeKey(ev)) + ' ' + esc(tc(ev.title)) + '</p>' +
      '<p class="adm-item__meta">' + meta + '</p>' +
      (ev.note ? '<p class="adm-item__note">' + esc(ev.note) + '</p>' : '') +
      hiddenLine(ev, mode) +
      '<p class="adm-item__stamp">' + esc(stamp(ev)) + del + '</p>' +
      '</div><div class="adm-item__actions">' + actions + '</div></li>';
  }
  // The Upcoming list: one heading per day (with “select all”), the events of that day under it
  function upcomingHTML(list) {
    var html = '', day = null;
    list.forEach(function (e) {
      if (e.date !== day) {
        day = e.date;
        var same = list.filter(function (x) { return x.date === day; });
        var all = same.every(function (x) { return selected[x.id]; });
        html += '<li class="adm-day"><h4>' + esc(longDate(day)) + '</h4><label class="check adm-day__all"><input type="checkbox" data-seldate="' + esc(day) + '"' + (all ? ' checked' : '') + '> Select all<span class="visually-hidden"> on ' + esc(longDate(day)) + '</span></label></li>';
      }
      html += eventItem(e, 'up');
    });
    return html;
  }
  function renderEvents() {
    var today = melToday();
    var live = state.events.filter(function (e) { return !e.deleted_at; });
    var up = live.filter(function (e) { return e.date >= today; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var past = live.filter(function (e) { return e.date < today; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var gone = state.events.filter(function (e) { return e.deleted_at; }).sort(function (a, b) { return a.deleted_at < b.deleted_at ? 1 : -1; });
    // Special events are shown for every campus on the website, so they stay in whatever campus is picked
    var shown = evFilter ? up.filter(function (e) { return e.type === 'Special event' || covers(e, evFilter); }) : up;
    var ids = {}; up.forEach(function (e) { ids[e.id] = true; });
    Object.keys(selected).forEach(function (id) { if (!ids[id]) delete selected[id]; });
    $('ev-upcoming').innerHTML = shown.length ? upcomingHTML(shown) : '<li class="adm-empty">' + (up.length ? 'Nothing upcoming for ' + esc(campusName(evFilter)) + '.' : 'No upcoming events. Use “Add event” to add one.') + '</li>';
    $('ev-upcoming-count').textContent = '(' + (shown.length === up.length ? up.length : shown.length + ' of ' + up.length) + ')';
    renderBulkBar();
    renderCoverage();
    $('ev-past').innerHTML = past.length ? past.map(function (e) { return eventItem(e, 'past'); }).join('') : '<li class="adm-empty">No past events.</li>';
    $('ev-deleted').innerHTML = gone.length ? gone.map(function (e) { return eventItem(e, 'deleted'); }).join('') : '<li class="adm-empty">Nothing has been deleted.</li>';
    $('ev-past-count').textContent = '(' + past.length + ')';
    $('ev-del-count').textContent = '(' + gone.length + ')';
  }

  /* =====================================================================
     SERVICE TIMES
     ===================================================================== */
  var CP_FIELDS = [
    { k: 'sunday_time', label: 'Regular Sunday time', hint: 'e.g. 9:30am or 4pm', max: 20, required: true },
    { k: 'venue', label: 'Venue', max: 120, required: true },
    { k: 'address', label: 'Address', max: 160, required: true },
    { k: 'transport_note', label: 'Transport note', hint: 'e.g. ~10mins by bus from Melton Station', max: 200 },
    { k: 'language', label: 'Language', hint: 'e.g. Tamil · English interpretation', max: 80 },
    { k: 'map_url', label: 'Map link', hint: 'The Google Maps “Share” link, starting with https://', max: 500, type: 'url' }
  ];
  function renderCampuses() {
    var box = $('cp-list');
    box.innerHTML = state.campuses.map(function (c) {
      var id = 'cp-' + c.slug;
      return '<form class="adm-card adm-form cp" data-slug="' + esc(c.slug) + '" novalidate aria-labelledby="' + id + '-t">' +
        '<h3 id="' + id + '-t">' + esc(c.name) + '</h3><div class="adm-grid">' +
        CP_FIELDS.map(function (f) {
          var fid = id + '-' + f.k;
          return '<div class="fld' + (f.k === 'venue' || f.k === 'address' || f.k === 'map_url' ? ' fld--wide' : '') + '"><label for="' + fid + '">' + f.label + '</label>' +
            '<input id="' + fid + '" name="' + f.k + '" type="' + (f.type || 'text') + '" maxlength="' + f.max + '" value="' + esc(c[f.k] || '') + '"' +
            (f.required ? ' required' : '') + (f.hint ? ' aria-describedby="' + fid + '-h"' : '') + '>' +
            (f.hint ? '<p class="hint" id="' + fid + '-h">' + f.hint + '</p>' : '') + '</div>';
        }).join('') +
        '</div><p class="adm-item__stamp">' + esc(stamp(c)) + '</p><p class="form-error" hidden></p>' +
        '<div class="adm-actions"><button type="submit" class="btn btn--navy">Save ' + esc(c.name) + '</button></div></form>';
    }).join('') || '<p class="adm-empty">No campuses found. Has supabase/schema.sql been run?</p>';
  }
  function initTimes() {
    $('panel-times').addEventListener('submit', function (e) {
      var form = e.target.closest('form.cp');
      if (!form) return;
      e.preventDefault();
      var slug = form.getAttribute('data-slug');
      var c = state.campuses.find(function (x) { return x.slug === slug; });
      var err = form.querySelector('.form-error'), btn = form.querySelector('[type=submit]');
      var v = {}, changes = [], missing = [];
      showError(err, '');
      CP_FIELDS.forEach(function (f) {
        var input = form.elements[f.k];
        input.removeAttribute('aria-invalid');
        var val = input.value.trim();
        if (f.required && !val) { missing.push(f.label.toLowerCase()); input.setAttribute('aria-invalid', 'true'); }
        if (f.k === 'map_url' && val && !/^https:\/\/\S+$/.test(val)) { missing.push('a map link starting with https://'); input.setAttribute('aria-invalid', 'true'); }
        v[f.k] = val || null;
        if ((c[f.k] || null) !== v[f.k]) changes.push('<li><strong>' + f.label + ':</strong> ' + (c[f.k] ? '<s>' + esc(c[f.k]) + '</s> → ' : '') + (v[f.k] ? esc(v[f.k]) : '<em>(empty)</em>') + '</li>');
      });
      if (missing.length) { showError(err, 'Please add ' + missing.join(', ') + '.'); return; }
      if (!changes.length) { toast('Nothing has changed for ' + c.name + '.'); return; }
      confirmBox({
        title: 'Change the regular details for ' + c.name + '?',
        html: '<ul class="adm-changes">' + changes.join('') + '</ul><p>This changes every page of the website straight away, for every Sunday.</p>' +
          '<p class="adm-note"><strong>Reminder:</strong> For a one-off change on a single Sunday, add a Service change or Cancellation event instead of editing the regular time.</p>',
        ok: 'Save changes'
      }).then(function (yes) {
        if (!yes) return;
        busy(btn, true);
        sb.from('campuses').update(v).eq('slug', slug).select().then(function (res) {
          busy(btn, false);
          var row = mustChange(res)[0];
          var i = state.campuses.findIndex(function (x) { return x.slug === slug; });
          state.campuses[i] = row;
          renderCampuses(); renderCampusChecks(); renderEvents();
          toast(row.name + ' saved. The website shows the new details now.');
          var nb = document.querySelector('form.cp[data-slug="' + slug + '"] [type=submit]');
          if (nb) nb.focus();
        }).catch(function (x) { busy(btn, false); report(err, x); });
      });
    });
  }

  /* =====================================================================
     GALLERY
     ===================================================================== */
  var staged = []; // { file, url, id }
  function photoUrl(path) { return SB_URL + '/storage/v1/object/public/' + BUCKET + '/' + String(path).split('/').map(encodeURIComponent).join('/'); }
  function thumbPath(p) { return String(p).replace(/(\.[a-z0-9]+)$/i, '-sm$1'); }
  function campusSelect(id, value) {
    var opts = [{ slug: 'all', name: 'All campuses' }].concat(state.campuses);
    return '<select id="' + id + '">' + opts.map(function (c) {
      return '<option value="' + esc(c.slug) + '"' + (c.slug === value ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('') + '</select>';
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  function renderStage() {
    $('gl-stage').innerHTML = staged.map(function (s, i) {
      var id = 'gs-' + s.id;
      return '<li class="gl-stage__item" data-i="' + i + '"><img src="' + s.url + '" alt="" width="120" height="90">' +
        '<div class="adm-grid">' +
        '<div class="fld fld--wide"><label for="' + id + '-alt">Describe the photo (alt text) — required</label>' +
        '<input id="' + id + '-alt" class="gs-alt" maxlength="250" required value="' + esc(s.alt || '') + '" aria-describedby="' + id + '-ah">' +
        '<p class="hint" id="' + id + '-ah">What would someone who can’t see it need to know? e.g. “Children singing at the Sunshine Christmas service”. File: ' + esc(s.file.name) + '</p></div>' +
        '<div class="fld"><label for="' + id + '-cap">Caption (optional)</label><input id="' + id + '-cap" class="gs-cap" maxlength="250" value="' + esc(s.caption || '') + '"></div>' +
        '<div class="fld"><label for="' + id + '-camp">Campus</label>' + campusSelect(id + '-camp', s.campus || 'all').replace('<select ', '<select class="gs-camp" ') + '</div>' +
        '</div><p class="gl-stage__status" aria-live="polite"></p>' +
        '<button type="button" class="adm-link gs-remove">Remove<span class="visually-hidden"> ' + esc(s.file.name) + '</span></button></li>';
    }).join('');
    $('gl-actions').hidden = !staged.length;
  }
  function syncStage() {
    document.querySelectorAll('.gl-stage__item').forEach(function (li) {
      var s = staged[+li.getAttribute('data-i')];
      s.alt = li.querySelector('.gs-alt').value; s.caption = li.querySelector('.gs-cap').value; s.campus = li.querySelector('.gs-camp').value;
    });
  }
  function clearStage() {
    staged.forEach(function (s) { URL.revokeObjectURL(s.url); });
    staged = [];
    $('gl-files').value = '';
    renderStage();
    showError($('gl-error'), '');
  }

  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); });
    }
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('This file could not be read as a photo.')); };
      img.src = URL.createObjectURL(file);
    });
  }
  function toJpeg(src, maxW, maxBytes) {
    var w = src.width, h = src.height;
    var scale = Math.min(1, maxW / w);
    function attempt(s, q) {
      var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch); // PNG transparency → white
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, cw, ch);
      return new Promise(function (resolve) { c.toBlob(resolve, 'image/jpeg', q); }).then(function (blob) {
        if (!blob) throw new Error('This browser could not prepare the photo.');
        if (blob.size <= maxBytes) return blob;
        if (q > 0.55) return attempt(s, Math.round((q - 0.1) * 100) / 100);
        return attempt(s * 0.85, 0.8);
      });
    }
    return attempt(scale, 0.85);
  }

  function uploadOne(s, sortValue, statusEl) {
    var year = melToday().slice(0, 4);
    var base = 'photos/' + year + '/' + uuid();
    var path = base + '.jpg', small = base + '-sm.jpg';
    var store = sb.storage.from(BUCKET);
    statusEl.textContent = 'Preparing…';
    return loadImage(s.file).then(function (img) {
      return Promise.all([toJpeg(img, MAX_W, MAX_BYTES), toJpeg(img, THUMB_W, 120 * 1024)]);
    }).then(function (blobs) {
      statusEl.textContent = 'Uploading (' + Math.round(blobs[0].size / 1024) + ' KB)…';
      var opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
      return store.upload(path, blobs[0], opts).then(must).then(function () { return store.upload(small, blobs[1], opts).then(must); });
    }).then(function () {
      return sb.from('gallery').insert({ image_path: path, alt: s.alt.trim(), caption: s.caption.trim() || null, campuses: [s.campus || 'all'], sort: sortValue }).select();
    }).then(function (res) {
      var row = mustChange(res)[0];
      statusEl.textContent = 'Uploaded.';
      return row;
    }).catch(function (e) {
      store.remove([path, small]).catch(function () {}); // tidy up a half-finished upload
      throw e;
    });
  }

  function initGallery() {
    $('gl-files').addEventListener('change', function (e) {
      syncStage();
      var bad = [];
      Array.prototype.forEach.call(e.target.files, function (f) {
        if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { bad.push(f.name); return; }
        staged.push({ file: f, url: URL.createObjectURL(f), id: uuid().slice(0, 8), alt: '', caption: '', campus: 'all' });
      });
      e.target.value = '';
      renderStage();
      showError($('gl-error'), bad.length ? 'These files are not JPEG, PNG or WebP photos and were skipped: ' + bad.join(', ') : '');
      var first = document.querySelector('.gs-alt');
      if (first && staged.length) first.focus();
    });
    $('gl-stage').addEventListener('click', function (e) {
      var b = e.target.closest('.gs-remove');
      if (!b) return;
      syncStage();
      var i = +b.closest('li').getAttribute('data-i');
      URL.revokeObjectURL(staged[i].url);
      staged.splice(i, 1);
      renderStage();
      $('gl-files').focus();
    });
    $('gl-clear').addEventListener('click', function () { clearStage(); $('gl-files').focus(); });
    $('gl-form').addEventListener('submit', function (e) {
      e.preventDefault();
      syncStage();
      var err = $('gl-error'), btn = $('gl-upload');
      showError(err, '');
      var missing = null;
      document.querySelectorAll('.gs-alt').forEach(function (i) {
        var empty = !i.value.trim();
        if (empty) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid');
        if (empty && !missing) missing = i;
      });
      if (missing) { showError(err, 'Every photo needs a description (alt text) before it can be uploaded.'); missing.focus(); return; }
      busy(btn, true, 'Uploading…');
      var maxSort = state.gallery.reduce(function (m, g) { return Math.max(m, g.sort || 0); }, 0);
      var items = Array.prototype.slice.call(document.querySelectorAll('.gl-stage__item'));
      var done = 0, failed = [];
      var chain = Promise.resolve();
      staged.forEach(function (s, i) {
        chain = chain.then(function () {
          return uploadOne(s, maxSort + (i + 1) * 10, items[i].querySelector('.gl-stage__status')).then(function (row) {
            state.gallery.push(row); done++;
          }, function (x) {
            if (x instanceof SessionGone) throw x;
            failed.push(s); items[i].querySelector('.gl-stage__status').textContent = 'Not uploaded: ' + friendly(x);
          });
        });
      });
      chain.then(function () {
        busy(btn, false);
        staged.filter(function (s) { return failed.indexOf(s) < 0; }).forEach(function (s) { URL.revokeObjectURL(s.url); });
        staged = failed;
        renderStage();
        renderGallery();
        if (failed.length) showError(err, done + ' uploaded, ' + failed.length + ' not uploaded. Check the photos still listed above and try again.');
        toast(done === 1 ? '1 photo added to the website.' : done + ' photos added to the website.');
      }).catch(function (x) { busy(btn, false); report(err, x); });
    });

    $('panel-gallery').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-gact]');
      if (!b) return;
      var id = b.getAttribute('data-id'), act = b.getAttribute('data-gact');
      var g = state.gallery.find(function (x) { return x.id === id; });
      if (!g) return;
      if (act === 'up' || act === 'down') movePhoto(g, act === 'up' ? -1 : 1);
      if (act === 'del') softDeletePhoto(g, true);
      if (act === 'restore') softDeletePhoto(g, false);
      if (act === 'forever') deleteForever(g);
    });
    $('panel-gallery').addEventListener('submit', function (e) {
      var form = e.target.closest('form.gl-edit');
      if (!form) return;
      e.preventDefault();
      var id = form.getAttribute('data-id');
      var alt = form.elements.alt.value.trim(), err = form.querySelector('.form-error'), btn = form.querySelector('[type=submit]');
      showError(err, '');
      if (!alt) { form.elements.alt.setAttribute('aria-invalid', 'true'); showError(err, 'A description (alt text) is required.'); form.elements.alt.focus(); return; }
      form.elements.alt.removeAttribute('aria-invalid');
      busy(btn, true);
      sb.from('gallery').update({ alt: alt, caption: form.elements.caption.value.trim() || null, campuses: [form.elements.campus.value] }).eq('id', id).select().then(function (res) {
        busy(btn, false);
        replacePhoto(mustChange(res)[0]);
        toast('Photo details saved.');
      }).catch(function (x) { busy(btn, false); report(err, x); });
    });
  }
  function replacePhoto(row) {
    var i = state.gallery.findIndex(function (x) { return x.id === row.id; });
    if (i > -1) state.gallery[i] = row; else state.gallery.push(row);
  }
  function liveSorted() {
    return state.gallery.filter(function (g) { return !g.deleted_at; }).sort(function (a, b) {
      return (a.sort || 0) - (b.sort || 0) || (a.created_at < b.created_at ? 1 : -1);
    });
  }
  function movePhoto(g, step) {
    var list = liveSorted();
    var i = list.indexOf(g), j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    list.splice(i, 1); list.splice(j, 0, g);
    // Renumber in steps of 10 and save only the rows whose position changed
    var changed = [];
    list.forEach(function (row, k) { if (row.sort !== (k + 1) * 10) changed.push({ id: row.id, sort: (k + 1) * 10 }); });
    Promise.all(changed.map(function (c) { return sb.from('gallery').update({ sort: c.sort }).eq('id', c.id).select().then(mustChange); }))
      .then(function (rows) {
        rows.forEach(function (r) { replacePhoto(r[0]); });
        renderGallery();
        toast('Photo moved ' + (step < 0 ? 'up' : 'down') + ' to position ' + (j + 1) + ' of ' + list.length + '.');
        var b = document.querySelector('button[data-gact="' + (step < 0 ? 'up' : 'down') + '"][data-id="' + g.id + '"]');
        if (b && !b.disabled) b.focus(); else { b = document.querySelector('[data-id="' + g.id + '"][data-gact]'); if (b) b.focus(); }
      }).catch(function (x) { report(null, x); });
  }
  function softDeletePhoto(g, on) {
    var go = on ? confirmBox({
      title: 'Delete this photo?',
      html: '<p>“' + esc(g.alt) + '” will be removed from the website. You can put it back from “Recently deleted”.</p>',
      ok: 'Delete photo', danger: true
    }) : Promise.resolve(true);
    go.then(function (yes) {
      if (!yes) return;
      sb.from('gallery').update({ deleted_at: on ? new Date().toISOString() : null }).eq('id', g.id).select().then(function (res) {
        replacePhoto(mustChange(res)[0]);
        renderGallery();
        if (on) toast('Photo deleted.', function () { softDeletePhoto(g, false); });
        else toast('Photo restored. It is back on the website.');
        $('gl-files').focus();
      }).catch(function (x) { report(null, x); });
    });
  }
  function deleteForever(g) {
    confirmBox({
      title: 'Delete this photo forever?',
      html: '<p>“' + esc(g.alt) + '” will be permanently removed, including the image file. <strong>This cannot be undone.</strong></p>',
      ok: 'Delete forever', danger: true
    }).then(function (yes) {
      if (!yes) return;
      sb.storage.from(BUCKET).remove([g.image_path, thumbPath(g.image_path)]).then(must).then(function () {
        return sb.from('gallery').delete().eq('id', g.id).select().then(mustChange);
      }).then(function () {
        state.gallery = state.gallery.filter(function (x) { return x.id !== g.id; });
        renderGallery();
        toast('Photo permanently deleted.');
        $('gl-files').focus();
      }).catch(function (x) { report(null, x); });
    });
  }
  function renderGallery() {
    if (!state.appOn) return;
    var live = liveSorted();
    var gone = state.gallery.filter(function (g) { return g.deleted_at; }).sort(function (a, b) { return a.deleted_at < b.deleted_at ? 1 : -1; });
    $('gl-list').innerHTML = live.map(function (g, i) {
      var id = 'gl-' + g.id.slice(0, 8);
      var camp = (g.campuses && g.campuses[0]) || 'all';
      return '<li class="gl-card"><img src="' + esc(photoUrl(thumbPath(g.image_path))) + '" alt="" width="300" height="225" loading="lazy">' +
        '<form class="gl-edit" data-id="' + g.id + '" novalidate aria-label="Photo ' + (i + 1) + ' details">' +
        '<div class="fld"><label for="' + id + '-alt">Description (alt text)</label><input id="' + id + '-alt" name="alt" maxlength="250" required value="' + esc(g.alt) + '"></div>' +
        '<div class="fld"><label for="' + id + '-cap">Caption</label><input id="' + id + '-cap" name="caption" maxlength="250" value="' + esc(g.caption || '') + '"></div>' +
        '<div class="fld"><label for="' + id + '-camp">Campus</label>' + campusSelect(id + '-camp', camp).replace('<select ', '<select name="campus" ') + '</div>' +
        '<p class="form-error" hidden></p>' +
        '<div class="gl-card__actions">' +
        '<button type="submit" class="btn btn--navy btn--sm">Save<span class="visually-hidden"> photo ' + (i + 1) + ' details</span></button>' +
        '<button type="button" class="btn btn--outline btn--sm" data-gact="up" data-id="' + g.id + '"' + (i === 0 ? ' disabled' : '') + '>Move up<span class="visually-hidden"> photo ' + (i + 1) + '</span></button>' +
        '<button type="button" class="btn btn--outline btn--sm" data-gact="down" data-id="' + g.id + '"' + (i === live.length - 1 ? ' disabled' : '') + '>Move down<span class="visually-hidden"> photo ' + (i + 1) + '</span></button>' +
        '<button type="button" class="btn btn--sm adm-danger" data-gact="del" data-id="' + g.id + '">Delete<span class="visually-hidden"> photo ' + (i + 1) + '</span></button>' +
        '</div></form></li>';
    }).join('') || '<li class="adm-empty">No photos yet. Add some above.</li>';
    $('gl-deleted').innerHTML = gone.map(function (g) {
      return '<li class="gl-card"><img src="' + esc(photoUrl(thumbPath(g.image_path))) + '" alt="" width="300" height="225" loading="lazy">' +
        '<p class="gl-card__alt">' + esc(g.alt) + '</p>' +
        '<p class="adm-item__stamp">Deleted ' + esc(stampFmt.format(new Date(g.deleted_at))) + '</p>' +
        '<div class="gl-card__actions">' +
        '<button type="button" class="btn btn--navy btn--sm" data-gact="restore" data-id="' + g.id + '">Restore<span class="visually-hidden"> ' + esc(g.alt) + '</span></button>' +
        '<button type="button" class="btn btn--sm adm-danger" data-gact="forever" data-id="' + g.id + '">Delete forever<span class="visually-hidden"> ' + esc(g.alt) + '</span></button>' +
        '</div></li>';
    }).join('') || '<li class="adm-empty">Nothing has been deleted.</li>';
    $('gl-count').textContent = '(' + live.length + ')';
    $('gl-del-count').textContent = '(' + gone.length + ')';
  }
})();
