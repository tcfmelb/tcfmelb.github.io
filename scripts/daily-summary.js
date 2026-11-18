#!/usr/bin/env node
/* Daily email: reads the report written by scripts/export-events.js, adds yesterday's visitor
   numbers (GoatCounter) and a health check of the website and Supabase, and emails a plain-text
   summary. Runs in GitHub Actions (.github/workflows/supabase-daily.yml).

     REPORT_FILE=report.json node scripts/daily-summary.js                 # build and send
     REPORT_FILE=report.json node scripts/daily-summary.js --dry-run       # print it, send nothing
     REPORT_FILE=report.json node scripts/daily-summary.js --out email.txt # save it, send nothing

   If anything is not OK (the Supabase read failed, a page or check failed, or editors' emails are
   readable by visitors) the subject starts with "PROBLEM" and, after the email has been sent, the
   script exits with an error so the GitHub run is marked as failed.

   Settings (environment variables):
     NOTIFY_EMAIL, SMTP_FROM                         repository variables
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD  repository secrets (never printed)
     GOATCOUNTER_CODE (variable), GOATCOUNTER_TOKEN (secret)   visitor numbers; optional
     SITE_URL          variable, default https://tcfmelbourne.org
     SUPABASE_URL, SUPABASE_ANON_KEY                 variables (public key only)
     ADMIN_URL         optional, default <SITE_URL>/admin/

   The email says what changed, never who changed it, and contains no personal data. */
'use strict';
const fs = require('fs');
const { assertPublicKey } = require('./export-events');
// The website's own Title Case rule (main.js), so titles read the same in the email: "Sunday Service"
const { titleCase } = require('../main.js');

const TZ = 'Australia/Melbourne';
const SOON_DAYS = 14;
const SPECIAL_DAYS = 30;
const TIMEOUT_MS = 15000;
const SLOW_MS = 3000; // shown as "slow", not a problem
const CAMPUS_NAMES = { melton: 'Melton', mernda: 'Mernda', sunshine: 'Sunshine', tarneit: 'Tarneit', 'noble-park': 'Noble Park' };

function config(env) {
  const site = (env.SITE_URL || 'https://tcfmelbourne.org').replace(/\/+$/, '');
  return {
    site,
    admin: env.ADMIN_URL || site + '/admin/',
    sbUrl: (env.SUPABASE_URL || 'https://ahrwrjxlsaprqbbtjvzk.supabase.co').replace(/\/+$/, ''),
    sbKey: env.SUPABASE_ANON_KEY || 'sb_publishable_CmYHlzu_nPM0MM1SkMOOZA_uIYVYz4o',
    gcCode: env.GOATCOUNTER_CODE || '',
    gcToken: env.GOATCOUNTER_TOKEN || ''
  };
}

/* ---------- dates, always in Melbourne time ---------- */
function melbourneToday(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Melbourne's offset from UTC at a given moment, in minutes (+600 or +660).
function melOffset(instant) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' }).formatToParts(instant)
    .find((p) => p.type === 'timeZoneName').value; // "GMT+11:00"
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
}
// The UTC moment when the given Melbourne calendar day starts.
function melMidnight(iso) {
  const utc = Date.parse(iso + 'T00:00:00Z');
  let t = utc - melOffset(new Date(utc)) * 60000;
  t = utc - melOffset(new Date(t)) * 60000; // second pass in case the offset changed that night
  return new Date(t);
}
// Event dates are calendar dates (no time zone), so format them as UTC to avoid any shift.
function longDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '');
}
function shortDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}
// "9:30am", "from 6:30pm", "7pm" -> minutes after midnight, for sorting; unknown times sort last.
function minutes(time) {
  const m = /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i.exec(String(time || ''));
  if (!m) return 24 * 60;
  return ((+m[1] % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0)) * 60 + (+m[2] || 0);
}
const secs = (ms) => (ms / 1000).toFixed(2) + ' s';

/* ---------- HTTP with timing ---------- */
async function timed(fetchFn, url, opts) {
  const t0 = Date.now();
  try {
    const res = await fetchFn(url, Object.assign({ redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) }, opts || {}));
    const text = await res.text();
    return { status: res.status, ms: Date.now() - t0, text };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, text: '', error: e && e.name === 'TimeoutError' ? `no response within ${TIMEOUT_MS / 1000} s` : (e && e.message) || 'request failed' };
  }
}
const parseJSON = (t) => { try { return JSON.parse(t); } catch (e) { return undefined; } };

/* ---------- visitors yesterday (GoatCounter) ---------- */
async function getVisitors(fetchFn, cfg, now) {
  const today = melbourneToday(now);
  const day = addDays(today, -1);
  if (!cfg.gcCode || !cfg.gcToken) return { ok: false, day, reason: 'GOATCOUNTER_CODE or GOATCOUNTER_TOKEN is not set' };
  const base = `https://${encodeURIComponent(cfg.gcCode)}.goatcounter.com/api/v0`;
  // Whole Melbourne day: midnight to 23:59:59, sent as UTC times.
  const range = `start=${encodeURIComponent(melMidnight(day).toISOString())}&end=${encodeURIComponent(new Date(melMidnight(today).getTime() - 1000).toISOString())}`;
  const headers = { Authorization: `Bearer ${cfg.gcToken}`, Accept: 'application/json' };
  const [total, hits] = await Promise.all([
    timed(fetchFn, `${base}/stats/total?${range}`, { headers }),
    timed(fetchFn, `${base}/stats/hits?${range}&limit=100`, { headers })
  ]);
  const t = parseJSON(total.text), h = parseJSON(hits.text);
  if (total.status !== 200 || hits.status !== 200 || !t || typeof t.total !== 'number' || !h || !Array.isArray(h.hits)) {
    return { ok: false, day, reason: `GoatCounter API returned HTTP ${total.status || 'no response'} / ${hits.status || 'no response'}` };
  }
  const pages = h.hits.filter((x) => !x.event).map((x) => ({ path: x.path, count: x.count || 0 })).sort((a, b) => b.count - a.count);
  return {
    ok: true, day,
    visitors: t.total - (t.total_events || 0),
    pageviews: pages.reduce((n, p) => n + p.count, 0),
    top: pages.slice(0, 5)
  };
}

/* ---------- health ---------- */
async function pool(items, size, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
async function getHealth(fetchFn, cfg) {
  const site = [], supabase = [];
  // Website: every page listed in sitemap.xml, fetched from SITE_URL.
  const sm = await timed(fetchFn, `${cfg.site}/sitemap.xml`);
  const locs = sm.status === 200 ? [...sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]) : [];
  if (sm.status !== 200 || !locs.length) {
    site.push({ ok: false, name: '/sitemap.xml', status: sm.status, ms: sm.ms, detail: sm.error || (sm.status === 200 ? 'no pages listed' : '') });
  } else {
    const paths = [...new Set(locs.map((l) => { try { const u = new URL(l); return u.pathname + u.search; } catch (e) { return null; } }).filter(Boolean))];
    site.push(...await pool(paths, 4, async (p) => {
      const r = await timed(fetchFn, cfg.site + p);
      return { ok: r.status === 200, name: p, status: r.status, ms: r.ms, detail: r.error || (r.status !== 200 ? 'expected 200' : (r.ms > SLOW_MS ? 'slow' : '')) };
    }));
  }

  // Supabase, with the public key only.
  try { assertPublicKey(cfg.sbKey); } catch (e) {
    supabase.push({ ok: false, name: 'Public key', status: 0, ms: 0, detail: e.message });
    return { site, supabase };
  }
  const H = { headers: { apikey: cfg.sbKey, Accept: 'application/json' } };
  const rest = (q) => timed(fetchFn, `${cfg.sbUrl}/rest/v1/${q}`, H);
  const [ev, auth, gal, privE, privC] = await Promise.all([
    rest('events?select=id&deleted_at=is.null&limit=1'),
    timed(fetchFn, `${cfg.sbUrl}/auth/v1/health`, H),
    rest('gallery?select=image_path&deleted_at=is.null&order=sort.asc&limit=1'),
    rest('events?select=updated_by&limit=1'),
    rest('campuses?select=updated_by&limit=1')
  ]);
  const listOk = (r) => r.status === 200 && Array.isArray(parseJSON(r.text));
  supabase.push({ ok: listOk(ev), name: 'Events read (REST)', status: ev.status, ms: ev.ms, detail: ev.error || (listOk(ev) ? '' : 'expected HTTP 200 with a list') });
  supabase.push({ ok: auth.status === 200, name: 'Auth health', status: auth.status, ms: auth.ms, detail: auth.error || '' });
  supabase.push({ ok: listOk(gal), name: 'Gallery read (REST)', status: gal.status, ms: gal.ms, detail: gal.error || (listOk(gal) ? '' : 'expected HTTP 200 with a list') });
  const first = listOk(gal) && parseJSON(gal.text)[0];
  if (first && first.image_path) {
    const img = await timed(fetchFn, `${cfg.sbUrl}/storage/v1/object/public/gallery/${first.image_path.split('/').map(encodeURIComponent).join('/')}`);
    supabase.push({ ok: img.status === 200, name: 'Gallery photo file (Storage)', status: img.status, ms: img.ms, detail: img.error || '' });
  }
  // Privacy: visitors must NOT be able to read the editor email column.
  for (const [table, r] of [['events', privE], ['campuses', privC]]) {
    const j = parseJSON(r.text);
    const denied = (r.status === 401 || r.status === 403) && j && j.code === '42501';
    supabase.push({
      ok: denied, name: `Editor emails hidden from visitors (${table})`, status: r.status, ms: r.ms,
      detail: denied ? '' : r.status === 200 ? 'READABLE by visitors: run supabase/hide-editor-emails.sql' : (r.error || 'could not check')
    });
  }
  return { site, supabase };
}

/* ---------- email text ---------- */
// An event that is not at a campus (special events) is described by its location instead
const notAtCampus = (e) => Array.isArray(e.campuses) && !e.campuses.length && !!e.location;
function placeText(e) { return [e.location, e.location_address].filter(Boolean).join(', '); }
function campusText(list, names) {
  const c = Array.isArray(list) && list.length ? list : ['all'];
  if (c.indexOf('all') > -1) return 'All campuses';
  return c.map((s) => names[s] || CAMPUS_NAMES[s] || s).join(', ');
}
// Status: Cancelled = type Cancellation, optionally combined_with another campus.
// (Before supabase/status-cleanup.sql, a combined service was a Service change with combined_with set.)
const isCombined = (e) => !!e.combined_with && (e.type === 'Cancellation' || e.type === 'Service change');
function statusLabel(e) { return e.type === 'Cancellation' || isCombined(e) ? 'CANCELLED' : ''; }
/* Same rule as the website (main.js): on a Sunday, a cancellation combined with another campus, or a
   cancelled "Sunday service", replaces the service of each campus it lists. Those campuses' own Sunday
   service rows are left out, and the line says
   "- Sun 22 Nov | CANCELLED: Melton and Mernda Sunday Service. Combined with Tarneit, 4:30pm". */
const isService = (e) => /^sunday service$/i.test(String(e.title || '').trim());
const isSundayIso = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;
const campusesOf = (e) => (Array.isArray(e.campuses) && e.campuses.length ? e.campuses : ['all']);
const covers = (e, slug) => campusesOf(e).includes('all') || campusesOf(e).includes(slug);
const andList = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
function replaces(e) { return isSundayIso(e.date) && (isCombined(e) || (e.type === 'Cancellation' && isService(e))); }
// A guest speaker: a Sunday service with a "with Ps …" note (older data: type Service change)
const isGuest = (e) => isService(e) && !isCombined(e) && (e.type === 'Sunday service' || e.type === 'Service change') && /^with\b/i.test(String(e.note || '').trim());
function isReplaced(e, all) {
  if (!isService(e) || replaces(e) || statusLabel(e) || !isSundayIso(e.date)) return false;
  const reps = all.filter((o) => o.date === e.date && replaces(o));
  return campusesOf(e).every((c) => reps.some((o) => (c === 'all' ? campusesOf(o).includes('all') : covers(o, c))));
}
function joinTime(e, all, times) {
  const row = all.find((o) => o.date === e.date && isService(o) && !replaces(o) && !statusLabel(o) && covers(o, e.combined_with) && !isReplaced(o, all));
  return (row && row.time) || times[e.combined_with] || '';
}
function extraNote(e, names) {
  const n = String(e.note || '').trim();
  if (!n || !e.combined_with) return n;
  const at = (names[e.combined_with] || CAMPUS_NAMES[e.combined_with] || e.combined_with).toLowerCase();
  const low = n.toLowerCase().replace(/[.!]+$/, '');
  return low.startsWith(`combined service at ${at}`) || low.startsWith(`join us at ${at}`) ? '' : n; // the old automatic note
}
function eventLine(e, names, all = [], times = {}) {
  const status = statusLabel(e);
  const name = (s) => (s === 'all' ? 'any campus' : names[s] || CAMPUS_NAMES[s] || s);
  if (status && replaces(e)) {
    // e.g. "- Sun 22 Nov | CANCELLED: Melton and Mernda Sunday Service. Combined with Tarneit, 4:30pm"
    //      and the editor's note underneath (a plain cancellation ends after "Sunday Service.")
    const what = campusesOf(e).includes('all') ? 'All campuses' : andList(campusesOf(e).map(name));
    let out = `- ${shortDate(e.date)} | ${status}: ${what} ${isService(e) ? 'Sunday Service' : titleCase(e.title)}.`;
    if (isCombined(e)) { const t = joinTime(e, all, times); out += ` Combined with ${name(e.combined_with)}${t ? `, ${t}` : ''}`; }
    const extra = extraNote(e, names);
    if (extra) out += `
  ${extra}`;
    return out;
  }
  if (status) {
    // e.g. "- CANCELLED: Prayer Meeting | Fri 20 Nov | 7pm | Noble Park" and the note underneath
    let out = `- ${status}: ${[titleCase(e.title), shortDate(e.date), e.time, notAtCampus(e) ? placeText(e) : campusText(e.campuses, names)].filter(Boolean).join(' | ')}`;
    if (e.note) out += `
  ${e.note}`;
    return out;
  }
  let out = `- ${[shortDate(e.date), e.time || 'time not set', campusText(e.campuses, names), e.type].join(' | ')}\n  ${titleCase(e.title)}`;
  if (e.note) out += ` (${e.note})`;
  return out;
}
const LABELS = { title: 'title', type: 'type', date: 'date', time: 'time', campuses: 'campus', note: 'note', name: 'name', sunday_time: 'Sunday time',
  venue: 'venue', address: 'address', transport_note: 'transport note', language: 'language', map_url: 'map link', alt: 'description', caption: 'caption', combined_with: 'combined with',
  location: 'location', location_address: 'location address', location_url: 'location link' };
function showValue(field, v, names) {
  if (field === 'campuses') return campusText(v, names);
  if (field === 'combined_with') return v ? campusText([v], names) : '(none)';
  if (field === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return shortDate(v);
  return v === '' || v == null ? '(none)' : `"${v}"`;
}
function fieldText(fields, names) {
  return fields.map((f) => `${LABELS[f.field] || f.field} ${showValue(f.field, f.before, names)} → ${showValue(f.field, f.after, names)}`).join('; ');
}
const eventName = (e, names) => `${titleCase(e.title)}, ${e.date ? shortDate(String(e.date).slice(0, 10)) : ''}, ${notAtCampus(e) ? e.location : campusText(e.campuses, names)}`;
const photoName = (g, names) => `"${g.alt}" (${campusText(g.campuses, names)})`;

function changesSection(report, names) {
  const out = ['CHANGES IN THE LAST 24 HOURS'];
  const c = report.changes;
  if (!c || c.firstBackup) out.push('Events: this is the first backup, so there is nothing to compare with yet.');
  else {
    const total = c.added + c.changed + c.removed;
    out.push(total ? `Events: ${c.added} added, ${c.changed} changed, ${c.removed} removed since yesterday's backup.`
      : "Events: none added, changed or removed since yesterday's backup.");
    const d = c.details || { added: [], changed: [], removed: [] };
    d.added.forEach((e) => out.push(`- Added: ${eventName(e, names)} (${e.type})${e.time ? ', ' + e.time : ''}`));
    d.changed.forEach((x) => out.push(`- Changed: ${eventName(x.event, names)}: ${fieldText(x.fields, names)}`));
    d.removed.forEach((e) => out.push(`- Removed: ${eventName(e, names)}`));
  }
  const cc = report.campusChanges;
  if (!cc || cc.firstBackup) out.push('Service times: first backup, nothing to compare with yet.');
  else if (!cc.changed.length && !cc.added.length && !cc.removed.length) out.push('Service times: no changes.');
  else {
    out.push('Service times:');
    cc.changed.forEach((x) => out.push(`- ${x.campus.name}: ${fieldText(x.fields, names)}`));
    cc.added.forEach((x) => out.push(`- Added campus: ${x.name}`));
    cc.removed.forEach((x) => out.push(`- Removed campus: ${x.name}`));
  }
  const g = report.galleryChanges;
  if (!g || g.firstBackup) out.push('Gallery: first backup, nothing to compare with yet.');
  else if (!g.added.length && !g.changed.length && !g.removed.length && !g.reordered) out.push('Gallery: no changes.');
  else {
    out.push('Gallery:');
    g.added.forEach((p) => out.push(`- Added photo: ${photoName(p, names)}`));
    g.changed.forEach((x) => out.push(`- Changed photo ${photoName(x.photo, names)}: ${fieldText(x.fields, names)}`));
    g.removed.forEach((p) => out.push(`- Removed photo: ${photoName(p, names)}`));
    if (g.reordered) out.push('- The order of the photos was changed.');
  }
  return out;
}

function visitorsSection(v) {
  const out = [`VISITORS YESTERDAY (${longDate(v.day)})`];
  if (!v.ok) { out.push('Visitor stats unavailable.'); return out; }
  out.push(`Visits: ${v.visitors}`, `Pageviews: ${v.pageviews}`);
  if (v.top.length) {
    out.push('Top pages:');
    const w = Math.max(...v.top.map((p) => p.path.length));
    v.top.forEach((p, i) => out.push(`  ${i + 1}. ${p.path.padEnd(w)}  ${p.count}`));
  } else out.push('No pages were visited.');
  out.push('(GoatCounter counts each visitor once per page per day, so pageviews here are pages seen by different visitors.)');
  return out;
}

function healthLine(c) {
  return `${(c.ok ? 'OK' : 'PROBLEM').padEnd(8)} ${String(c.status || '---').padEnd(4)} ${secs(c.ms).padStart(7)}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`;
}
function healthSection(h, cfg) {
  const out = ['HEALTH', `Website (${cfg.site}, every page in sitemap.xml):`];
  h.site.forEach((c) => out.push('  ' + healthLine(c)));
  out.push('Supabase (public key only):');
  h.supabase.forEach((c) => out.push('  ' + healthLine(c)));
  return out;
}

function buildEmail({ report, visitors, health, now, env }) {
  const cfg = config(env || {});
  const today = melbourneToday(now);
  const readOk = !!report && report.ok === true;
  const names = {};
  ((report && report.campuses) || []).forEach((c) => { if (c && c.slug) names[c.slug] = c.name; });

  const problems = [];
  if (!readOk) {
    const st = report && report.status ? `HTTP ${report.status}` : 'no response (HTTP status unknown)';
    problems.push(`The Supabase read failed${report && report.table ? ` (${report.table})` : ''}: ${st}. No backup was made today; the website shows the last backed-up events.`);
  }
  [...health.site, ...health.supabase].filter((c) => !c.ok).forEach((c) => problems.push(`${c.name}: HTTP ${c.status || 'no response'}${c.detail ? ', ' + c.detail : ''}`));

  const out = [`TCF website: daily summary for ${longDate(today)}`, ''];
  if (problems.length) {
    out.push('PROBLEMS FOUND');
    problems.forEach((p) => out.push(`- ${p}`));
    if (!readOk && report && report.error) out.push(`  Details: ${report.error}`);
    out.push('');
  }

  if (readOk) {
    const soonEnd = addDays(today, SOON_DAYS - 1);
    const upcoming = (report.events || []).filter((e) => e && e.date >= today)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : minutes(a.time) - minutes(b.time)));
    if (!upcoming.length) out.push('There are no upcoming events on the website.', '');
    else {
      const times = {};
      ((report && report.campuses) || []).forEach((c) => { if (c && c.slug && c.sunday_time) times[c.slug] = String(c.sunday_time).trim(); });
      // Guest speakers get their own short list; a service replaced by a cancellation that day is left out
      const soon = upcoming.filter((e) => (statusLabel(e) || e.type === 'Service change') && !isGuest(e) && e.date <= soonEnd && !isReplaced(e, upcoming));
      const guests = [];
      upcoming.filter((e) => isGuest(e) && e.date <= soonEnd && !isReplaced(e, upcoming)).forEach((e) => {
        const same = guests.find((g) => g.date === e.date && g.note === String(e.note).trim());
        if (same) same.campuses.push(...campusesOf(e)); else guests.push({ date: e.date, note: String(e.note).trim(), campuses: [...campusesOf(e)] });
      });
      const meetings = upcoming.filter((e) => e.type === 'Prayer' || e.type === 'Meeting');
      out.push(`CANCELLATIONS AND SERVICE CHANGES IN THE NEXT ${SOON_DAYS} DAYS`, soon.length ? soon.map((e) => eventLine(e, names, upcoming, times)).join('\n') : 'None.', '');
      // e.g. "- Sun 22 Nov | Mernda, Sunshine | with Ps Pitchaiah (Guest Speaker, India)"
      if (guests.length) out.push(`GUEST SPEAKERS IN THE NEXT ${SOON_DAYS} DAYS`, guests.map((g) => `- ${shortDate(g.date)} | ${campusText(g.campuses, names)} | ${g.note}`).join('\n'), '');
      // e.g. "- Sat 5 Dec | 4pm | Christmas Night | TCF Ministries, Keilor East VIC"
      const specialEnd = addDays(today, SPECIAL_DAYS - 1);
      const specials = upcoming.filter((e) => e.type === 'Special event' && e.date <= specialEnd);
      out.push(`SPECIAL EVENTS IN THE NEXT ${SPECIAL_DAYS} DAYS`, specials.length
        ? specials.map((e) => `- ${[shortDate(e.date), e.time || 'time not set', titleCase(e.title), placeText(e) || campusText(e.campuses, names)].join(' | ')}${e.note ? `\n  ${e.note}` : ''}`).join('\n')
        : 'None.', '');
      out.push('UPCOMING PRAYER MEETINGS AND MEETINGS', meetings.length ? meetings.map((e) => eventLine(e, names, upcoming, times)).join('\n') : 'None.', '');
    }
    out.push(...changesSection(report, names), '');
  } else {
    out.push('Events could not be read today, so there is no event list or change list in this email.', '',
      'What to check:',
      '- Is the Supabase project paused? Open the Supabase dashboard and restore it.',
      '- Are the repository variables SUPABASE_URL and SUPABASE_ANON_KEY still correct?',
      '- Re-run the workflow from the Actions tab once it is fixed.', '');
  }
  out.push(...visitorsSection(visitors), '');
  out.push(...healthSection(health, cfg), '');
  out.push(`To add or change events, open the admin page: ${cfg.admin}`, '');
  out.push('--', 'Sent automatically each morning by the "Supabase daily" GitHub Actions workflow.',
    'It also backs up the events into data/ and keeps the database awake.');

  const base = readOk ? `TCF website: events summary, ${longDate(today)}` : `TCF website: Supabase read failed, ${longDate(today)}`;
  return { subject: problems.length ? `PROBLEM: ${base}` : base, text: out.join('\n') + '\n', problems };
}

/* ---------- sending ---------- */
// NOTIFY_EMAIL: one or more plain addresses, separated by commas or semicolons, e.g.
// "media@tcfmelbourne.org; pastor@example.org, someone@example.org". Spaces and empty items are ignored.
const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
function parseRecipients(value) {
  const list = String(value == null ? '' : value).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  // Report positions, not the addresses: the Actions log may be public
  const bad = list.map((x, i) => (EMAIL_RE.test(x) ? 0 : i + 1)).filter(Boolean);
  if (!list.length) throw new Error('NOTIFY_EMAIL has no email addresses.');
  if (bad.length) throw new Error(`NOTIFY_EMAIL: ${bad.length === 1 ? 'address' : 'addresses'} ${bad.join(', ')} of ${list.length} ${bad.length === 1 ? 'is' : 'are'} not a valid email address. Use plain addresses separated by commas or semicolons.`);
  return list;
}
// Up to three recipients all go in "To". With more, only the first is visible in "To" and the rest are BCC.
function recipientFields(list) {
  return list.length > 3 ? { to: list[0], bcc: list.slice(1) } : { to: list.slice() };
}

// createTransport can be replaced in tests (no real email is sent)
async function send(mail, env, createTransport) {
  const need = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'NOTIFY_EMAIL', 'SMTP_FROM'];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Email is not set up. Missing: ${missing.join(', ')}`); // names only, never values
  const recipients = parseRecipients(env.NOTIFY_EMAIL); // checked before connecting to the mail server
  const port = Number(env.SMTP_PORT);
  const transport = (createTransport || require('nodemailer').createTransport)({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,  // 465 = TLS from the start; 587 = STARTTLS (required below)
    requireTLS: port !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    logger: false, debug: false
  });
  // One email for everyone
  await transport.sendMail(Object.assign({ from: env.SMTP_FROM }, recipientFields(recipients), { subject: mail.subject, text: mail.text }));
  return recipients.length;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outFile = outIdx > -1 ? args[outIdx + 1] : null;
  const dry = args.includes('--dry-run') || !!outFile;
  const env = process.env;
  let report = null;
  try { report = JSON.parse(fs.readFileSync(env.REPORT_FILE || 'report.json', 'utf8')); } catch (e) { /* missing = failed read */ }
  const cfg = config(env);
  const [visitors, health] = await Promise.all([
    getVisitors(fetch, cfg).catch(() => ({ ok: false, day: addDays(melbourneToday(), -1) })),
    getHealth(fetch, cfg)
  ]);
  if (!visitors.ok) console.log('Visitor stats unavailable:', visitors.reason || 'error');
  const mail = buildEmail({ report, visitors, health, env });
  const full = `Subject: ${mail.subject}\n\n${mail.text}`;
  if (outFile) { fs.writeFileSync(outFile, full); console.log(`Email saved to ${outFile} (not sent).`); }
  else if (dry) console.log(full);
  else { const n = await send(mail, env); console.log(`Email sent to ${n} ${n === 1 ? 'address' : 'addresses'}: ${mail.subject}`); }
  if (mail.problems.length) {
    console.error(`${mail.problems.length} problem(s) found, so this run is marked as failed:`);
    mail.problems.forEach((p) => console.error('- ' + p));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    // nodemailer errors can echo the server's reply but never the password; print only the message.
    console.error('Sending the email failed:', err && err.message);
    process.exit(1);
  });
}

module.exports = { buildEmail, getVisitors, getHealth, melbourneToday, melMidnight, minutes, config, parseRecipients, recipientFields, send };
