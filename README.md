# tcfm
Website for Tamil Christian Fellowship Melbourne

## Editing content

Editors update events, regular service times and gallery photos on the admin page at `/admin/`,
which is not linked from the site. See [ADMIN-GUIDE.md](ADMIN-GUIDE.md).

Content lives in Supabase (free plan) and is read in the browser with the **publishable** key only;
Row Level Security in [`supabase/schema.sql`](supabase/schema.sql) allows visitors to read and
logged-in editors to write. The static HTML (service times) and `data/events.json` (events) are the
fallback when Supabase is unreachable.

- Preview locally: `npx http-server@14.1.1 . -p 8080 -c-1`, then open http://localhost:8080/
- Back up events, campuses and gallery details into `data/`: `node scripts/export-events.js`
- Check that visitors can't write, can't see deleted rows and can't see editors' emails: `node scripts/check-rls.js`

Visitor numbers come from [GoatCounter](https://www.goatcounter.com/) (no cookies, no personal data),
counted at https://tcfmelbourne.goatcounter.com. The admin page isn't counted.

If a campus's regular details change in the HTML, update `DEFAULTS` in `main.js` to match.

## Daily backup and email

[`.github/workflows/supabase-daily.yml`](.github/workflows/supabase-daily.yml) runs every day at
21:00 UTC (7am in Melbourne in winter, 8am during daylight saving). It:

1. reads events, campuses and gallery details from Supabase with the **public** key. This also
   counts as activity, so the free project doesn't pause from inactivity.
2. writes `data/events.json`, `data/campuses.json` and `data/gallery.json`, and commits them to the
   default branch as "Update events backup [skip ci]" only if something changed. The backup holds
   only what visitors can see: no deleted events or photos and no editors' email addresses.
3. emails a summary with these sections:
   - cancellations and service changes in the next 14 days, then upcoming prayer meetings and meetings
   - **Changes in the last 24 hours**: what was added, changed or removed in events, service times
     and the gallery since yesterday's backup (what changed, never who changed it)
   - **Visitors yesterday** (Melbourne time) from GoatCounter: visits, pageviews and the top 5
     pages. If GoatCounter can't be reached it says "Visitor stats unavailable" and carries on.
     GoatCounter counts each visitor once per page per day, so "pageviews" means pages seen by
     different visitors.
   - **Health**: every page in `sitemap.xml` at `SITE_URL` (HTTP status and response time), and
     Supabase with the public key only: reading events, the Auth health endpoint, reading the
     gallery (and one photo file), and a check that visitors **can't** read editors' email addresses.
   - a link to the admin page.

   If anything isn't OK (Supabase can't be read, a page doesn't return 200 within 15 seconds, a
   check fails, or editors' emails are readable), the subject starts with **PROBLEM**. The email
   lists the problems at the top and the run is marked as failed after the email is sent. GitHub
   also emails the repository owner about failed runs.

Scheduled workflows only run from the **default branch**, so this starts once it has been merged there.

### Set the variables and secrets

In the repository on GitHub: **Settings → Secrets and variables → Actions**.

On the **Variables** tab, click **New repository variable** for each:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://ahrwrjxlsaprqbbtjvzk.supabase.co` |
| `SUPABASE_ANON_KEY` | the publishable key, `sb_publishable_…`. Never the secret or service-role key; the script refuses those. |
| `NOTIFY_EMAIL` | who gets the summary: one address, or several separated by commas or semicolons, e.g. `media@tcfmelbourne.org; someone@example.org`. Spaces and empty items are ignored; each address is checked, and a wrong one stops the run before anything is sent (the log names its position, not the address). One email goes to everyone. Up to three addresses are all shown in "To"; with more than three, only the first is in "To" and the rest get it as BCC. |
| `SMTP_FROM` | the sender, e.g. `TCF Website <admin@tcfmelbourne.org>`. Must be the mailbox you log in with (or an alias of it). |
| `GOATCOUNTER_CODE` | `tcfmelbourne` |
| `SITE_URL` | optional. Only set it to check a different address, e.g. a test copy of the site. Default `https://tcfmelbourne.org`. |

On the **Secrets** tab, click **New repository secret** for each:

| Name | Value (Google Workspace / Gmail) | Value (Microsoft 365 / Outlook) |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | `smtp.office365.com` |
| `SMTP_PORT` | `465` | `587` |
| `SMTP_USER` | the full mailbox address | the full mailbox address |
| `SMTP_PASSWORD` | the app password (below), not the normal password | the app password (below) |
| `GOATCOUNTER_TOKEN` | a GoatCounter API key (below) | same |

Secrets can't be read back once saved and GitHub hides them in logs. They're never written to the repository.

### Create the GoatCounter API key

1. Log in at https://tcfmelbourne.goatcounter.com.
2. Open **Settings** (top right, or your account menu) → **API**, then **New API key**.
3. Name it "Daily email" and tick **only** "Read statistics". It needs nothing else.
4. Click **Create**, copy the key into the `GOATCOUNTER_TOKEN` secret, then close the page. You
   can't see the key again; make a new one if it's lost.

Without the key everything else still works; the email just says "Visitor stats unavailable".

### Create an app password for the church mailbox

An app password is a separate password just for this workflow. You can delete it at any time
without changing the normal password.

- **Google (Gmail / Google Workspace):** sign in as the church mailbox, open
  <https://myaccount.google.com/apppasswords>, type a name such as "Website email" and click
  **Create**. Copy the 16-character password (without spaces) into `SMTP_PASSWORD`.
  2-Step Verification must be turned on first (Google account → **Security**). If the page says app
  passwords aren't available, a Workspace administrator has to allow them, or 2-Step Verification is off.
- **Microsoft 365 / Outlook.com:** turn on two-step verification, then go to
  <https://account.microsoft.com/security> → **Advanced security options** → **App passwords** →
  **Create a new app password**. On a Microsoft 365 work mailbox, an administrator must also turn on
  **Authenticated SMTP** for that mailbox (Microsoft 365 admin center → Users → the mailbox → **Mail** →
  **Manage email apps**). Some organisations block it entirely. If so, use a Gmail account for sending.

### Run it by hand

**Actions** tab → **Supabase daily** (left-hand list) → **Run workflow** → **Run workflow**. Do this
once after setting everything up to check that the email arrives (look in spam the first time).
Click the run to see each step's log.

### If the daily run stops

GitHub **turns off scheduled workflows in public repositories after 60 days with no repository
activity** (no commits, for example). The daily backup only commits when events change, so a quiet
couple of months can switch it off. GitHub emails the repository owner before it does.

To turn it back on: **Actions** tab → **Supabase daily** → click **Enable workflow** in the banner
at the top. Then use **Run workflow** to check it works.

### Test the email locally

`node scripts/test-daily-summary.js` checks the email, change, visitor and health logic with sample
data and a fake network, and prints a sample email (add `--out email.txt` to save it). It sends
nothing and contacts nothing. To preview today's real email without sending it:

```
REPORT_FILE=report.json DATA_DIR=/tmp/backup node scripts/export-events.js
REPORT_FILE=report.json node scripts/daily-summary.js --out email.txt
```

### Hide editors' email addresses from visitors

Editors' emails are stored in `updated_by` so the admin page can show who changed what. Visitors must
not be able to read that column. `supabase/schema.sql` grants visitors only the other columns. A
project set up with an earlier version of the schema needs `supabase/hide-editor-emails.sql` run once
in the Supabase SQL Editor. `node scripts/check-rls.js` and the daily Health check both warn if it's
still readable.

### Event types and status

Types: **Sunday service** (a regular service, also with a guest speaker, shown without a badge),
**Prayer**, **Meeting** and **Service change** (only a real change of time or place). A guest speaker
is a Sunday service whose note starts with "with", e.g. "with Ps Name (Guest Speaker, Country)".

Editors pick a **Status**: **Normal** or **Cancelled**. Cancelled is type `Cancellation`, optionally
with `combined_with` set to the campus everyone joins instead.

Run these once, in order, in the Supabase SQL Editor on a project set up before they existed. New
installs get all of them from `supabase/schema.sql`.

- `supabase/add-combined-with.sql`: adds the `combined_with` column.
- `supabase/add-sunday-service-type.sql`: adds the "Sunday service" type and converts the imported
  regular services.
- `supabase/status-cleanup.sql`: changes `combined_with` to belong to cancellations, converts old
  combined services (Service change + `combined_with`) to cancellations, and converts guest
  speakers (Service change + a "with …" note) to Sunday services.
- `supabase/special-events.sql`: adds the "Special event" type and the location columns.
- `supabase/title-case-events.sql` (optional): stores existing titles in Title Case
  ("Sunday service" → "Sunday Service"). It previews the changes first. The next morning's email lists
  each changed title once.

**Past events.** Public pages show only events dated today or later (Melbourne date). `main.js` asks
Supabase for `date >= today` and `normaliseEvents()` drops anything older, so the saved list
(`data/events.json`) follows the same rule. When nothing is coming up, each events block shows "No upcoming
events right now. Please check back soon." Past events stay in the database and the daily backup. The
admin page lists them under a collapsed **Past events**, with **Copy** to re-use one on a new date.

**Title Case.** `titleCase()` in `main.js` is the one rule for titles: the website shows every event
title with it, the admin page loads `main.js` with `data-shared` (only this helper runs there) to save
and show titles, and `scripts/daily-summary.js` requires it for the email. Every word gets a capital
first letter, except a, an, and, at, by, for, in, of, on, or, the, to, with (unless first or last).
Capitals already typed (TCF, ACC, McKenzie) are kept. "Sunday service" detection is case-insensitive.

Until the last file is run, the website, the email and the admin page already show old rows the new
way. Only saving a cancellation combined with another campus is refused, with a message saying so.

On a Sunday, a cancellation that is combined, or titled "Sunday service", **replaces** the service of
each campus it lists for that date. The website (home, events, campus pages, services, "This week"),
the admin preview, the saved `data/events.json` fallback and the morning email apply the same rule:

- **Cancelled campuses:** their "Sunday service" rows (including a guest speaker) are hidden. Each
  shows "Cancelled", no time, "Combined with Tarneit, 4:30pm" if combined, then the editor's note.
  The time is the joined campus's row that day, or else its Sunday time from the campuses table.
- **The joined campus:** it keeps its row and gets "Includes the Melton and Mernda services". If it
  has no row that day, one is added from its regular time.
- **Old notes:** a note that only repeats the older automatic text ("Combined service at Tarneit,
  …") isn't shown.
- **Morning email:** "- Sun 22 Nov | CANCELLED: Melton and Mernda Sunday service. Combined with
  Tarneit, 4:30pm", and a short "Guest speakers" list for the next 14 days.

### Adding a special event

A special event is held somewhere that isn't a campus, e.g. "Christmas Night" at TCF Ministries,
Keilor East. Run `supabase/special-events.sql` once in the Supabase SQL Editor (new installs get it
from `schema.sql`).

- **Database:** type `Special event`, and three nullable columns: `location` (venue name),
  `location_address` and `location_url` (optional, `https://` only).
- **No campus:** `campuses` may be empty (`{}`) when `location` is set.
- **Visitors:** they can read the three new columns. `updated_by` stays hidden.
- **Admin:** choose Type **Special event**. "Not at a campus" is ticked and the venue name is
  required. An optional End time is saved as "4pm to 6pm".
- **Website:** a gathering card with a "Special event" badge, the time, venue and address, and
  "Get directions". The link is `location_url`, or else a Google Maps search for the venue and
  address.
- **Where it shows:** under every campus filter and on every campus page, and in "This week" within
  7 days. It never joins or replaces a Sunday service card.
- **Search engines:** pages listing events add a schema.org `Event` (JSON-LD) for upcoming special
  events only. It's a data block, not a script, so the Content-Security-Policy is unchanged.
- **Email:** a "Special events in the next 30 days" section.
- **Before the SQL is run:** the site and backup read without the new columns. Saving a special
  event is refused, with a message saying so.
