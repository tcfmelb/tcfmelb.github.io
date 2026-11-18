#!/usr/bin/env node
/* Offline tests for the daily backup + email logic. Uses a fake network: sends no email, makes no
   requests and changes no files (except the optional sample email file).
     node scripts/test-daily-summary.js                    # tests, then prints the sample email
     node scripts/test-daily-summary.js --out email.txt    # tests, and saves the sample email
     node scripts/test-daily-summary.js --quiet            # tests only */
'use strict';
const assert = require('assert');
const fs = require('fs');
const { diffEvents, diffCampuses, diffGallery, toEventBackup, toCampusBackup, toGalleryBackup, assertPublicKey } = require('./export-events');
const { buildEmail, getVisitors, getHealth, melbourneToday, melMidnight, minutes, config, parseRecipients, recipientFields, send } = require('./daily-summary');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

// 21:00 UTC on 18 Nov = 8am on Thursday 19 Nov in Melbourne (daylight saving).
const NOW = new Date('2026-11-18T21:00:00Z');
const ENV = { SITE_URL: 'https://tcfmelbourne.org', GOATCOUNTER_CODE: 'tcfmelbourne', GOATCOUNTER_TOKEN: 'test-token-not-real' };
const CFG = config(ENV);

/* ---------- sample data ---------- */
const campuses = [
  { slug: 'melton', name: 'Melton', sunday_time: '9:30am', venue: 'Melton Seniors Community Centre', updated_by: 'someone@example.org' },
  { slug: 'tarneit', name: 'Tarneit', sunday_time: '4:30pm' }, { slug: 'sunshine', name: 'Sunshine', sunday_time: '4pm' },
  { slug: 'mernda', name: 'Mernda', sunday_time: '10am' }, { slug: 'noble-park', name: 'Noble Park', sunday_time: '2pm' }
].map(toCampusBackup);
const ev = (id, date, time, type, title, camp, note, combinedWith) =>
  toEventBackup({ id, date, time, type, title, campuses: camp, note, combined_with: combinedWith, updated_at: '2026-11-18T01:00:00Z' });
const special = (id, date, time, title, location, address, note) =>
  toEventBackup({ id, date, time, type: 'Special event', title, campuses: [], note, location, location_address: address, updated_at: '2026-11-18T01:00:00Z' });
const events = [
  ev('a', '2026-11-12', '7pm', 'Prayer', 'Prayer meeting', ['all']),                       // past: left out
  ev('b', '2026-11-22', '4:30pm', 'Cancellation', 'Sunday service', ['tarneit'], 'Join us at Sunshine instead'),
  // Guest speakers: a Sunday service with a "with …" note, and an older one still stored as Service change
  ev('c', '2026-11-22', '10am', 'Sunday service', 'Sunday service', ['mernda'], 'with Ps Jenistan (Guest Speaker – France)'),
  ev('c2', '2026-11-22', '5pm', 'Service change', 'Sunday service', ['noble-park'], 'with Ps Jenistan (Guest Speaker – France)'),
  // A real service change (time)
  ev('m', '2026-11-22', '3pm', 'Service change', 'Sunday service', ['sunshine'], 'Earlier this week only'),
  ev('d', '2026-11-20', '7pm', 'Prayer', 'Prayer meeting', ['all']),
  ev('e', '2026-11-21', 'from 6:30pm', 'Meeting', 'Youth night', ['sunshine', 'melton']),
  ev('f', '2026-12-06', '9:30am', 'Cancellation', 'Sunday service', ['melton']),           // beyond 14 days
  ev('g', '2026-11-27', '', 'Meeting', 'Leaders meeting', ['noble-park']),
  // Cancelled and combined: Melton joins Sunshine (new), Mernda joins Tarneit (older Service change + combined_with)
  ev('i', '2026-11-29', null, 'Cancellation', 'Sunday service', ['melton'], 'Combined service at Sunshine, 4pm', 'sunshine'),
  ev('n', '2026-11-29', '4:30pm', 'Service change', 'Sunday service', ['mernda'], 'Bring a plate', 'tarneit'),
  // Regular Sunday services (one with a note): never listed as meetings
  ev('j', '2026-11-22', '4pm', 'Sunday service', 'Sunday service', ['sunshine']),
  ev('k', '2026-11-29', '4pm', 'Sunday service', 'Sunday service', ['sunshine'], 'Conducted by Youth / Sunday School Seniors'),
  // Melton joins Sunshine on 29 Nov, so its own guest-speaker row that day is replaced (left out)
  ev('l', '2026-11-29', '9:30am', 'Service change', 'Sunday service', ['melton'], 'with Ps Hidden (Guest Speaker)'),
  // Special events (not at a campus): within 30 days, and one beyond
  special('sp1', '2026-12-05', '4pm', 'Christmas Night', 'TCF Ministries', 'Keilor East VIC', 'Kids program. All welcome.'),
  special('sp2', '2027-01-20', '10am', 'Youth camp', 'Camp Manyung', 'Mount Martha VIC')
];
const photo = (id, alt, camp, sort) => toGalleryBackup({ id, image_path: `photos/2026/${id}.jpg`, alt, caption: '', campuses: camp, sort, created_at: '2026-11-01T00:00:00Z' });
const gallery = [photo('p1', 'Worship at Sunshine', ['sunshine'], 10), photo('p2', 'Christmas lunch', ['all'], 20), photo('p3', 'Youth camp', ['melton'], 30)];

/* ---------- fake network ---------- */
const SITEMAP = `<?xml version="1.0"?><urlset><url><loc>https://tcfmelbourne.org/</loc></url><url><loc>https://tcfmelbourne.org/events/</loc></url>
  <url><loc>https://tcfmelbourne.org/gallery/</loc></url><url><loc>https://tcfmelbourne.org/melton/</loc></url></urlset>`;
function fakeFetch(overrides) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, headers: (opts && opts.headers) || {} });
    const reply = (status, body) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    for (const [match, r] of Object.entries(overrides || {})) if (url.includes(match)) { if (r === 'timeout') throw Object.assign(new Error('t'), { name: 'TimeoutError' }); return reply(r[0], r[1]); }
    if (url.endsWith('/sitemap.xml')) return reply(200, SITEMAP);
    if (url.startsWith('https://tcfmelbourne.org/')) return reply(200, '<html></html>');
    if (url.includes('goatcounter.com/api/v0/stats/total')) return reply(200, { total: 48, total_events: 0, total_utc: 47 });
    if (url.includes('goatcounter.com/api/v0/stats/hits')) return reply(200, { more: false, hits: [
      { path: '/', count: 31 }, { path: '/events/', count: 14 }, { path: '/melton/', count: 9 }, { path: '/give/', count: 4 },
      { path: '/gallery/', count: 6 }, { path: '/contact/', count: 2 }, { path: 'click-give', count: 3, event: true }] });
    if (url.includes('/rest/v1/events?select=updated_by') || url.includes('/rest/v1/campuses?select=updated_by'))
      return reply(401, { code: '42501', message: 'permission denied for table events' });
    if (url.includes('/rest/v1/events')) return reply(200, [{ id: 'b' }]);
    if (url.includes('/rest/v1/gallery')) return reply(200, [{ image_path: 'photos/2026/p1.jpg' }]);
    if (url.includes('/auth/v1/health')) return reply(200, { name: 'GoTrue' });
    if (url.includes('/storage/v1/object/public/gallery/')) return reply(200, 'jpeg');
    return reply(404, 'not found');
  };
  fn.calls = calls;
  return fn;
}

/* ---------- dates ---------- */
test('Melbourne date is used, not UTC', () => {
  assert.strictEqual(melbourneToday(NOW), '2026-11-19');
  assert.strictEqual(melbourneToday(new Date('2026-06-30T21:00:00Z')), '2026-07-01'); // AEST, 7am
});
test('Melbourne midnight in UTC, including daylight-saving change days', () => {
  assert.strictEqual(melMidnight('2026-11-18').toISOString(), '2026-11-17T13:00:00.000Z'); // AEDT +11
  assert.strictEqual(melMidnight('2026-07-01').toISOString(), '2026-06-30T14:00:00.000Z'); // AEST +10
  assert.strictEqual(melMidnight('2026-10-04').toISOString(), '2026-10-03T14:00:00.000Z'); // DST starts 2am that day
  assert.strictEqual(melMidnight('2026-04-05').toISOString(), '2026-04-04T13:00:00.000Z'); // DST ends 3am that day
});
test('times sort sensibly', () => {
  assert.ok(minutes('9:30am') < minutes('10am') && minutes('10am') < minutes('from 6:30pm'));
  assert.strictEqual(minutes('12pm'), 720); assert.strictEqual(minutes('12am'), 0); assert.strictEqual(minutes(''), 1440);
});

/* ---------- keys and privacy ---------- */
test('public key check refuses secret and service-role keys', () => {
  assert.throws(() => assertPublicKey('sb_secret_abc'));
  const jwt = (role) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.sig';
  assert.throws(() => assertPublicKey(jwt('service_role')));
  assert.doesNotThrow(() => assertPublicKey(jwt('anon')));
  assert.doesNotThrow(() => assertPublicKey('sb_publishable_abc'));
});
test('backup never stores editors’ emails', () => {
  assert.ok(!('updated_by' in campuses[0]));
  assert.ok(!('updated_by' in toEventBackup({ id: 'x', title: 't', type: 'Prayer', date: '2026-01-01', updated_by: 'a@b.c' })));
});

/* ---------- change detection ---------- */
test('events: nothing changed', () => {
  const d = diffEvents(events, events.map((e) => Object.assign({}, e)));
  assert.deepStrictEqual([d.added, d.changed, d.removed, d.firstBackup], [0, 0, 0, false]);
});
test('events: added, changed (with field details), removed', () => {
  const next = events.filter((e) => e.id !== 'g').map((e) => Object.assign({}, e));
  next.find((e) => e.id === 'd').time = '7:30pm';
  next.find((e) => e.id === 'e').campuses = ['sunshine'];
  next.push(ev('h', '2026-11-29', '7pm', 'Prayer', 'Prayer meeting', ['all']));
  const d = diffEvents(events, next);
  assert.deepStrictEqual([d.added, d.changed, d.removed], [1, 2, 1]);
  assert.deepStrictEqual(d.details.changed.find((x) => x.event.id === 'd').fields, [{ field: 'time', before: '7pm', after: '7:30pm' }]);
  assert.strictEqual(d.details.removed[0].id, 'g');
});
test('titleCase (the shared rule in main.js)', () => {
  const { titleCase } = require('../main.js');
  const cases = {
    'Sunday service': 'Sunday Service', 'prayer meeting': 'Prayer Meeting', 'Youth meeting': 'Youth Meeting',
    'prayer and fasting at the church': 'Prayer and Fasting at the Church', 'Prayer And Fasting': 'Prayer and Fasting',
    'a night of worship': 'A Night of Worship', "What's on": "What's On", 'TCF christmas night': 'TCF Christmas Night',
    'ACC youth camp': 'ACC Youth Camp', 'fellowship at noble park': 'Fellowship at Noble Park',
    'Sunday Service with Ps Pitchaiah': 'Sunday Service with Ps Pitchaiah', 'worship (guest speaker)': 'Worship (Guest Speaker)',
    'Christmas night – the party': 'Christmas Night – The Party', 'iPad giveaway': 'iPad Giveaway', 'Visit us at 9:30am': 'Visit Us at 9:30am'
  };
  for (const [from, to] of Object.entries(cases)) assert.strictEqual(titleCase(from), to, from);
  assert.strictEqual(titleCase(titleCase('a night of worship')), 'A Night of Worship', 'running it twice changes nothing');
});
test('events: combined_with counts as a change', () => {
  const next = events.map((e) => Object.assign({}, e));
  next.find((e) => e.id === 'i').combined_with = 'tarneit';
  const d = diffEvents(events, next);
  assert.deepStrictEqual(d.details.changed[0].fields, [{ field: 'combined_with', before: 'sunshine', after: 'tarneit' }]);
});
test('events: updated_at alone is not a change', () => {
  assert.strictEqual(diffEvents(events, events.map((e) => Object.assign({}, e, { updated_at: '2026-11-19T00:00:00Z' }))).changed, 0);
});
test('events: first backup from the old file format matches by date + title + campus', () => {
  const legacy = [
    { title: 'Sunday service', date: '2026-11-22', time: '4:30pm', campuses: ['tarneit'], description: 'Join us at Sunshine instead', cancelled: true },
    { title: 'Prayer meeting', date: '2026-11-20', time: '7pm', campuses: ['all'], description: '', cancelled: false },
    { title: 'Old event', date: '2026-10-01', time: '7pm', campuses: ['all'], description: '', cancelled: false }
  ];
  const byId = (id) => events.find((e) => e.id === id);
  const d = diffEvents(legacy, [byId('b'), byId('d'), ev('z', '2026-11-30', '7pm', 'Meeting', 'New', ['all'])]);
  assert.deepStrictEqual([d.added, d.changed, d.removed], [1, 0, 1]);
  assert.strictEqual(diffEvents(null, events).firstBackup, true);
});
test('campuses: field-level changes; first backup', () => {
  const next = campuses.map((c) => Object.assign({}, c));
  next[0].sunday_time = '9:45am';
  const d = diffCampuses(campuses, next);
  assert.deepStrictEqual(d.changed.map((x) => [x.campus.slug, x.fields]), [['melton', [{ field: 'sunday_time', before: '9:30am', after: '9:45am' }]]]);
  assert.strictEqual(diffCampuses(null, next).firstBackup, true);
});
test('gallery: added, changed, removed, reordered', () => {
  const next = [Object.assign({}, gallery[1], { sort: 10 }), Object.assign({}, gallery[0], { sort: 20, caption: 'Sunday worship' }), photo('p4', 'Baptism service', ['mernda'], 30)];
  const d = diffGallery(gallery, next);
  assert.deepStrictEqual([d.added.length, d.changed.length, d.removed.length, d.reordered], [1, 1, 1, true]);
  assert.strictEqual(diffGallery(gallery, gallery).reordered, false);
  assert.strictEqual(diffGallery(null, gallery).firstBackup, true);
});

/* ---------- visitors ---------- */
test('GoatCounter: yesterday in Melbourne time, token sent, top 5 pages, events excluded', async () => {
  const f = fakeFetch();
  const v = await getVisitors(f, CFG, NOW);
  const call = f.calls.find((c) => c.url.includes('/stats/total'));
  assert.ok(call.url.startsWith('https://tcfmelbourne.goatcounter.com/api/v0/stats/total?'));
  assert.ok(call.url.includes('start=2026-11-17T13%3A00%3A00.000Z') && call.url.includes('end=2026-11-18T12%3A59%3A59.000Z'), call.url);
  assert.strictEqual(call.headers.Authorization, 'Bearer test-token-not-real');
  assert.deepStrictEqual([v.ok, v.day, v.visitors, v.pageviews], [true, '2026-11-18', 48, 66]);
  assert.deepStrictEqual(v.top.map((p) => p.path), ['/', '/events/', '/melton/', '/gallery/', '/give/']);
});
test('GoatCounter failure or missing token -> unavailable, not a problem', async () => {
  assert.strictEqual((await getVisitors(fakeFetch({ '/stats/total': [500, 'oops'] }), CFG, NOW)).ok, false);
  assert.strictEqual((await getVisitors(fakeFetch(), config({}), NOW)).ok, false);
  const health = await getHealth(fakeFetch(), CFG);
  const mail = buildEmail({ report: { ok: true, events, campuses }, visitors: { ok: false, day: '2026-11-18' }, health, now: NOW, env: ENV });
  assert.ok(mail.text.includes('Visitor stats unavailable.'));
  assert.ok(!mail.subject.startsWith('PROBLEM'));
});

/* ---------- health ---------- */
test('health: every sitemap page checked at SITE_URL; Supabase checks with the public key', async () => {
  const f = fakeFetch();
  const h = await getHealth(f, config({ SITE_URL: 'https://staging.example.org/' }));
  assert.deepStrictEqual(h.site.map((c) => c.name), ['/', '/events/', '/gallery/', '/melton/']);
  assert.ok(f.calls.some((c) => c.url === 'https://staging.example.org/events/'), 'pages fetched from SITE_URL');
  assert.deepStrictEqual(h.supabase.map((c) => [c.name, c.ok]), [
    ['Events read (REST)', true], ['Auth health', true], ['Gallery read (REST)', true], ['Gallery photo file (Storage)', true],
    ['Editor emails hidden from visitors (events)', true], ['Editor emails hidden from visitors (campuses)', true]]);
  assert.ok(f.calls.filter((c) => c.url.includes('supabase.co')).every((c) => /^sb_publishable_/.test(c.headers.apikey || '') || c.url.includes('/storage/')));
});
test('health: a broken page, a timeout and readable editor emails make a PROBLEM', async () => {
  const f = fakeFetch({ 'tcfmelbourne.org/gallery/': [404, 'nope'], '/auth/v1/health': 'timeout', 'events?select=updated_by': [200, [{ updated_by: 'x' }]] });
  const health = await getHealth(f, CFG);
  const mail = buildEmail({ report: { ok: true, events, campuses }, visitors: { ok: false, day: '2026-11-18' }, health, now: NOW, env: ENV });
  assert.ok(mail.subject.startsWith('PROBLEM: TCF website: events summary'));
  assert.strictEqual(mail.problems.length, 3);
  assert.ok(mail.text.includes('/gallery/: HTTP 404'));
  assert.ok(mail.text.includes('Auth health: HTTP no response, no response within 15 s'));
  assert.ok(mail.text.includes('READABLE by visitors: run supabase/hide-editor-emails.sql'));
  assert.ok(!mail.text.includes('"x"'), 'the readable value itself is never put in the email');
});

/* ---------- the email ---------- */
let sample;
test('full email: sections, order, wording', async () => {
  const nextEvents = events.filter((e) => e.id !== 'g').map((e) => Object.assign({}, e));
  nextEvents.find((e) => e.id === 'b').note = 'Join us at Sunshine at 4pm instead';
  nextEvents.push(ev('h', '2026-11-29', '7pm', 'Prayer', 'Prayer meeting', ['all']));
  const nextCampuses = campuses.map((c) => Object.assign({}, c)); nextCampuses[0].sunday_time = '9:45am';
  const nextGallery = [Object.assign({}, gallery[0]), Object.assign({}, gallery[1], { caption: 'Christmas lunch 2025' }), photo('p4', 'Baptism service at Mernda', ['mernda'], 40)];
  const report = {
    ok: true, events: nextEvents, campuses: nextCampuses, gallery: nextGallery,
    changes: diffEvents(events, nextEvents), campusChanges: diffCampuses(campuses, nextCampuses), galleryChanges: diffGallery(gallery, nextGallery)
  };
  const f = fakeFetch();
  const [visitors, health] = await Promise.all([getVisitors(f, CFG, NOW), getHealth(f, CFG)]);
  sample = buildEmail({ report, visitors, health, now: NOW, env: ENV });
  const t = sample.text;
  assert.strictEqual(sample.subject, 'TCF website: events summary, Thursday 19 November 2026');
  assert.deepStrictEqual(sample.problems, []);
  const order = ['CANCELLATIONS AND SERVICE CHANGES', 'GUEST SPEAKERS IN THE NEXT 14 DAYS', 'SPECIAL EVENTS IN THE NEXT 30 DAYS', 'UPCOMING PRAYER MEETINGS', 'CHANGES IN THE LAST 24 HOURS', 'VISITORS YESTERDAY', 'HEALTH', 'https://tcfmelbourne.org/admin/'];
  let at = -1; for (const o of order) { const i = t.indexOf(o); assert.ok(i > at, o); at = i; }
  const soon = t.slice(t.indexOf('CANCELLATIONS'), t.indexOf('GUEST SPEAKERS'));
  const cancelLine = soon.indexOf('- Sun 22 Nov | CANCELLED: Tarneit Sunday Service.\n  Join us at Sunshine at 4pm instead');
  assert.ok(cancelLine > -1 && soon.indexOf('3pm | Sunshine | Service change') < cancelLine, 'same day sorted by time, CANCELLED line with note');
  // Combined: "Combined with <campus>, <its time that day>"; the old automatic note isn't repeated
  assert.ok(soon.includes('- Sun 29 Nov | CANCELLED: Melton Sunday Service. Combined with Sunshine, 4pm\n'), 'CANCELLED + combined line');
  assert.ok(soon.includes('- Sun 29 Nov | CANCELLED: Mernda Sunday Service. Combined with Tarneit, 4:30pm\n  Bring a plate'), 'older combined service shown the same way');
  const guests = t.slice(t.indexOf('GUEST SPEAKERS'), t.indexOf('SPECIAL EVENTS'));
  const specials = t.slice(t.indexOf('SPECIAL EVENTS'), t.indexOf('UPCOMING'));
  assert.ok(specials.includes('- Sat 5 Dec | 4pm | Christmas Night | TCF Ministries, Keilor East VIC\n  Kids program. All welcome.'), 'special event: date, time, title and location');
  assert.ok(!specials.includes('Youth camp'), 'special events more than 30 days away are left out');
  assert.ok(!soon.includes('Christmas Night') && !t.slice(t.indexOf('UPCOMING PRAYER'), t.indexOf('CHANGES IN')).includes('Christmas Night'), 'special events only in their own list');
  // The backup keeps "no campus" for an event with a location
  assert.deepStrictEqual(events.find((e) => e.id === 'sp1').campuses, []);
  assert.strictEqual(events.find((e) => e.id === 'sp1').location, 'TCF Ministries');
  assert.ok(guests.includes('- Sun 22 Nov | Mernda, Noble Park | with Ps Jenistan (Guest Speaker – France)'), 'guest speakers: one line per speaker and day');
  assert.ok(!soon.includes('Ps Jenistan'), 'guest speakers are not service changes');
  assert.ok(!guests.includes('Ps Hidden'), 'a guest speaker at a cancelled campus is left out');
  assert.ok(!soon.includes('Combined service at Sunshine'), 'automatic note not repeated');
  assert.ok(!soon.includes('Ps Hidden'), "a replaced campus's own Service change is left out");
  assert.ok(!/6 Dec/.test(soon) && !/Cancellation|<s>/.test(soon));
  assert.ok(!/12 Nov/.test(t), 'past events left out');
  const meet = t.slice(t.indexOf('UPCOMING PRAYER MEETINGS'), t.indexOf('CHANGES IN THE LAST'));
  assert.ok(!/Sunday service|Conducted by Youth/i.test(meet), 'regular Sunday services stay out of the meetings list');
  assert.ok(meet.includes('\n  Youth Night') && !meet.includes('Youth night'), 'titles in Title Case ("Youth night" is stored)');
  assert.ok(!soon.includes('Conducted by Youth') && !/\| Sunday service/i.test(soon), 'and out of the cancellations/changes list');
  assert.ok(soon.includes('| CANCELLED:') && soon.includes('Combined with') && soon.includes('| Service change') && !/COMBINED SERVICE/.test(t), 'cancelled, combined and real service changes listed');
  assert.ok(t.includes("Events: 1 added, 1 changed, 1 removed since yesterday's backup."));
  assert.ok(t.includes('- Changed: Sunday Service, Sun 22 Nov, Tarneit: note "Join us at Sunshine instead" → "Join us at Sunshine at 4pm instead"'));
  assert.ok(t.includes('- Melton: Sunday time "9:30am" → "9:45am"'));
  assert.ok(t.includes('- Added photo: "Baptism service at Mernda" (Mernda)') && t.includes('- Removed photo: "Youth camp" (Melton)'));
  assert.ok(t.includes('Visits: 48') && t.includes('Pageviews: 66') && t.includes('1. /'));
  assert.ok(!/@/.test(t), 'no email addresses, no editors');
});
test('Supabase read failed -> PROBLEM alert with the status code, health and visitors still included', async () => {
  const f = fakeFetch();
  const [visitors, health] = await Promise.all([getVisitors(f, CFG, NOW), getHealth(f, CFG)]);
  const mail = buildEmail({ report: { ok: false, status: 503, table: 'events', error: 'Supabase read failed for "events" (HTTP 503): upstream' }, visitors, health, now: NOW, env: ENV });
  assert.strictEqual(mail.subject, 'PROBLEM: TCF website: Supabase read failed, Thursday 19 November 2026');
  assert.ok(mail.text.includes('The Supabase read failed (events): HTTP 503.'));
  assert.ok(mail.text.includes('VISITORS YESTERDAY') && mail.text.includes('HEALTH'));
  assert.ok(buildEmail({ report: null, visitors, health, now: NOW, env: ENV }).text.includes('no response (HTTP status unknown)'));
});
test('NOTIFY_EMAIL: commas or semicolons, spaces and empty items, each address checked', () => {
  assert.deepStrictEqual(parseRecipients('media@tcfmelbourne.org'), ['media@tcfmelbourne.org']);
  assert.deepStrictEqual(parseRecipients(' a@example.org ;b@example.org,, c.d+tag@mail.example.com.au ; ;'),
    ['a@example.org', 'b@example.org', 'c.d+tag@mail.example.com.au']);
  for (const bad of ['not-an-email', 'a@example', 'a b@example.org', 'Name <a@example.org>', 'a@@example.org', 'a@-x.org', 'a@x.c']) {
    assert.throws(() => parseRecipients(`ok@example.org, ${bad}`), /NOTIFY_EMAIL: address 2 of 2 is not a valid email address/, bad);
  }
  assert.throws(() => parseRecipients(' ; , '), /NOTIFY_EMAIL has no email addresses/);
  assert.throws(() => parseRecipients('x@, y@example.org; z'), /addresses 1, 3 of 3 are not/);
  // The error names positions only, never the addresses (the Actions log may be public)
  assert.throws(() => parseRecipients('secret.person@example'), (e) => !e.message.includes('secret.person'));
});
test('NOTIFY_EMAIL: up to three in To; more than three: first in To, the rest in BCC; one email', async () => {
  assert.deepStrictEqual(recipientFields(['a@x.org']), { to: ['a@x.org'] });
  assert.deepStrictEqual(recipientFields(['a@x.org', 'b@x.org', 'c@x.org']), { to: ['a@x.org', 'b@x.org', 'c@x.org'] });
  assert.deepStrictEqual(recipientFields(['a@x.org', 'b@x.org', 'c@x.org', 'd@x.org']), { to: 'a@x.org', bcc: ['b@x.org', 'c@x.org', 'd@x.org'] });
  // send() with a fake mail server: one sendMail call, nothing really sent
  const env = { SMTP_HOST: 'smtp.example.org', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASSWORD: 'not-real', SMTP_FROM: 'TCF Website <web@example.org>',
    NOTIFY_EMAIL: 'a@x.org; b@x.org, c@x.org;d@x.org , e@x.org' };
  const sent = []; let opts = null;
  const fake = (o) => { opts = o; return { sendMail: async (m) => { sent.push(m); } }; };
  assert.strictEqual(await send({ subject: 'S', text: 'T' }, env, fake), 5);
  assert.strictEqual(sent.length, 1, 'one email');
  assert.deepStrictEqual([sent[0].to, sent[0].bcc], ['a@x.org', ['b@x.org', 'c@x.org', 'd@x.org', 'e@x.org']]);
  assert.deepStrictEqual([sent[0].from, sent[0].subject, sent[0].text, opts.requireTLS], ['TCF Website <web@example.org>', 'S', 'T', true]);
  sent.length = 0;
  await send({ subject: 'S', text: 'T' }, Object.assign({}, env, { NOTIFY_EMAIL: 'a@x.org;b@x.org' }), fake);
  assert.deepStrictEqual([sent[0].to, 'bcc' in sent[0]], [['a@x.org', 'b@x.org'], false]);
  // An invalid address stops the run before connecting to the mail server
  let connected = false;
  await assert.rejects(send({ subject: 'S', text: 'T' }, Object.assign({}, env, { NOTIFY_EMAIL: 'a@x.org; oops' }), () => { connected = true; return fake(); }), /address 2 of 2/);
  assert.strictEqual(connected, false);
});
test('no upcoming events', async () => {
  const health = await getHealth(fakeFetch(), CFG);
  const t = buildEmail({ report: { ok: true, events: [events[0]], campuses, changes: diffEvents(events, [events[0]]) }, visitors: { ok: false, day: '2026-11-18' }, health, now: NOW, env: ENV }).text;
  assert.ok(t.includes('There are no upcoming events on the website.') && t.includes('0 added, 0 changed, 15 removed'));
});

(async () => {
  for (const [name, fn] of tests) { await fn(); passed++; console.log('ok  ', name); }
  console.log(`\n${passed} tests passed.`);
  const args = process.argv.slice(2);
  const full = `Subject: ${sample.subject}\n\n${sample.text}`;
  const out = args.indexOf('--out');
  if (out > -1) { fs.writeFileSync(args[out + 1], full); console.log(`Sample email saved to ${args[out + 1]} (nothing was sent).`); }
  else if (!args.includes('--quiet')) console.log('\n======== sample email ========\n\n' + full);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
