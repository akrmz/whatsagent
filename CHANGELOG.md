# Changelog

All notable changes. Finding IDs (P-01, B-02, …) refer to [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

## 3.23.0 — 2026-10-09

### Added — following up with clients who went quiet
- **`.agent nudge on`**: once a day, from the start of the sending hours, active clients who haven't answered what was last sent (a listing, an offer or a welcome) for 3–14 days get **one** follow-up for it ("لسه بتدور على شقة، في التجمع …؟"), with the best matching listing and the opt-out line.
  - It's sent as a paced campaign, at most 30 a day, with a summary to the owner.
  - Skipped: clients who replied, closed or said وقف in the meantime.
  - Each send gets at most one follow-up. After 14 days it's left to the agent.
- **`.agent nudgetext …`** sets your own wording, with the same placeholders as the welcome.
- **Morning summary**: followed-up clients are marked "🔔 تمت متابعته"; their history notes "أُرسلت له رسالة متابعة", and `.team` counts them as sent.
- Campaigns now have three kinds: listing (including price drops), welcome and follow-up. They share the message builder, the pacing and the opt-out.

### Checked
- 3 tests (331 in total), with simulated clocks:
  - who is due (a 5-day silence yes; 1 day, 19 days, replied, won and opted out no);
  - off by default, not before the sending hours, the exact message, the summary, the digest marker, once per send;
  - your own wording, and a reply before their turn.

## 3.22.0 — 2026-10-09

### Added — automatic campaigns for new listings
- **`.agent autoblast on`**: a listing added with `.listing add` that suits saved clients is queued as a campaign starting **30 minutes later**, so there's time to add photos (they're included when it sends).
  - The add reply gives the client count, the start time and `.blast stop N` to cancel.
  - The usual pacing, hours, daily cap, opt-out and "no listing twice" rules apply.
- **Not queued**: a likely duplicate, a listing that suits nobody, or when 5 campaigns are already running (the reply says so). A listing reserved or sold before the start stops its campaign.
- **Campaigns can wait**: a start time is stored; the sending loop takes the oldest campaign that is due, and `.campaigns` shows "🕒 يبدأ 11:30".
- `.agent`, `.rehelp`, the Arabic guide and USAGE.md cover it.

### Checked
- 2 tests (328 in total), with simulated clocks:
  - off by default, the 30-minute wait, the start time in `.campaigns`, and a photo added meanwhile being sent;
  - nobody suited, a duplicate, sold before the start, and the running limit.

## 3.21.0 — 2026-10-09

### Added — a catalogue menu for clients
- **`.agent catalog on`**: a client who sends "عقارات" (also قائمة، العروض، منيو، menu) in a private chat gets a numbered menu of the available listings, grouped by type and sale/rent with counts ("1️⃣ شقق للبيع (12)"), plus the developers' projects.
  - A number opens a group: cheapest first, up to 10, with the rest suggested as a written request.
  - "#12" shows a listing as before; "0" goes back to the menu; a wrong number gets a hint.
  - Arabic digits work.
- **Limits**:
  - a number counts only while that client's menu is open (10 minutes, kept in memory only);
  - at most 6 menu steps a minute per client (extra steps get no reply);
  - private chats only; never in private mode.
- The order is stable: largest group first, then sale before rent, then by name.
- `.agent`, `.rehelp`, the Arabic guide and USAGE.md cover it.

### Checked
- 2 tests (326 in total):
  - off by default, the exact menu, a group in price order, `#12` inside the flow, projects, a wrong number, and back;
  - numbers without a menu, groups, the 10-minute expiry and the flood limit.

## 3.20.1 — 2026-10-09

A review of the 3.14–3.20 additions.

### Security
- **CSV formula injection in `.export`** (B-20 in [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md)). Names, notes and lead-ads answers can be typed by strangers (a WhatsApp name, a form). Text such as `=HYPERLINK(…)` was written into the CSV as is, and Excel could run it as a formula when the file was opened.
  - Formula-like cells now start with an apostrophe, so Excel shows them as text. Phone numbers (`+2010…`) and plain numbers are unchanged.
  - `.import` removes the apostrophe, so an export round-trips exactly.
  - The issue predates the lead-ads import: clients saved from `#12` questions already carried their WhatsApp name.

### Checked
- **Other places stranger text ends up**: the images (flyer, story, collage, offer PDF) escape all text; the calendar file escapes names and line breaks; AI prompts mask phone numbers and frame posts as data; the welcome and campaign messages are built from saved data only.
- **Data growth** is bounded everywhere: feed, campaigns, team stats, client history, price history. Store writes are debounced, so imports and counters stay cheap.
- 324 tests pass.

## 3.20.0 — 2026-10-09

### Added — team performance
- **`.team`** shows the month for the owner and each sudo user:
  - clients added, and listings, offers and welcomes sent;
  - viewings booked, and deals closed with their commission;
  - the active clients assigned to them (in the current month only).

  Members are matched by phone number whatever id WhatsApp used, and mentioned so their names show. Automatic work is one 🤖 line. `.team last` and `.team 2026-09` show other months.
- **Monthly counters** (`team-stats.json`, 24 months kept) are recorded when clients are added, listings/offers/welcomes are sent, viewings are booked and deals are closed. Viewings and campaigns are deleted after a while, so their history couldn't be counted afterwards. A month starts at midnight in the bot's time zone. Counting starts with this version.

### Checked
- 2 tests (323 in total):
  - month boundaries in Cairo time against UTC, and the 24-month limit;
  - a full month with the owner and a sudo user, sorted by deals, with the commission, the assigned clients, the 🤖 line and the mentions;
  - an empty past month, and the permissions.

## 3.19.0 — 2026-10-09

### Added — listings on your WhatsApp Status
- **`.statuspost 12`** posts a listing to the bot's WhatsApp Status as its 9:16 design, with a short caption (type, area, price, "للاستفسار أرسل: #12").
- **`.statuspost daily 09:00 [search]`** posts one available listing every day, going round the catalogue. It uses the same schedule and catch-up as "listing of the day". Also `.statuspost now` and `.statuspost off`.
- **Audience**:
  - a status is encrypted to the numbers in `statusJidList`, which was checked in the installed Baileys 7 source (`relayMessage` adds `statusJidList` to the recipients for `status@broadcast`);
  - the bot uses saved clients with a number, except those who sent وقف (the most recently active first, at most 1,000), plus the owner;
  - WhatsApp still shows a status only to people who have the number saved.
- The Arabic guide, USAGE.md and `.rehelp` cover it. The docs test flagged the new command until it was documented in Arabic.

### Checked
- 3 tests (321 in total):
  - the audience (opt-outs, no number, the 1,000 cap), and what's sent (`status@broadcast`, the image size, the caption, `statusJidList`);
  - the daily rotation, once a day, and off.
- Not checked on a real phone: whether the posted status shows up for contacts. That needs a live WhatsApp account.

## 3.18.0 — 2026-10-09

### Added — fewer no-shows
- **The client is reminded on the day**: a viewing booked with `send` more than 3 hours ahead gets the client "تذكير بمعاد معاينة …" 2 hours before, followed by the listing's **location pin** when it has one. It's sent once; the agent's own 1-hour reminder is unchanged. A booking made shortly before gets only its confirmation.
- **`.viewing done 3 noshow`** (also محضرش، ماجاش، غاب) records a no-show. It's counted on the client and shown on their card ("🚫 لم يحضر 2 معاينة"), and lowers them in `.leads hot` (−5 each, up to −15). The stage isn't changed. The reply suggests booking again and warns after repeated no-shows.
- The Arabic guide and USAGE.md cover both.

### Checked
- 3 tests (318 in total), with simulated clocks:
  - the client reminder: its timing, text and pin, sent once;
  - no reminder without `send`, without a number, or when booked shortly before;
  - no-shows: counting, the card, the hot score, and the stage left as is.

## 3.17.1 — 2026-10-09

### Docs
- **[docs/REAL_ESTATE_AR.md](docs/REAL_ESTATE_AR.md)**: a complete Arabic guide to the real-estate tools, organised around the agent's day. It covers:
  - your details, the catalogue (photos, location, private owner, availability checks) and marketing designs (including English for foreign buyers);
  - clients (Excel and Meta lead-ads imports, automatic answers, welcome messages, hot clients, offers), campaigns and price drops;
  - viewings, deals and reports, rentals, developers' projects, brokers' groups, the morning summary, privacy and backups.

  It's linked from the README, USAGE.md and `.rehelp`.
- **A new test keeps the docs honest**:
  - every `.command` written in USAGE.md and the Arabic guide must exist (as a name or alias);
  - every real-estate command must appear in the Arabic guide, so a new one can't go undocumented.

  It found nothing missing today. It is skipped when the repository's `docs/` folder isn't there.

## 3.17.0 — 2026-10-08

### Added — price-drop campaigns
- **`.blast 12 drop`** previews and **`.blast 12 drop go`** sends a price-drop campaign after a cut in the last 30 days.
  - It goes to every client whose budget the new price fits, including clients who got the listing before at the old price (a normal campaign skips them). The preview marks those clients.
  - The message opens with "📉 نزل سعره! العقار اللي بعتهولك قبل كده — بقى 3.2 مليون بدل 3.6 مليون جنيه (خصم 11%)".
  - Each client is told once per price. A further cut is news again.
  - The campaign stops if the price goes back up.
  - The pacing and opt-out are the same as other campaigns.
- After `.listing edit` lowers a price, the reply suggests `.blast 12 drop`. `.rehelp` mentions it.

### Checked
- 2 tests (314 in total):
  - the cut is required, and the right clients get it, including "had it before" and not those still over budget;
  - both message openings, and once per price;
  - a new cut targets them again, and the campaign stops if the price goes back up.

## 3.16.0 — 2026-10-08

### Added — welcoming new clients
- **`.leads welcome`** previews the welcome: who gets it (new, uncontacted clients with a number who haven't said وقف, oldest first) and the first message in full. **`.leads welcome go`** sends it with the campaign pacing (gap, hours, daily cap), the opt-out line and a summary at the end.
- **The default welcome** greets by name, mentions the ad they came from and what they're looking for, introduces you (name and company), asks for area and budget, and adds the best matching listing when there is one.
- **`.agent welcome <text>`** sets your own wording, with {name}, {ad}, {wish} and {agent}.
- **Tracking**: each welcomed client is noted and moves to "contacted". A client contacted by hand before their turn is skipped. Replies show as "ردّ على رسالة الترحيب", and the card and morning summary say "رسالة الترحيب" where they would say "#12".
- `.import leads` suggests `.leads welcome` after an import.

### Checked
- 2 tests (312 in total): the exact default message, a client with no ad or wishes, your own wording and resetting it, who gets it, the order, skipping a client contacted meanwhile, the summary, and the reply tracking.

## 3.15.0 — 2026-10-08

### Added — Facebook / Instagram lead ads
- **`.import leads` reads Meta's lead-ads downloads as they are**, from Leads Center or Ads Manager. Each lead becomes a client:
  - name and number (Meta's "p:" prefix removed; a local number takes the owner's country code);
  - source فيسبوك or إنستجرام from the platform, and the ad's name (`campaign`, shown on the card as "إعلان: …");
  - the form's answers read by what the question asks: budget, area, unit type, rooms, buy/rent;
  - all answers, the e-mail and the date kept in the notes.

  Numbers that are already clients are skipped. The reply says how many new clients already have matching listings.
- **`.restats`**: "📢 حسب الإعلان", with clients and deals per ad.
- **Clients**: an "الإعلان:" / "campaign:" line can be typed by hand too.

### Changed
- **CSV files**: UTF-16 files are read (by their byte-order mark, or their zero bytes when there is none). Tab is recognised as a separator, alongside "," and ";".

### Checked
- 3 tests (310 in total): UTF-16 LE/BE with and without a byte-order mark, the separators, a Meta row field by field, and the import:
  - duplicates and empty rows;
  - the command's reply;
  - the per-ad report.

## 3.14.0 — 2026-10-08

### Added — English for foreign buyers
- **`.listing 12 en`**, **`.flyer 12 en`** and **`.story 12 en`**, and clients can send **`#12 en`**. These are translated:
  - type, sale/rent, finishing, floor (ordinals: 4th, 11th, 22nd; ground and top floor) and status;
  - the currency as a code (EGP, SAR, AED …), with prices like "EGP 3,500,000 (EGP 3.5M)", and the price per m²;
  - "11% OFF" with the old price after a cut.
- **Areas**: about 40 common Egyptian areas and compounds have English names, matched longest first and listed in order (التجمع الخامس، النرجس → "Fifth Settlement, New Cairo — El Narges"). Unknown areas aren't guessed: add "Location EN: …" to the listing.
- Notes are included only when written in English.
- The English flyer and story are laid out left to right. The flyer was rebuilt on the same text helpers as the story; the Arabic flyer looks the same as before (checked by eye).

### Checked
- 4 tests (307 in total): the translations, the exact English card, the commands and `#12 en` (plain `#12` stays Arabic), the image sizes, and a pixel check that English text sits on the left and Arabic on the right.

## 3.13.1 — 2026-10-08

A review of the 3.8–3.13 additions.

### Privacy
- **Less goes to the AI**: `.listing add ai` no longer sends the "المالك:" line, and phone numbers in the post (the owner's, or a broker's "للتواصل 0100…") are replaced with "[رقم]". The owner is still saved from the full text by the bot's own reader. `.adcopy` on a replied-to post masks phone numbers too. Prices ("3,500,000", "3 500 000") are untouched.
- Checked: a listing's owner is read in only five places (the staff-only line, the export, `.listing ask`, the owners service, and the morning summary, which prints listing numbers only). None reaches a client.

### Performance
- **`.leads hot` and the morning summary** were 11× faster in testing (174 ms → 16 ms with 2,000 clients and 500 listings; 30 ms at 5,000 × 1,000). The catalogue and upcoming viewings are now read once per ranking instead of once per client, and listings in budget are counted only up to the 3 that matter. With 3 or more, the reason reads "🏠 3+ عقار في ميزانيته".
- Checked: the message parsers that strangers can trigger (brokers' posts, requests, owners' answers) are linear in the text length and bounded (2,000 / 300 characters), at about 4 ms in the worst case.

### Checked
- `npm audit` reports no known vulnerabilities in either service's production dependencies.
- 303 tests pass.

## 3.13.0 — 2026-10-08

### Added — listings' owners
- **Owner field**: "المالك: أبو أحمد 0100 123 4567" in `.listing add`/`edit` (also صاحب العقار، رقم المالك، owner). It is private:
  - never on cards, flyers, campaigns or replies clients get;
  - shown to the owner/sudo users only in their own chat with the bot, not in a group or a client's chat (where the bot's owner might type a command);
  - included in `.export listings` and `.import`.
- **`.listing ask 12 [15 18]`** asks owners (up to 5 at once) whether the listing is still available. Replies are read automatically:
  - "متاح" confirms the listing (it counts as updated);
  - sold/rented and a new price come to you with the command to apply;
  - anything else is passed on.

  With several open questions and no "#12", the reply is passed on and the owner asked to name the unit. Questions stay open 7 days, and answers are read in private mode too.
- **Morning summary**: suggests `.listing ask …` for stale listings with an owner number.

### Changed
- Phone-number handling moved to `services/phones.js`, shared by clients, tenants and owners. No change in behaviour.

### Checked
- 4 tests (303 in total):
  - reading answers, including "#2 السعر بقى 2.8 مليون", where the test caught "2" being read as the price;
  - where the owner line may and may not appear (own chat, group, client, `#12`);
  - the export round trip, several open questions, the 7-day window, and private mode.

## 3.12.0 — 2026-10-08

### Added — after the viewing
- **`.viewing done 3 liked|thinking|no [note]`** (also أعجبه، بيفكر، لم يعجبه) records how a viewing went:
  - in the client's history;
  - "liked" moves the client to negotiating (never backwards);
  - the reply suggests the next step.
- **Asked automatically**: 2 hours after a viewing, the booking chat gets "📝 كيف كانت المعاينة؟" with the command, once. Viewings without an outcome show in `.viewings` and the morning summary.
- **`.viewings ics`**: the upcoming viewings as an iCalendar file, each with the address, the client's number and a 1-hour alarm.
  - CRLF line endings, lines folded at 75 bytes without splitting Arabic characters, and commas and semicolons escaped, as the standard (RFC 5545) requires.

### Changed
- Viewings without an outcome are kept 7 days (was 1), so they can still be recorded. With an outcome, 1 day as before.
- Times: "today at 16:00" and "today 4pm" now work, like "النهارده 4 م" and "tomorrow at 4pm" already did.

### Checked
- 3 tests (299 in total), with simulated clocks, plus checks for the English "today" times: when the bot asks (once), the outcomes and stages, how long viewings are kept, and the calendar file format.

## 3.11.0 — 2026-10-08

### Added — developers' projects
- **`.project add`** records an off-plan project, shown as P1, P2 …, with:
  - the developer, area, and unit types and sizes;
  - the starting price;
  - the down payment ("بدون مقدم" = 0%) and years ("96 شهر" = 8);
  - delivery ("فوري" = ready) and maintenance.

  It lists the missing plan details after saving. `.project edit` and `.project del`.
- **`.project 3`** shows the project with the quarterly and monthly instalment for the cheapest unit, and the matching clients (owner/sudo). Anyone can view it.
- **`.projects`**: search by area words, unit type, `حتى 8 مليون`, `مقدم 10%`, `8 سنين`, `فوري`, cheapest first.
- **Matching**:
  - suitable projects on the client card;
  - up to 2 projects in automatic answers to requests (`.agent requests on`), also when no listing matches;
  - in the owner's 🔔.

  Renters aren't offered projects.
- Property types now include plurals (شقق، فيلات، فلل، شاليهات، محلات، مكاتب، عيادات), in listings and searches too.

### Checked
- 3 tests (296 in total): parsing, the instalment example, the search filters, matching, the commands, and the request answers.

## 3.10.0 — 2026-10-08

### Added — hot clients and deals
- **`.leads hot`** ranks active clients by who to call first, each with the reasons ("👀 معاينة خلال 1 يوم · 💬 راسلك منذ 2 ساعة · 🏠 1 عقار في ميزانيته").
  - Points for: the stage, a viewing soon, a recent message, a follow-up due, listings in budget, a known budget.
  - Points off for: no reply after a send, no contact for 14 days.
  - The top 3 are in the morning summary ("🔥 ابدأ بهؤلاء اليوم").
- **`.lead won 5 #12 3.1m 2.5%`** records a closed deal: price and commission (a rate, or `عمولة <amount>`), the client marked won, and the listing marked sold or rented. Without a price, the listing's price is used. A client can close more than once.
- **`.deals`**: this month's deals, value and commission, with the % change from last month, each deal, and sources. `.deals last`, `.deals 2026-09`, and `.deals 2026` (a year, by month).

### Checked
- 3 tests (293 in total), with simulated clocks: scoring and its reasons, who is left out, the deal arguments and errors, sold/rented, and month/year periods with the % change.

## 3.9.0 — 2026-10-08

### Added — designs for posting
- **`.story 12`**: a 1080×1920 vertical design for WhatsApp status. It has:
  - the first photo, type, area and price;
  - a discount badge and the old price struck through, after a recent cut;
  - the specs, a "للاستفسار أرسل: #12" box and your contact.
- **`.collage 12`**: up to 4 photos in one 1080×1350 image, arranged right to left for 1, 2, 3 or 4 photos, with "+N" when there are more, and the details panel.
- `.rehelp` lists both.

### Fixed
- `.flyer`'s description called 1080×1350 the WhatsApp status size. It is the 4:5 post size; status is 9:16, which `.story` now covers.

### Not included
- A video slideshow (`.reel`) was left out. ffmpeg isn't available on the development machine, so the video couldn't be rendered and checked before release.

### Checked
- 3 tests (290 in total): the layouts (no overlap, the first photo on the right), the image sizes, and pixel checks (the first photo's place, the darkened "+N" tile). The designs were also checked visually.

## 3.8.0 — 2026-10-08

### Added — brokers' groups
- **`.watch on`** in a brokers' group makes the bot read other members' posts. The bot never posts in the group. It sorts posts into:
  - **offers**: a type with a price and an area or size;
  - **requests**: someone asking, with the same rules as `.agent requests`, so "فيه شقة للبيع … بسعر" is an offer.
- **Alerts** to the owner, in private:
  - an offer that suits saved clients, with their names and the broker's number;
  - a request that your listings match.

  At most 20 alerts an hour.
- **`.feed`**:
  - offers from the last 30 days, with the `.listings` filters and how many clients each suits;
  - `.feed requests`;
  - `.feed 12` for the full post and the broker;
  - `.feed add 12` to copy an offer into the catalogue, noted as shared with that broker;
  - `.feed groups`.
- **Limits**: reposts within a week, even with other emoji or spacing, count once. Posts are kept 30 days, at most 2,000. Owner and sudo users' own posts are skipped.
- `.listings` search can now search any list of listings, which `.feed` uses for its offers.

### Checked
- 4 tests (287 in total): classification, alerts, reposts, other groups, the owner's own posts, `.watch off`, search, adding to the catalogue, retention, and the alert limit.

## 3.7.1 — 2026-10-08

A review of the 3.2–3.7 additions.

### Fixed
- **Client requests**: a broker's post starting with "فيه" ("فيه شقة للبيع في التجمع 150 متر بسعر 3 مليون") was answered as a client's request.
  - فيه، عندك and حد عنده now count as asking only in a question, or in a message without the marks of an offer (asking price, down payment, instalments, size in متر).
  - عايز، محتاج، مطلوب … always count. "مطلوبة/مطلوبين" are now recognised.
  - A test checks that keywords match whole words only.
- **Opt-out**: "وقف!" (with punctuation) was ignored by the activity tracker and noted as a reply. Both listeners now read the stop/start words the same way.

### Improved
- **Speed**: finding a client by phone number, which happens on every private message, no longer sorts the whole client list. At 5,000 clients it now takes 0.05 ms instead of 0.35 ms per lookup.
- **Campaigns**: only the latest 30 finished campaigns are kept. Their file is rewritten on every message sent, so it no longer grows without limit.

### Checked
- `.backup` includes the newer data files (campaigns, rentals), because it saves every file in `DATA_DIR`.
- 283 tests pass.

## 3.7.0 — 2026-10-08

### Added — rentals
- **`.rental add`** (labelled lines) records a rental:
  - a catalogue listing (marked rented) or a unit description;
  - the tenant and their number;
  - the monthly rent and its due day;
  - the start and the end or duration (a year by default);
  - the deposit.

  Dates can be written as 2026-01-01 or 1/1/2026, with Arabic digits too.
- **`.rental paid 3 [month] [amount]`** and `.rental unpaid` record payments. **`.rentals`** shows the month:
  - who has paid, who is due and who is late;
  - the amount collected out of the total;
  - earlier unpaid months;
  - contracts ending within 60 days.
- **Tenant reminders**: `.rental remind 3` sends one now. `.rental auto 3 on` sends them on the due day and every 3 days while late (up to 15 days), 10:00–21:00, at most once a day, never after the month is paid.
- **`.rental renew`** extends the contract, with an optional new rent and the % change. `.rental edit` and `.rental del` (with a reminder to set the listing back to available).
- **Morning summary**: rent due today, late rents, earlier unpaid months, and contracts ending within 60 days.
- Months before a rental was added count as settled, so a running contract doesn't show as owing from its start.

### Checked
- 4 tests (283 in total), with simulated clocks:
  - due dates on short months (day 31 in February);
  - end dates (31 Jan + 1 month = 28 Feb);
  - the reminder schedule.

## 3.6.0 — 2026-10-08

### Added — client activity
- **Replies are tracked**: when a saved client writes in a private chat, the bot notes it. The first message after a listing was sent goes into their history as "ردّ بعد إرسال العقار #12". The listener is passive (it never replies), works in private mode, and writes at most once per client every 10 minutes. "وقف" and "اشتراك" don't count as replies.
- **Morning summary**:
  - 💬 clients who replied to what you sent in the last 24 hours;
  - 📭 clients who haven't replied 2–14 days after you sent them a listing.
- **Client card**: "📤 آخر إرسال: #12 … (لم يرد بعد)" and "💬 آخر رسالة منه".
- **`.restats`**: the reply rate ("📬 نسبة الرد: 3 من 10 …").

### Changed
- Listings sent as an automatic answer to a request (`.agent requests on`) now count as sent:
  - in the client's history, as one note;
  - in the listing's 📤 counter;
  - in the client's sent list, so campaigns don't resend them;
  - and a new client moves to "contacted".

### Checked
- 3 tests (279 in total), with simulated clocks.

## 3.5.0 — 2026-10-08

### Added — clients' requests
- **`.agent requests on`**: a client who writes a request in a private chat ("عايز شقة في التجمع 3 غرف ميزانية من 2 ل 3 مليون", "عندك فيلا في زايد؟") gets up to 3 matching available listings, or "وصلني طلبك" if none match.
  - The request is saved: a new client, or an update to an existing client's wishes.
  - You get a 🔔 with the request and what was sent.
- **Only requests are answered**: the message must name a property type and ask (عايز، محتاج، عندك، فيه، "?" …). Broker posts ("يوجد/متاح شقة للبيع …") are not answered.
- **Limits**:
  - one answer per client per 10 minutes; extra requests are silent, with no greeting;
  - 30 new clients an hour, shared with `autoleads`;
  - one 🔔 per client an hour;
  - private chats only; never staff; never in private mode.
- `.rehelp` mentions it. `.agent` shows the setting.

### Checked
- 4 tests (276 in total). Detection was tried on real-style requests and broker posts.

## 3.4.0 — 2026-10-08

### Added — campaigns
- **`.blast 12`** previews and **`.blast 12 go`** starts a campaign that sends a listing to every saved client it suits. Each message has the photo, a greeting by name, how to ask (#12) and how to stop (وقف). A summary is sent when it finishes.
- **Pacing**, to protect the number:
  - one message at a time, a random 45–90 s apart;
  - only during the sending hours (default 10:00–21:00, `.blast hours`);
  - a daily cap across all campaigns (default 40, `.blast limit`);
  - at most 5 campaigns running at once.

  A campaign stops by itself when the listing is no longer available. `.campaigns` lists campaigns and `.blast stop` stops one.
- **Opt-out:** a saved client who sends "وقف" or "stop" in a private chat is never sent offers again until they send "اشتراك". This holds for campaigns, `.lead send` and `.offer … send`, and works in private mode. Unknown numbers and repeats get no reply. The client card shows 🚫.
- **No duplicates:** each client remembers which listings were sent to them, by campaigns, `.lead send` and `.offer … send`, and campaigns skip them.

The command is `.blast`, because `.campaign` is already an alias of the Islamic `.hamla`.

### Checked
- 4 tests (272 in total), with simulated clocks: hours, the gap, the daily cap, the day rollover, opt-out mid-campaign, a sold listing, stopping, and private mode.

## 3.3.0 — 2026-10-08

### Added — pricing and offers
- **`.offer 12 #5 10% 8 quarterly [send]`**: a price offer as a PDF:
  - the client's name, the property, and the price and plan summary;
  - every payment with its date, with amounts that add up exactly to the price;
  - the listing's flyer as the last page;
  - valid for 7 days.

  `send` sends it to the client on WhatsApp, notes it in their history, and counts it on the listing.
- **`.market 12`**: a listing's price per m² against similar listings (same type, deal and area): above or below their median by how much, and the price range that puts it mid-market.
- **`.compare 3 7 [9 10]`**: 2 to 4 listings side by side, with the best values marked and the distance between two located listings.
- `.rehelp` lists the pricing tools.

### Changed
- **`.market`** groups by area and type and shows the median with the usual range (25–75%) instead of the average, which one odd listing can skew. It now:
  - includes reserved and sold listings and rent (monthly rent per m²);
  - takes the `.listings` filters.
- **`.market` is now for the owner and sudo users only.** It used to be open to everyone. `.market 12` can say a listing is overpriced, and clients shouldn't see that.
- The `.market` aliases are kept (`.prices`, `.areastats`), and `.souq` and `.pricing` are added.

### Checked
- 5 tests (268 in total). Offer pages were checked visually: right-to-left order, the table across pages, and the phone number order.

## 3.2.0 — 2026-10-08

### Added — locations
- **`.listing loc 12`** saves a listing's location from a WhatsApp location pin, a Google Maps link (full or short) or written coordinates. The listing card shows a "🗺️ الموقع على الخريطة" link, and `.listing 12 map` sends the location as a WhatsApp pin.
- **`.listings near`**: reply to a client's location to list the available listings nearest first, with distances. Search filters and a radius (`5 كم`) work.
- **Maps links in posts**: `.listing add` and `.listing edit` read a Maps link anywhere in the text as the location. The link's numbers are no longer mistaken for the price or size.
- `.export listings` has a `map` column, and `.import` reads it back.
- `.rehelp` mentions the location tools.

### Security
- Short Maps links (`maps.app.goo.gl`, `goo.gl/maps`) are opened through the SSRF-safe HTTP client:
  - redirects are read, not followed blindly;
  - at most 4 hops, https only;
  - Google hosts only;
  - no page bodies are kept.
- Short links sent by clients are opened at most 30 times an hour in all. The owner and sudo users are not limited.
- `.adcopy` does not pass the map link to the AI.

### Checked
- 7 tests (263 in total). Redirect handling is tested offline with a fake HTTP client: Google's consent page, a redirect off Google, plain http, a redirect loop and a network error. A live request confirmed the bot's HTTP client can reach the short-link host.

## 3.1.0 — 2026-10-08

### Added — marketing insight
- **Price history**: each listing keeps its last 10 prices. For 30 days after a cut, the card shows the old price and the discount, and the flyer shows a "خصم %" badge with the old price struck through. Right-to-left order was checked visually: the badge reads "خصم 11%" and the old price "3,600,000 جنيه".
- **Interest counters** per listing:
  - views (`#12` and `.listing 12` by clients; staff views aren't counted);
  - inquiries (captured questions);
  - sent (`.lead send`);
  - posted (listing of the day).

  The counters don't change a listing's "last updated" time.
- **`.restats`**: the most requested listings, listings nobody asked about, recent price cuts, stale listings, clients by source with deals won and conversion, and the average days to a deal. A client's `wonAt` is now recorded when they move to "won".
- **Morning summary**: lists available listings not updated for 30+ days.

### Checked
- 3 tests (256 in total).

## 3.0.0 — 2026-10-08

### Changed — Baileys 7 (your decision)
- **Both services moved from Baileys 6.7.24 to 7.0.0-rc14**, which Baileys now tags "latest" (6.7.24 is tagged "legacy"). The previous version is tagged `baileys-6.7.24-last` for an easy way back (docs/TROUBLESHOOTING.md).
- Reviewed before upgrading:
  - every function and socket method both services use exists in 7.0 (19 methods, 6 functions), and the disconnect codes and browser identity are unchanged;
  - 6.7.24 sessions load in 7.0 (same format plus one optional field), so there's no need to pair again; tested with a 6.7-format session;
  - install-time code: only a Node version check;
  - the new dependencies (`libsignal` 6.0.0 from npm by the Baileys maintainers; `whatsapp-rust-bridge` 0.5.4, WebAssembly by a Baileys contributor) have no install scripts, and their JavaScript makes no network, shell or eval calls;
  - `npm audit`: 0 vulnerabilities in both services.
- **Nothing is installed from git any more.** The lock files had kept 6.7's GitHub address for libsignal; it now comes from the npm registry with an integrity hash. This ends "npm ci fails with Permission denied (publickey)".

### Adapted to 7.0
- **Owner/sudo identity lookup**: 7.0's `onWhatsApp` no longer returns a number's LID, so the lookup added in 2.18.2 would have learned nothing. It now uses 7.0's LID mapping store (`signalRepository.lidMapping`), which is saved with the session and asks WhatsApp only for unknown numbers. On 6.x it falls back to `onWhatsApp`.
- **Join/leave/promote events**: 7.0 sends members as `{ id, phoneNumber, lid }` and the actor's number as `authorPn`. Every listener already handled both shapes; the connection now also learns these PN↔LID links.
- Already compatible: message keys (`participantAlt`/`remoteJidAlt` instead of `participantPn`/`senderPn`) and group member lists (`phoneNumber` instead of `jid`) were handled since 2.18.2.

### Checked without connecting to WhatsApp
- Both services start under 7.0. The bot reaches "No WhatsApp session yet… Waiting" with its health endpoint up and no errors. The pairing service answers /healthz (200) and still refuses requests without the token (401).
- 6 new tests with 7.0-shaped data: senders as LIDs, member objects, the mapping store, `onWhatsApp` without LIDs, loading a 6.7-format session (253 bot tests, 18 pairing tests).
- Not testable here: the live connection to WhatsApp (the project's rule is not to connect during development). The first real check is your server after `.update now`.

## 2.33.0 — 2026-10-08

### Security — limits on what strangers can trigger
Commands already have a per-person limit, but some listeners answer plain messages from anyone:
- **`#12` and `#note` lookups** had no limit. A group member could send `#1` repeatedly and make the bot post a photo each time (group spam and a ban risk for the number). Now the same item is answered at most once per 30 s per chat, and each person gets at most 5 answers a minute. Extra requests are ignored silently and nothing else answers them. The owner and sudo users are exempt.
- **Inquiry capture** (`.agent autoleads on`) notified the owner on every repeat, and any number of new numbers could create clients. Now:
  - the same question from the same client is noted once a day;
  - the owner gets at most one 🔔 per client per hour;
  - at most 30 new clients are saved per hour;
  - a full client list no longer causes an error.
- `core/ratelimit.js`: a small sliding-window limiter kept in memory and bounded, one set per bot.
- Reviewed the other listeners strangers can trigger. Auto-replies were already limited (welcome once, away once per 12 h), and filters and AFK notices had cooldowns. Campaigns and quizzes only react.

### Checked
- 4 tests (247 in total), including floods from several numbers in a group.

## 2.32.0 — 2026-10-08

### Fixed
- **Private messages became 8× slower with `.greet` on.** Every message listed the whole greeted list (up to 50,000 fingerprints) and went through a save. A known person now costs one hash and one lookup with no write, and the list is trimmed in batches of 1,000. Measured: 0.858 → 0.110 ms per private message with 50,000 fingerprints.
- **`.help` didn't understand Arabic section names**: `.help عقارات`, `.help إسلاميات` and `.help أدوات` found nothing, because only Latin letters were compared, and "real estate" with a space didn't work either. Every section now has Arabic names, with or without "ال", and the `.help` overview shows an Arabic example.

### Checked (health check)
- With every feature on: 0.067 ms per group message, 0.110 ms per private message, 108 ms to load 329 commands and 32 listeners, 23 ms to save all data, 68 MB memory.
- `.help` is 1,300–1,400 characters and `.menu` 8,600–10,700 characters, well under WhatsApp's limit; a test now guards this.
- 4 tests (243 in total).

## 2.31.0 — 2026-10-08

### Added
- **`.greet`**: a welcome on a person's first private message. Who was greeted is stored as salted SHA-256 fingerprints, never phone numbers.
- **`.awaymsg`** (`.offhours`): an automatic reply outside working hours (or always), once per person per 12 h. Neither replies in groups, to staff, to commands or to messages already answered. Both run after the PM blocker.
- **`.rehelp`**: an Arabic, step-by-step guide to the real-estate tools that marks the steps already done and points to the next one.
- **Arabic times** in `.remind`, `.lead follow` and `.viewing add`:
  - tomorrow/today: بكرة، غداً، النهارده;
  - weekdays (with or without يوم);
  - الساعة with ص/م/صباحاً/مساءً/الضهر/العصر;
  - بعد ساعتين / بعد 3 أيام / بعد نص ساعة;
  - كل يوم / كل خميس;
  - Arabic digits.

  Only the leading time phrase is converted; the rest of the text is never changed.

### Fixed (before release)
- The guide first showed "بكرة 4م" as an example, which the time parser didn't understand. This is why Arabic time support was added.

### Checked
- 4 tests (239 in total).

## 2.30.0 — 2026-10-08

### Added
- **`.backup photos`**: the listing photos as a `.tar.gz`, and `.restore` on that file, with a preview first and `confirm` to apply. Before this the photos had no backup from chat.
- `services/tar.js`: a minimal ustar `.tar.gz` writer and reader, with no new dependency. Its archives open with the standard `tar`, and archives made with `tar -czf … listings` are read.

### Security (restoring a file received in a chat)
- Only entries named exactly `listings/<number>/<number>.jpg` are used, and the path written to is built from those numbers, never from the archive's name. `../` and absolute names can't escape the folder.
- Links, devices and other non-regular entries are never read. Folders are ignored.
- Each photo must start like a JPEG, be at most 10 MB, have a photo number of 1–10, and belong to an existing listing. Files are written to a temporary name, then renamed.
- Decompression is capped while inflating (a 260 MB "zip bomb" in a 260 KB file is refused), and damaged headers (checksum) are refused.
- Tested with hostile archives: path traversal, absolute paths, a symlink, a fake JPEG, unknown listings, out-of-range numbers. Nothing was written outside the photos folder.

### Checked
- 4 tests (235 in total).

## 2.29.0 — 2026-10-08

### Added
- **Free-text posts**: `.listing add` now reads details written as sentences, as most broker posts are:
  - area after في/بكمبوند/منطقة, stopping at the next detail;
  - size (متر، م، م²، sqm), rooms (غرف، أوض، غرفتين), baths (حمامين، وحمامين), floor, finishing;
  - the price after a price word, or the first amount in millions/thousands that isn't next to مقدم/قسط/وديعة.

  Labelled lines still win over a value found in a sentence.
- **`.listing add ai`**: the configured AI extracts the fields as JSON, which is then checked: known types and deals only, numbers in range (e.g. 99 rooms is dropped), unknown keys dropped, prose around the JSON tolerated. An unreadable answer saves nothing.
- **Clients in a sentence**: area, rooms, and a budget when it's signalled (ميزانية، في حدود، لحد، حتى، budget, or "من 2 ل 3 مليون"). A lone number is never taken as a budget.

### Checked
- 4 tests (231 in total) with real-style posts in Arabic and English.

## 2.28.0 — 2026-10-07

### Added
- **`.import listings | leads`**: reply to a CSV file.
  - English (`.export`'s columns) or Arabic headers.
  - Comma or semicolon files; Excel's UTF-8 marker; quoted cells with commas, quotes and line breaks.
  - Statuses and budgets are kept; duplicates are skipped. Problems are reported by spreadsheet row number, which stays right after empty rows and multi-line cells.
  - Checked as an export → import round trip.
- **`.digest`**: a morning summary with today's viewings and follow-ups (and overdue ones), new clients, clients untouched for 7+ days, and catalogue counts. Once a day, listed in `.autos`.
- **Teams**: `.lead assign 5 @member|me|none` (owner or sudo users), `.leads mine`, and follow-up reminders mention the assignee.
- **`.listing add` warns about a likely duplicate** (same type, deal, price, size and location, ignoring diacritics and spacing).

### Checked
- 6 tests (227 in total).

## 2.27.0 — 2026-10-07

### Fixed
- **Arabic property words matched inside other words.** As a result:
  - "حي الربيع" (a district) contains "بيع", so a rental there was read as for sale;
  - "المحلة" contains "محل", so it was read as a shop;
  - "الدور الأرضي" (ground floor) contains "أرض", so it was read as land;
  - a search for "الكلية" turned on "all", because "كلية" contains "كل".

  Type, sale/rent and search words now match whole words only, with the usual Arabic prefixes (و ف ب ك، ال لل ل), so "للبيع", "الشقة", "وفيلا" and "بالإيجار" still work.

### Added
- **`.viewing` / `.viewings`**: viewing appointments (client, listing, time) with a reminder to the agent an hour before, an optional confirmation to the client, the client moved to "viewing", and a history note.
- **`.commission`**: brokerage commission with optional VAT and split.
- **Price cuts**: `.listing edit` with a lower price names the clients whose budget the listing now fits.

### Checked
- 5 tests (221 in total).

## 2.26.0 — 2026-10-07

### Added — getting listings to clients
- **`#12` in any chat** shows that listing with its photo (Arabic digits work). A note saved as "12" still takes precedence.
- **`.agent autoleads on`**: a private question about a listing (`#12`) creates a client, or adds a note to the existing one, and the owner gets a 🔔 message. Groups and staff are never captured.
- **`.autolistings`**: a listing of the day per chat at a set time. It's a flyer with details, rotating through available listings (optionally filtered by a search) and skipping reserved or sold ones. It's posted up to 3 hours late after downtime, retried after failures, listed in `.autos`, and stopped when the bot leaves the group.
- **`.brochure`**: a PDF catalogue with one flyer per page (up to 20, filterable).
- **`.export listings | leads`**: CSV for Excel/Sheets, with a UTF-8 byte-order mark (so Arabic shows correctly) and proper quoting of commas, quotes and line breaks.
- **`.market`**: average and median price per m² from your own sale listings, by area words and by type.

### Changed
- Showing a listing is shared between `.listing` and the new `#12` lookup (`services/listingview.js`).

### Checked
- 4 tests (216 in total).

## 2.25.0 — 2026-10-07

### Added — clients for real-estate agents
- **`.lead` / `.leads`**: a client tracker (owner and sudo users only).
  - Clients are saved from labelled lines or from a shared contact card (vCard).
  - Phone numbers are normalised to international form using the owner's country code (0100… → 20100…, 05… → 9665… for a Saudi owner), and duplicates are refused.
  - Budgets are read as ranges ("2-3 مليون", "800 ألف - 1.2 مليون").
  - Notes history, a pipeline status, follow-up reminders (their own loop, so the 10-reminder limit of `.remind` doesn't apply), and search by name, number, area or notes.
- **Matching both ways**: `.lead 5` lists the listings that fit (type, sale/rent, rooms, area words, budget with up to 10% over flagged), with within-budget ones first. `.listing add` names the saved clients a new property suits, and `.listing match 12` lists them. A client without any wishes yet matches nothing rather than everything.
- **`.lead send 5 12`**: sends a listing to the client's WhatsApp, after checking the number is on WhatsApp. It's recorded in the history.

### Checked
- 2 tests (212 in total): parsing (numbers, budgets, vCards) and the whole flow from chat, including matching, follow-up timing, sending, and that other users can't see clients.

## 2.24.0 — 2026-10-07

### Added — real-estate marketing (new help section "🏠 Real estate · عقارات")
- **`.listing` / `.listings`**: a property catalogue.
  - Add from a description written as labelled lines (Arabic or English labels, Arabic digits, "3.5 مليون", "750 ألف", emoji bullets), or by replying to a forwarded broker post.
  - Up to 10 photos per listing (stored as JPEG in `DATA_DIR/listings/`); edit, status (available/reserved/sold/rented), delete.
  - Search by type, sale/rent, price range, rooms and location words.
  - Anyone can view and search; the owner and sudo users manage.
- **`.agent`**: your name, phone, company and currency, shown on everything.
- **`.flyer`**: a 1080×1350 image for status/Instagram, drawn with sharp. Arabic lines are laid out right-to-left and phone numbers are isolated, so "+20 100 123 4567" keeps its order. That was checked visually; the first draft showed it reversed.
- **`.watermark`**: your name and phone on a property photo.
- **Calculators**: `.installments` (developer plans without interest, maintenance deposit), `.mortgage` (annuity; 800,000 at 12% over 20 years = 8,808.69/month, matching standard tables), `.ppm`, `.roi`.
- **`.adcopy`**: an AI-written marketing post for a listing or a replied-to description (Arabic or English, short or formal). It is told to use only the given facts.

### Checked
- 5 tests (210 in total): parsing real-style posts, every calculator, the whole catalogue flow from chat including permissions and photo deletion, and the AI prompt's contents.

## 2.23.0 — 2026-10-07

### Added
- **Website checks**:
  - `.dns`: A/AAAA/CNAME/MX/NS/TXT records.
  - `.ssl`: certificate issuer, trust, names and expiry (⚠️ within 14 days).
  - `.up`: HTTP status, response time and redirects; `http://` links work.

  They use the same protection as every other request: names that resolve to internal addresses are refused (checked with a name pointing at 127.0.0.1). Checked live: expired.badssl.com is reported as expired, self-signed.badssl.com as not trusted.
- **`.smeme`**: meme captions on a picture (white text, black outline, sized and wrapped to fit, Arabic shaped right-to-left). Made with sharp on the server.
- **`.cal`**: a month calendar with today marked. The week can start on Monday, Sunday or Saturday, and the Hijri months spanned are shown.
- **`.split`**: splits a bill with an optional tip, in cents, so the shares always add up to the total.

### Changed
- `.whois` and the new website checks share one domain parser (links, emails, international domain names).

### Fixed (before release)
- `.dns` first sent its six queries in parallel. Some DNS servers then answer far more slowly (measured: 8–11 s instead of about 3 s), and every type timed out, so the reply was "no records". Queries now go one at a time, with a per-query timeout and an overall limit.

### Checked
- 6 tests (205 in total).

## 2.22.0 — 2026-10-07

### Added
- **`.tz`**: converts a time between two cities, or compares their current times. Daylight saving time is included, and half-hour zones work.
- **`.days`**: a date calculator. It gives days until/since a date, days between two dates, and the date N days from today, with the result in years/months/days and weeks. Invalid dates such as 31/02 are rejected.
- **`.color`**: a colour swatch drawn locally (sharp) with HEX, RGB and HSL, plus the more readable text colour (WCAG contrast). Accepts `#09f`, `rgb()` and 35 colour names.
- **`.topdf`**: one or more pictures to a PDF, A4 and oriented to match each picture. The PDF is written directly (JPEG embedded as-is), so no new dependency is needed. Grayscale and transparent pictures are handled. Checked by opening the result in Chrome's PDF viewer.
- **`.ocr`**: text from a picture via the configured AI (Claude, Gemini or OpenAI-compatible).
- **`.whois`**: domain registration data from RDAP (dates, registrar, status, name servers). It falls back to the parent domain for subdomains.

### Fixed
- `.age` counted "today" in UTC, so for a few hours each night (east of UTC) it was a day behind. It now uses the bot's time zone.

### Checked
- 7 tests (199 in total). Live: conversions Cairo→London (−2 h), New York→Tokyo (+13 h), Sydney→Dubai (−7 h, Sydney summer time), RDAP for github.com.

## 2.21.0 — 2026-10-07

### Added
- **`.quranquiz`: "which surah is this verse from?"** A random verse (quran-uthmani from alquran.cloud), not the first of a surah and 25–220 characters long, with four choices: the answer, two surahs near it in the mushaf and one random. The first right number within 45 s wins a point, with one try per person and a quiet ❌ for wrong answers. Leaderboard with `.quranquiz top`; scores are removed when the bot leaves the group. Checked live: questions from al-Kafirun 109:4 and az-Zukhruf 43:53 with nearby surahs as choices.
- `.mathquiz` and `.quranquiz` don't run at the same time in a chat (both take plain numbers as answers).

### Checked
- 3 tests (192 in total).

## 2.20.0 — 2026-10-06

### Added
- **Adhkar after each prayer**: `.autoprayer azkar on [10–60]` sends chapter 25 of Hisn al-Muslim N minutes after each adhan (default 25). Following the book's own notes, the dhikr said 10 times after Fajr and Maghrib appears only after those two prayers, and the dua after Fajr only after Fajr. Shown in `.autoprayer` and `.autos`; kept when the city changes.
- **Adhkar before sleep**: `.autoazkar sleep 22:30` adds the sleep adhkar (chapter 28) as a nightly message, next to the morning and evening adhkar and the dua.

### Fixed
- **The owner/sudo identity refresh (2.18.2) ran on every reconnect.** On an unstable connection that meant reading every group's member list many times an hour, which can hit WhatsApp's rate limits. It now runs at most every 30 minutes, or right away when the owner/sudo list changed. A failed refresh is retried on the next connect.

### Checked
- 4 tests (189 in total).

## 2.19.0 — 2026-10-06

### Added
- **`.autodl`: automatic downloads in a group** (off by default; group admins). Short-video links (TikTok, Instagram, Facebook, X, Threads, Snapchat, Pinterest, YouTube Shorts) are downloaded and sent back. It runs in the background so other messages aren't held up. Limits: one at a time per group, 15 s apart, 30 an hour. Failures get only a ❌ reaction. Listed in `.autos`, and removed when the bot leaves the group.
- **Reply to a link** with `.dl`, `.tiktok`, `.facebook`, `.instagram`, `.twitter`, `.song`, `.video` … to download it.
- **`.todo`**: a shared to-do list per chat. Anyone can add tasks and tick them off; the author or an admin can delete a task; admins can clear the list. Up to 50 tasks.

### Fixed
- **Photos in downloaded posts were sent as broken "videos".** Every item was sent as `video/mp4`. Items are now sent by type (photo, audio, video), and the title is captioned once instead of on every item.
- A test loaded listeners with an incomplete capability list. It now uses the same full list as the bot.

### Checked
- 4 tests (185 in total).

## 2.18.3 — 2026-10-06

### Fixed
- **Downloaded videos (Facebook especially) showed "something is wrong with the video file" in WhatsApp.** Facebook's separate (DASH) video streams are all AV1, and the old format rule fell back to merging one of them with the audio when no ready-made file matched. WhatsApp plays only H.264 video with AAC audio on every phone.
  - The format rule now prefers, in order: a ready-made H.264 MP4, H.264 video + AAC audio, any ready-made MP4 (Facebook's "hd"/"sd" files are H.264), and only then anything else. YouTube still gets the same small H.264 file as before.
  - After downloading, ffmpeg checks the codecs. AV1, VP9 or Opus is converted to H.264 (High, yuv420p, at most 1280 px), with AAC audio and `+faststart`; the right codecs in another container are only re-packed. Photos in Instagram/X posts are not touched.
  - Checked live: Facebook's AV1 720p stream was detected and converted in 2 s to H.264 720×1280 with the AAC audio kept. The reported share link downloads as H.264/AAC without conversion.

### Checked
- 2 tests (181 in total).

## 2.18.2 — 2026-10-06

### Fixed
- **Sudo users were sometimes not recognized:** no reply at all in private mode, or "only for the bot owner and sudo users" in public mode. WhatsApp often sends messages with only the sender's LID, without the phone number. The bot linked LIDs to phone numbers only from messages that carried both, and kept those links in memory, so they were lost on every restart. A sudo user stored by number was then a stranger until such a message arrived. Reproduced with the real dispatcher: LID-only messages from a sudo user got no reply in private mode.
  - On every connect the bot now asks WhatsApp for the LID of each owner and sudo number (one `onWhatsApp` query). It also reads the member lists of its groups (one `groupFetchAllParticipating` query; each entry has both forms). Nothing is written to disk. Owners without `OWNER_LIDS` benefit too.
  - `.sudo add` looks the number up right away and saves both the phone number and the LID. `.sudo list` shows one line per person (✓ = both known). `.sudo del` removes every form.

### Checked
- 3 tests (179 in total).

## 2.18.1 — 2026-10-06

### Fixed
- **Facebook "Share" links failed to download** (`.facebook`, `.dl` …) with "No downloadable media was found". Links like `facebook.com/share/r/…`, `/share/v/`, `/share/p/` and `fb.watch/…` are not supported by yt-dlp ("Unsupported URL"). Facebook also answers them with HTTP 400 for browser-like clients. The bot now reads the one redirect Facebook gives its link-preview crawler (it doesn't download the page) and downloads the real post (`facebook.com/reel/<id>/`). The target is used only if it is https, still on Facebook and not the login page, and tracking parameters are removed. If anything fails, the original link is used as before. Checked with a real share link: resolved and downloaded (5.7 MB, 7 s).
- A test of `.autotafsir` depended on the time of day (it failed in the evening because of quiet hours).

### Added
- `core/http` `request(…, { followRedirects: false })` returns a redirect without fetching its target.

## 2.18.0 — 2026-10-06

### Added
- **`.qsearch`: Quran search** by word or phrase, in Arabic (diacritics removed, so typed text matches) or the English translation, with pages of 10 results (alquran.cloud search API).
- **Surah names everywhere**: `.quran`, `.tafsir` and `.surah` accept `البقرة 255`, `سورة الكهف 10`, `baqarah 255`, `yaseen`, Arabic digits, and some well-known other names (ياسين، تبارك، عم …). English spellings that differ only in vowels are matched only when one surah fits, so the bot doesn't guess between similar names. Asking for a verse past the end of a surah (`الفاتحة 8`) says how many verses it has.

### Changed
- The list of 114 surahs is bundled (`assets/quran-surahs.json`, from alquran.cloud `/meta`; 6,236 verses). `.surah` no longer downloads the list first.

### Checked
- `.backup` includes every data file, including the new ones from 2.14–2.17, because it lists `DATA_DIR` and has no fixed list.
- 4 tests (173 in total); every surah is found by its Arabic and English name.

## 2.17.0 — 2026-10-06

### Added
- **`.hamla`: a group dhikr campaign** (حملة ذكر) with a shared goal, e.g. `.hamla new 10000 استغفار`. Members add their count by sending `+100`; the bot reacts 📿 instead of replying, so the chat stays readable. It announces 25/50/75 % and the finish with the top 5 readers. It also has presets for the common adhkar, `undo` for a typo, and a 10,000 limit per message. Phone numbers ("+2010…") are not counted. It appears in `.autos` and is removed when the bot leaves the group.
- **Group rules**: `.setrules` (admins), `.rules` (everyone; falls back to the group description), `.delrules`. They are the `#rules` note, so existing `#rules` notes keep working. A new `{rules}` variable is available for `.welcome`.

### Fixed
- **Welcome/goodbye text could be mangled** when the group name, description or rules contained `## 2.16.0 — 2026-10-06`, `

### Added
- **`.siyam`**: the sunnah fasting days coming up. These are Mondays and Thursdays, the white days, Arafah, Tasu'a and Ashura, and the start of the six days of Shawwal, plus the dates of the next Arafah and Ashura. Days when fasting is not allowed (the Eids and the days of Tashreeq) are never suggested, and nothing is suggested in Ramadan. Dates use the Umm al-Qura calendar offline and were checked against aladhan.com's conversion.
- **`.autosiyam`**: a reminder the evening before each sunnah fast (default 20:00). It says why tomorrow is recommended and is quiet on other days. `weekly off` keeps only the white days and the special days. It is listed in `.autos`, stopped by `.autos off`, and stopped when the bot leaves a group.
- **`.khatma remind`**: mentions members whose juz' aren't read yet, longest first, at most once an hour.

### Checked
- 4 tests (166 in total).

## 2.15.0 — 2026-10-06

### Added
- **`.khatma`: a shared group khatma** (ختمة جماعية). Members take one of the 30 juz' (`.khatma take` / `.khatma take 5`), mark it read (`.khatma done`) or give it back (`.khatma drop 5`). `.khatma` shows the board with a progress bar and mentions. Completion is announced and the next khatma is numbered. Each juz' start (surah and verse) and page range come from `assets/quran-juz-ar.json`, built from alquran.cloud's `/meta`. Arabic digits are accepted (`.khatma take ٥`).
- **`.autojumuah`: a Friday reminder** every week at a chosen time (default 09:00): the verse 62:9, the sunnahs of the day, and the salawat texts from Hisn al-Muslim. The verse is bundled exactly as returned by alquran.cloud (quran-uthmani). `.autojumuah now` previews it.
- `.autos` lists both. `.autos off` also stops the Friday reminder. The khatma is removed only when the bot leaves the group.

### Changed
- `.khatma` was an alias of `.autowird`; it is now the group khatma. `.autowird` / `.dailywird` are unchanged.

### Checked
- 4 tests (162 in total).

## 2.14.0 — 2026-10-06

### Added
- **`.recap`** (also `.catchup`, `.missed`): "what did I miss?" in a group. The AI summarizes the last 100 messages (10–200): topics, decisions, open questions. Recent group text is kept in memory only (200 messages per group, 500 characters each, at most 300 groups; never on disk; commands are skipped) and only when an AI key is set.

### Fixed
- **Automatic posts kept trying in groups the bot had left.** When the bot leaves (`.leave`, `.leavegroup`) or is removed from a group, its adhkar, prayer alerts, tafsir/dua/hadith posts, wird, announcements, group schedule, captcha (and its pending questions) and recap memory there are now stopped. `.leavegroup` says what it stopped.
- **Failed repeating posts retried every 10 minutes forever.** They now back off (10, 20, 40 … minutes, up to every 6 hours). Posts whose content source is down keep retrying; posts that can't be *sent* to the chat 12 times in a row are stopped.

### Changed
- `.autos off` and the leave clean-up share one code path (`services/automations.js`).

### Checked
- 4 tests (158 in total).

## 2.13.0 — 2026-10-06

### Fixed (found by checking the code against Baileys 6.7.24's real event format)
- **Captcha could remove real members in LID groups.** The join event and the member's messages can name the same person by LID and by phone number. The answer is now matched against all of a member's known ids.
- **Captcha and the welcome message treated the bot itself as a new member** when it was added to a group. The bot is now skipped.

### Changed
- **`.help` is a short overview** (about 1,200 characters instead of 7,900): each section with its size and most useful commands. `.menu` / `.help all` give the full list as plain text instead of a long image caption; `.menu <section>` still opens one section.
- **Menus show what you can use.** Owner-only commands appear only for the owner, and sudo commands for owner/sudo. Anyone can still ask `.help <command>`.

### Checked
- Performance with every protection and listener switched on (25 listeners, 50 auto-replies, antilink, antibadword, antispam, levels, activity): **0.06 ms per incoming message**, 48 MB heap after 5,000 messages.
- 3 tests (154 in total).

## 2.12.0 — 2026-10-06

### Added
- **`.captcha on|off|time <1-10>`** (group admins): new members who join by link must answer a small sum within N minutes, or they are removed. Arabic digits are accepted, their other messages are deleted until they answer, and 3 wrong answers also remove them. Members added by an admin skip the check. This stops spam bots.
- **`.imsakiya <city>`**: the Ramadan timetable (Imsak, Fajr, Maghrib for each day) of the current or next Ramadan for any city (aladhan.com).
- **`.iftar <city>`**: time left until Maghrib/iftar and Imsak/suhoor. Near iftar during Ramadan it adds the iftar dua from the bundled Hisn al-Muslim.
- **`.autos`**: everything automatic in a chat in one list; `.autos off` stops all automatic Islamic posts there at once.
- Prayer times now include Imsak.
- 4 tests (151 in total).

### Changed
- Arabic durations use correct number forms (ساعة و5 دقائق، ساعتان، دقيقتين).

## 2.11.0 — 2026-10-06

### Added
- **Daily Quran reading (الورد اليومي)**:
  - `.autowird on [pages 1-20] [time]` sends that many mushaf pages every day at that time, in order from page 1 to 604, then starts a new khatma and counts it.
  - `.autowird` shows the position, pages left and estimated days to finish. `.autowird page <n>` moves the position; `.autowird off` stops.
  - `.wird` sends the next portion now; `.wird page <n>` shows any page.
  - Page text is from alquran.cloud. Each surah's basmala is shown on its own line as in the mushaf (it's verse 1 only in al-Fatiha, and At-Tawbah has none). Verse numbers are in Arabic digits ﴿١﴾.
- **Hadith**:
  - `.hadith [id]` gives a random hadith, weighted so every hadith has the same chance, with its grade (درجة), source (رواه) and a short explanation, from موسوعة الأحاديث النبوية (hadeethenc.com, public developer API, credited in each message).
  - `.autohadith every <hours>` posts one every 1–24 hours, the first right away, with the same quiet hours.
- **`.zakat <amount> [currency]`**: nisab by gold (85 g) and silver (595 g) at today's price, and the 2.5 % due.
- **`.gold [currency]`**: price per gram for 24k/21k/18k gold, the ounce, and silver (gold-api.com spot price).
- 5 tests (147 in total).

## 2.10.1 — 2026-10-06

### Fixed
- **Automatic Islamic posts didn't arrive, or came at the wrong hour.** Without `TIMEZONE`, the bot used the server's time zone, which on most VPSs is UTC. Repeating posts were then held as "night" (quiet hours) until 07:00 UTC, and `.autoazkar` used UTC times.
  - When `TIMEZONE` is not set and the server is on UTC, the bot now uses the owner's country, from the first number in `OWNER_NUMBERS` (single-zone countries only, e.g. 20 → Africa/Cairo, 966 → Asia/Riyadh).
  - The chosen zone and why are in the startup log and in `.doctor`.
- `.autotafsir every N` and `.autoazkar dua every N` post the first verse/dua **immediately**, then every N hours. Before, they said "within a minute", but quiet hours could hold the post.

### Changed
- `.autoazkar`, `.autotafsir` and `.autoprayer` replies show the **next message and when it comes** ("⏭️ التالي: أذكار المساء الساعة 17:00 (بعد 8 س 12 د)"). They also show the bot's time zone and current time, with a hint to set `TIMEZONE` when it's only the server's UTC.
- 5 tests (142 in total). The fix was also checked with the real timers on a simulated UTC server.

## 2.10.0 — 2026-10-06

### Added
- **`.autotafsir every <hours>`**: a random verse with al-Tafsir al-Muyassar posted to the chat every 1–24 hours (`.autotafsir on` = every 3 hours; `.autotafsir off`).
- **`.autoazkar dua every <hours>`**: a random dua every 1–24 hours instead of once a day.
- **Quiet hours** for these repeating posts, default 23:00–07:00 in `TIMEZONE`: posts due then wait until morning. `.autotafsir quiet 22:00-06:00` changes them, `.autotafsir quiet off` removes them. If the Quran API fails, the post is retried 10 minutes later.
- `.tafsir` without a reference gives a random verse.
- 5 tests (137 in total).

### Changed
- **No admin needed**: any group member can now turn `.autoazkar`, `.autoprayer` and `.autotafsir` on or off. The owner can restore the admin-only rule with `.setvar ISLAMIC_ADMIN_ONLY true` (or in `.env`).

## 2.9.0 — 2026-10-06

### Added
- **Prayer-time alerts** (`.autoprayer on <city>` / `.adhan`, `.autoprayer off`): "حان الآن موعد أذان …" in the chat at each of the five prayers, in the city's own time zone (aladhan.com). Each is sent once and never more than 20 minutes late. Group admins only in groups.
- `.hijri`: today's Hijri date (Umm al-Qura, offline).
- `.ramadan`: countdown to Ramadan, Eid al-Fitr, Arafah, Eid al-Adha, the Hijri new year and Ashura.
- `.tafsir 2:255`: the verse with al-Tafsir al-Muyassar.
- `.surah <name|number>`: full recitation by Mishary Alafasy. Matches Arabic names typed with or without diacritics, English names and numbers; surahs over `MAX_DOWNLOAD_MB` come as a link.
- `.quran 2:255 audio`: the verse's recitation.
- `.qibla <city>` and `.asma [n|all]` (the 99 names).
- 5 tests (132 in total).

### Fixed
- `.autoazkar city` compared the city's prayer times with the bot's `TIMEZONE`. For a city in another time zone, the adhkar came at the wrong hour. Times now follow the city's own clock, through a shared prayer-time service (`services/prayertimes.js`) that asks aladhan for that city's local date.
- The HTTP client returns `HEAD` responses without trying to read or decompress a body.

### Changed
- `.prayer` alias `adhan` → `mawaqit` (`.adhan` is now the alerts).

## 2.8.0 — 2026-10-06

### Added
- **Adhkar and duas (الأذكار والأدعية)** from Hisn al-Muslim (حصن المسلم), bundled with the bot (`assets/hisnmuslim-ar.json`: 132 chapters, 267 adhkar, from the official hisnmuslim.com API; "حقوق الطبع لكل مسلم"). The Quran passages in the morning/evening adhkar were verified letter by letter against alquran.cloud. `scripts/fetch-hisnmuslim.js` refreshes the file.
  - `.azkar [صباح|مساء|نوم|استيقاظ|صلاة]`: chooses morning or evening by the time of day. It follows the book's notes on morning-only and evening-only entries, and adds a Surat al-Kahf reminder on Friday mornings.
  - `.dua [topic]`: a random supplication from the general dua chapters (supplications only, not the hadiths about virtues), or from chapters matching a topic.
  - `.hisn [number|word]`: browse all 132 chapters.
  - **`.autoazkar`**: sends the morning and evening adhkar to a group or private chat every day, plus an optional daily dua; `.autoazkar off` stops it.
    - Fixed times (default 06:30 / 17:00), or `.autoazkar city Cairo` for 30 minutes after Fajr / Asr (aladhan.com).
    - Group admins control it in groups. Sends at most once per day per message, catches up after downtime (up to 3 h), and never sends late for times already passed when it is turned on.
- New 🕌 Islamic section in `.help`; `.prayer` and `.quran` moved there.
- 5 tests (127 in total).

## 2.7.0 — 2026-10-06

### Added
- **Backup and restore from WhatsApp** (owner, private chat):
  - `.backup` sends a JSON file of every setting and list.
  - `.backup full` adds API keys set from chat and cookies.
  - `.restore` (reply to the file) shows what's inside and applies it after `.restore confirm`, without a restart. File names with path tricks are ignored.
  - The WhatsApp session is never included.
- **Scheduled announcements** to a group: `.announce every day at 08:00 …`, `.announce at 21:00 …`, `.announce list|del` (group admins). Plain text, no mentions, at most 10 per group.
- **Weekdays** for `.remind` and `.announce`: `friday at 20:00`, `every monday at 9am` (a weekday alone means 09:00).
- **`.inactive [days]`** (group admins): members who haven't written for N days, listed by number without pinging anyone. Only the time of each member's last message is stored.
- **`.welcome test` / `.goodbye test`** preview, and a `{count}` variable (member count).
- 6 tests (122 in total).

### Changed
- Welcome/goodbye building moved to `services/greetings.js`, shared by the listener and the preview.

## 2.6.0 — 2026-10-06

### Added
- **Levels**: members earn XP by chatting (15–25 per message, once a minute; commands don't count).
  - `.rank` sends a level card; `.leaderboard` shows the top 10.
  - `.levelup on|off|reset` (group admins) controls level-up announcements, which are off by default.
- **Antilink allow-list**: `.linkallow youtube.com` lets that domain and its subdomains through. Look-alikes such as `youtube.com.evil.example` are still removed.
- **Command rate limit per person**: `COMMANDS_PER_MINUTE`, default 15; owner and sudo exempt. This protects the bot's number from being flagged for spam.
- **Job queue for heavy work**: at most `MAX_PARALLEL_JOBS` (default 2) yt-dlp/ffmpeg processes run at once and up to 25 wait, so a busy group can't overload the server. `.doctor` shows the queue.
- **"Update finished" message**: after `.update now` or `.restart`, the bot reports the version it now runs once it's connected again.
- 9 tests (116 in total).

### Changed
- **Welcome/goodbye pictures are drawn on the server** with sharp instead of a third-party image API. New members' photos and numbers are no longer sent to some-random-api.com, and the card works even when that service is down. Arabic group names render correctly.

## 2.5.0 — 2026-10-06

### Added
- **Auto-replies** per group: `.filter <trigger> | <reply>` (or reply to a message), `.filters`, `.stopfilter`. Whole-word matching in any language. Rate-limited so it can't flood a group or loop with another bot.
- **Daily group open/close**: `.gcschedule close 23:00`, `.gcschedule open 08:00`, `.gcschedule off`. Uses `TIMEZONE`, runs once a day, and catches up after downtime (up to 3 h).
- **Owner group tools**:
  - `.groups` lists every group with member counts and admin status; `.leavegroup <number>` leaves one.
  - `.join <invite link>`.
  - `.block` / `.unblock` (the owner can't be blocked).
- **Animated sticker → video/GIF**: `.tovideo` (plays like a GIF; needs ffmpeg) and `.togif` (GIF file, no ffmpeg). sharp reads the animated WebP that ffmpeg can't.
- **Games**: `.rps` (rock-paper-scissors, also emoji and Arabic) and `.mathquiz [easy|medium|hard|top]` with points per group.
- 8 tests (107 in total).

### Changed
- **`.tts` speaks any language**: Arabic, Russian, Hebrew, Hindi, Chinese, Japanese, Korean, Thai and Greek are detected from the script; other languages take a code and a colon (`.tts fr: Bonjour`). It now sends a real voice note when ffmpeg is available. Aliases `.say`, `.speak`.
- **Unavailable commands explain themselves**: typing a command whose tool or key is missing (or `.help` for it) says it isn't available, instead of "did you mean". The owner also sees what it needs.
- `.transcribe` keeps the audio it sends to Gemini under the 20 MB request limit; videos may be larger, since only their audio is sent.

## 2.4.0 — 2026-10-06

### Added
- **AI pictures**: `.imagine <description>` draws a picture; reply to a photo with `.imagine <change>` to edit it (Gemini). Uses Gemini (`gemini-3.1-flash-image`, Interactions API, `store: false`) or OpenAI (`gpt-image-2.5-flare`).
- **Voice notes to text**: `.transcribe` (reply to a voice note, audio or video) in any language, optionally `translate <language>`. Uses Gemini or OpenAI (`gpt-transcribe`; audio converted to MP3 with ffmpeg, since OpenAI doesn't take Ogg).
  - Both work alongside Claude: keep Claude for chat and add a Gemini key for these.
- **AI memory**: `.ai` remembers your last 6 exchanges per chat for 30 minutes (follow-up questions work), and the group chatbot remembers the group conversation. Memory is kept in RAM only. `.aireset` forgets. `AI_MEMORY_TURNS`.
- **AI daily limit** per person (`AI_DAILY_LIMIT`, default 50; a picture counts 5; owner and sudo exempt), to keep API costs under control.
- **Audio effects** (ffmpeg): `.bass`, `.nightcore`, `.vaporwave`, `.slow`, `.fast`, `.deep`, `.chipmunk`, `.robot`, `.echo`, `.reverse`, `.8d`. Voice notes come back as voice notes.
- **Picture effects** on the server with sharp (nothing uploaded): `.grayscale`, `.invert`, `.sepia`, `.mirror`, `.flipimg`, `.rotate`, `.sharpen`, `.brighten`, `.saturate`, `.pixelate`, `.resize`, `.circlecrop`, `.compress`, `.toformat` (`.topng`/`.tojpg`/`.towebp`), `.imginfo`.
- **Reminders at a time and repeating**: `.remind at 18:30 …`, `.remind tomorrow at 9am …`, `.remind every day at 08:00 …`, `.remind every 2h …`.
- **Per-group command switches**: `.disable <command>`, `.enable <command|all>`, `.disabled` (group admins; owner/sudo unaffected; `.help` can't be disabled).
- **"Did you mean …?"** for mistyped commands (once per chat a minute; `SUGGEST_COMMANDS=false` turns it off).
- `.stats` (owner): most used commands and totals.
- `.crypto [coin] [currency]`: prices and 24 h/7 d change from CoinGecko, in any currency (information only).
- **yt-dlp auto-update** once a day (`YTDLP_AUTO_UPDATE=true`); `.doctor` shows the last result. Only yt-dlp is updated automatically, never the bot's code.
- 11 tests (99 in total). The ffmpeg features (audio effects, `.toaudio`, `.tovn`, video stickers) were also run against a real ffmpeg 8.1.

### Changed
- **`.sticker` and `.crop` work without ffmpeg** for pictures (made with sharp); ffmpeg is only needed for GIFs and videos. `.emojimix` no longer needs ffmpeg. Optional pack and author: `.sticker My Pack | Me`.
- **`.news` needs no API key**: Google News for any country and language (`.news`, `.news football`, `.news eg:ar`, `NEWS_REGION`). `NEWSAPI_KEY` is ignored.
- The group chatbot reports a reached daily limit instead of staying silent.

## 2.3.0 — 2026-10-06

### Added
- **Change settings from WhatsApp** (owner): `.vars` lists them with current values (keys hidden) and their source, `.setvar NAME value` changes one, `.delvar NAME` goes back to `.env`, and `.restart` restarts. Changes are validated first (invalid values are not saved), applied **without a restart** (config, AI client and command list are rebuilt; newly enabled/disabled commands are listed), and kept in `DATA_DIR/env-overrides.json`, which overrides `.env` and works under Docker too. Tool paths (`YTDLP_PATH`, `FFMPEG_PATH`) are test-run before saving.
  - About 30 settings are allowed: AI, bot name/prefix/stickers/time zone, API keys, limits, tool paths, log level. Owner numbers, folders, pairing, the update source and the health server deliberately stay in `.env`.
  - Secrets are refused in groups and never displayed. The message carrying them is deleted when WhatsApp allows it (sent from the bot's own account), and antidelete never keeps a copy.
- **Gemini and OpenAI-compatible AI**, besides Claude: `AI_PROVIDER` (`auto`/`claude`/`gemini`/`openai`), `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` (Groq, OpenRouter, DeepSeek, Mistral … any https endpoint), and per-provider models (`CLAUDE_MODEL`, `GEMINI_MODEL`, `OPENAI_MODEL`; defaults `claude-opus-5-5`, `gemini-3.8-flash`, `gpt-6-luna`). Images work with all three.
  - `.setai <provider> <key>` tests a key with a free request before saving it.
  - `.aimodel` lists the models your key can use and switches by number or name.
- **Login cookies per site from WhatsApp**: `.setcookie <site>` (attach or reply to cookies.txt, a Cookie-Editor JSON export, or paste `name=value; …`), `.cookies`, `.delcookie`. These cover YouTube, Instagram, Facebook, TikTok, X, Reddit, SoundCloud, Pinterest, Vimeo, Dailymotion, Twitch, Threads and Snapchat.
  - Only cookies for that site's own domains are kept. The files are stored with mode 600 and used by yt-dlp for that site's links.
  - The bot reports whether a logged-in session was found and when it expires. Owner only, private chat only.
- `.summarize` / `.tldr`: summarize (or ask a question about) a replied message, a web page, or a YouTube video via its captions.
- Notes: `.save <name> <text>`, `#name`, `.notes`, `.delnote` (admins in groups).
- `.antispam`: flood protection (more than N messages in S seconds → delete, warn or kick).
- Tools:
  - `.unit` converts length, weight, volume, area (incl. feddan/qirat), speed, temperature, data, time and energy.
  - `.age`, `.password`, `.hash`, `.base64`.
  - `.short` shortens links via TinyURL.
- Fun: `.roll 2d6`, `.flip`, `.pick a, b, c`, `.random 1 100`.
- 16 tests (settings, AI provider selection, cookies, notes, anti-spam, units …); 87 in total.

### Changed
- `.doctor` shows the AI in use, cookie sites and chat-changed settings. Its "how to enable" hints now use `.setvar` / `.setai`.
- The dispatcher reads the configuration per message, so a new prefix or cooldown applies at once.
- Re-checking tools after a settings change happens only when a tool path changed.
- Log redaction also covers the new keys, auth headers and cookies.

## 2.2.0 — 2026-10-06

### Fixed
- **yt-dlp "not installed" although it is.** `~` in `YTDLP_PATH` (and `FFMPEG_PATH`, `FONT_FILE`, `YTDLP_COOKIES`, `SESSION_DIR`, `DATA_DIR`, `TMP_DIR`) is now expanded to your home folder. Before, `YTDLP_PATH=~/.local/bin/yt-dlp` was taken literally, yt-dlp was not found, and every download command was hidden.
- A missing **ffmpeg** no longer hides `.video`, `.tiktok`, `.facebook`, `.instagram` (they fall back to single-file formats). Only `.song`, `.spotify`, `.igs`, stickers and the audio converters need it.
- Non-Latin titles from yt-dlp (Arabic, emoji …) are no longer garbled, and `.song` keeps Arabic song names in the file name.
- Network errors inside commands (DNS failure, connection reset) now show "the external service is not responding" instead of "Something went wrong".

### Added
- **Tool diagnostics.** Startup log, `npm run check` and the new **`.doctor`** (owner) show each tool's path and version, or exactly why it can't be used (`does not exist. Check YTDLP_PATH`, `chmod +x …`, not in `PATH` …). `.doctor` also shows connection, memory and uptime, lists disabled commands grouped by what they need, and says what to install or set for each.
- 🛠️ **Tools**: `.calc` (safe calculator, no `eval`), `.qr` / `.readqr` (make and read QR codes), `.currency` (exchange rates), `.remind` (persistent reminders: `10m`, `1h30m`, `2d` …, list/delete, delivered after restarts), `.poll` (native WhatsApp polls, single or multiple choice), `.afk` (away notices when you're mentioned), `.getpp` (profile or group picture), `.toaudio` (video → MP3), `.tovn` (anything → voice note).
- 📚 **Info & search**: `.wiki` (any language, e.g. `.wiki ar: القاهرة`), `.define` (English dictionary), `.time <city>`, `.prayer <city>` (today's prayer times and the next prayer), `.quran <surah:ayah>`.
- 📥 **Downloads**: `.yts` (YouTube search; then `.play 2` or `.video 2` picks a result), `.dl <link>` (one command for YouTube, TikTok, Instagram, Facebook, X/Twitter, Reddit, SoundCloud, Pinterest, Vimeo, Dailymotion, Twitch, Threads, Snapchat), `.twitter` / `.x`.
- 👮 **Group**: `.link` (invite link), `.lock` / `.unlock` (who may edit group info), `.leave` (owner).
- **`.ai` understands images**: send or reply to a photo or sticker (`.ai what does this say?`, or just `.ai` to describe it).
- **`.help <section>`** (`.help tools`, `.help info`, `.help downloads` …) lists one section with descriptions; mistyped names get "Did you mean …?".
- `TIMEZONE` setting (validated) for `.time` and `.remind`.
- 15 tests for the new features (calculator safety, reminders, AFK, help, polls, site detection …); 71 in total.

### Changed
- **`.weather` needs no API key** anymore: it uses Open-Meteo and adds a 3-day forecast. `OPENWEATHER_KEY` is ignored.
- New `.help` sections: 🛠️ Tools and 📚 Info & search (`.weather` moved to Info).

### Dependencies
- Added `qrcode` 1.5.4 and `jsqr` 1.4.0 (pinned). `npm audit`: 0 vulnerabilities.

## 2.1.0 — 2026-10-04

### Added
- **`.update`** (owner only): reports whether a newer version of the bot is on your GitHub repository (commits, version, last changes) and whether a newer **yt-dlp nightly** exists. **`.update now`** installs both:
  - yt-dlp: `yt-dlp --update-to nightly` (requires the standalone binary).
  - Bot: `git fetch` from `UPDATE_REMOTE`/`UPDATE_BRANCH` (default `origin`/`main`), fast-forward only, refused if the server has local changes or local-only commits; `npm ci` when `package.json`/`package-lock.json` changed; validated with `npm run check`, **automatic rollback** if validation fails; then a graceful restart through PM2/Docker.
  - Unlike the removed 1.x command (audit B-01), it accepts no URL or other input, never runs a shell, and cannot be used by sudo users.
- `UPDATE_REMOTE`, `UPDATE_BRANCH` settings (validated; option-like values are rejected).
- 11 tests for the updater (fake git and processes).

### Changed
- **yt-dlp nightly.** The Docker image now ships the official standalone nightly binary (SHA-256 verified at build time) in `/app/bin`, owned by the bot user so `.update now` can update it; Python is no longer installed in the image. The PM2 instructions install the same binary into `~/.local/bin`.
- **Deployment from GitHub.** The server is now a git clone of <https://github.com/akrmz/whatsagent> (public URL or a read-only deploy key), which is what makes `.update` work. The repository was published with a fresh history; the old local history containing leaked secrets was not pushed.

## 2.0.0 — 2026-10-04

A security-focused rewrite of both services. Your existing session (`MD-main/session/creds.json`) and the old `data/*.json` settings keep working; they are migrated automatically on first start.

### Before you upgrade (action required)

- **Configuration moved from `settings.js` to `MD-main/.env`.** Copy `.env.example` to `.env` and set `OWNER_NUMBERS` to your number **with country code** (the old `settings.js` had it without one).
- **Rotate every secret that was in the old code.** See "Actions you must take" in the security audit.
- The pairing service needs a `.env` with `PAIR_ACCESS_TOKEN`.
- Node.js **22.12 or newer** is required.

### Security fixes

Pairing service:
- **P-01** `?number=..` could delete any directory on the server. Input is now validated before any filesystem access, and temporary folders use random names in a private directory.
- **P-02** The whole project folder, including in-progress session credentials and `mega.js`, was served over HTTP. Now only `public/` is served.
- **P-03** Hardcoded Mega account credentials removed (`mega.js` deleted).
- **P-04** Pairing sockets were never closed, so the server stayed a linked device of every account that paired. The socket is now always closed after delivery, failure or timeout.
- **P-05** Strangers could use the page freely. It now requires an access token, rate-limits per IP, caps concurrent pairings, times out, and retries with bounded backoff.
- **P-06** References to a third-party hosted pairing server removed.
- **P-07/P-10** The session is now saved directly on the server by default instead of being sent through WhatsApp. Promotional messages removed.
- **P-08/P-09** Strict input validation, Helmet security headers and CSP, no CDN scripts, no error-swallowing global handlers, pairing codes never logged, phone numbers masked in logs.

Bot:
- **B-01** Removed `.update`, which downloaded and installed code from any URL or reset to the upstream repository (remote code execution).
- **B-02** Owner check rewritten. The old one matched substrings, let any `@lid` user in a group with the owner count as owner, and made everyone owner if the owner number was empty. Matching is now exact on normalized PN/LID IDs, and an empty owner list refuses to start.
- **B-03** Media from external APIs is downloaded into memory through the safe client and sent as a buffer. A malicious API can no longer make Baileys read local files such as the session.
- **B-04** `link-preview-js` removed, and link previews disabled. Echoing a user-supplied URL no longer makes the server fetch it (SSRF).
- **B-05** All hardcoded API keys and the Telegram bot token removed. Keys now come from `.env`, and commands without a key are disabled.
- **B-06** Sudo users can no longer add sudo users or use owner-only commands.
- **B-07** Antidelete is bounded (message count, 24 h age, media size), and media files are deleted on eviction.
- **B-08/B-18** Downloader links are validated against the exact site. Every outbound request goes through an HTTPS-only client that refuses private, loopback and link-local addresses at connect time, re-checks redirects, and caps size and time.
- **B-09/B-17** Every WhatsApp media download is size-checked. ffmpeg runs without a shell and with a local-file protocol whitelist. `.attp` text can no longer inject ffmpeg options.
- **B-10** Settings are written atomically. A corrupted mode file now fails closed (private) instead of open (public). Message counters are no longer rewritten synchronously on every message.
- **B-11/B-19** `.ban`/`.unban` are owner/sudo only, owners can never be banned, and `.sudo list` is owner only.
- **B-12/B-15** The chatbot sends only the triggering message (no history, no extracted personal details), and the abusive persona was replaced with a neutral, configurable one.
- **B-13** `.vv` (reveal view-once) is owner only.
- **B-14** Removed the self-hot-reload that started duplicate bot instances.
- **B-16** Removed the "Forwarded from Akram MD" newsletter label on every reply, the "join our channel" message on connect, upstream channel and support links, and upstream branding.
- **R-01** A working root `.gitignore` (the old one was UTF-16, which git cannot read) now excludes sessions, `.env` and runtime data.
- **D-01/D-02** Dependencies cut from 50 declared / 569 installed to 7 / 209 for the bot. All are pinned and the lockfiles committed. `npm audit`: 0 vulnerabilities (was 25, 5 critical). The pairing service also has 0.
- **Obfuscated dependency removed:** `ruhend-scraper` (used for Instagram/TikTok) hides about 62 KB of obfuscated code behind about 865,000 lines of invisible padding characters, and builds its `require()` targets at runtime. It was replaced by yt-dlp.

### Removed

| What | Why |
|---|---|
| `.update <url>` command | Remote code execution (B-01). A restricted replacement was added in 2.1.0. |
| `mega.js` | Unused; contained Mega credentials |
| Unwired `commands/pair.js` | Sent your number to a third-party pairing server |
| Unwired `gif.js`, `sticker-alt.js`, `lib/ytdl2.js`, `lib/myfunc2.js`, `lib/sticker.js`, `lib/antilinkHelper.js`, `lib/tempCleanup.js`, `.move` | Dead or broken code |
| `data/owner.json`, `data/premium.json` | Upstream author's phone numbers (they were never used for permissions) |
| `.github/FUNDING.yml`, `assets/bmc_qr.png` | Upstream author's donation links |
| `assets/rapid.jpg`, `stickintro.webp`, `sticktag.webp` | Unused |
| Newsletter decoration, connect promo, upstream button replies, pairing promo messages | Unwanted advertising |
| `fs.watchFile` self-reload, RSS self-kill at 400 MB, `global.gc` timer | Caused duplicate instances and crash loops. PM2/Docker memory limits are used instead. |
| `.imagine`/`.flux`/`.dalle` and `.sora` | Their free APIs no longer return images or video (checked 2026-10-04), and Claude has no image generation |
| `.loli` alias | Mapped to an unsupported type and only returned an error |
| `baileys_store.json` | Recent messages are now kept in memory only (bounded), not written to disk in plaintext |
| `settings.js`, `config.js` | Replaced by `.env` + `src/config.js` |

### Changed behaviour

- **Downloads:** `.song`/`.play`/`.mp3`/`.ytmp3`/`.music`, `.video`/`.ytmp4`, `.spotify`, `.tiktok`, `.fb`, `.instagram`, `.igs`/`.igsc` now use yt-dlp running on your server. The previous free download APIs were all dead or paywalled when checked on 2026-10-04. `.spotify` searches the track on YouTube. Instagram photo posts are not supported (videos only).
- **AI:** `.gpt`/`.gemini` (now aliases of `.ai`) and the group chatbot use Claude through the official Anthropic SDK with your own `ANTHROPIC_API_KEY`. The old free endpoints were dead or returned empty answers.
- **Lyrics** use lrclib.net (the old API was down). **Remove background** uses the official remove.bg API (needs `REMOVEBG_API_KEY`). **Remini** needs your own `REMINI_API_KEY`.
- **Need your own key now:** `.news`, `.weather`, `.emojimix`, `.tg`, `.removebg`, `.remini`, `.github` (`GITHUB_REPO`). They are hidden until configured.
- **Permissions are enforced centrally.** Denial messages are uniform. Non-admins using `.tag` get a text message instead of a sticker. Tagging commands no longer require the bot to be admin. `.settings` and `.cleartmp` are available to sudo users.
- **`.autoread` / `.autotyping` without arguments** show the status instead of toggling. Use `on`/`off`.
- **`.clearsession`** asks for `confirm` first.
- **`.quote` with text** no longer returns an anime quote; use `.animuquote`.
- **`.simpcard`** is now an alias of `.simp`, and `.its-so-stupid` an alias of `.stupid`. In the old router these were shadowed and never ran.
- **Warnings:** the separate counters for `.warn` and for the antilink/antibadword "warn" action are merged (migrated automatically), and the limit is configurable (`WARN_LIMIT`). `.warnings` now shows the real count (it always showed 0).
- **Moderation** never acts on admins, sudo users or owners. `.antitag` now exempts admins too. Moderation runs before the ban check, so banned users can no longer bypass antilink.
- **Message counter** (`.topmembers`) counts group messages only.
- **`.delete`** can only remove messages the bot saw since it started (the message store is in memory).
- **Automatic unmute** after `.mute <minutes>` is cancelled if the bot restarts in between.
- **Logged out:** the session is moved to `session.loggedout-<time>` instead of being deleted, and the bot waits for a new session instead of exiting.
- **Pairing service API:** `GET /pair?number=` and `GET /qr` were replaced by token-protected `POST /api/pair`, `POST /api/qr` and `GET /api/status/:id`. The page has no external scripts or icons.
- **Link previews** no longer appear on bot replies.
- **Help menu** is generated from the commands and grouped by category. `.help <command>` shows details.

### Added

- `src/` framework: validated config, auto-loaded commands and listeners with metadata, central dispatcher (permissions, chat type, bot-admin check, cooldowns, bans, mode, error handling), exact PN/LID identity handling for Baileys 6.7 and 7.x field names.
- `.whoami` (shows your IDs and level; helps set `OWNER_LIDS`), `OWNER_LIDS`, configurable `PREFIX`, `BOT_NAME`, `OWNER_NAME`, sticker pack metadata, limits and timeouts.
- Terminal pairing with `PAIRING_NUMBER`. The bot also picks up a new session from the pairing service automatically.
- Health endpoints: bot `GET /healthz` (port 3000), pairing `GET /healthz`.
- Structured logging (pino) with secret redaction and masked phone numbers. Graceful shutdown on SIGINT/SIGTERM.
- `npm run check` dry run, `npm test` (41 bot tests, 18 pairing tests, none connect to WhatsApp), `npm run lint`.
- Dockerfiles (non-root, tini, health check, ffmpeg + yt-dlp + fonts), `docker-compose.yml` (persistent volumes, restart policy, memory limits, log rotation), `ecosystem.config.js` for PM2.
- Documentation: README, DEPLOYMENT, USAGE, ADDING_FEATURES, TROUBLESHOOTING, ARCHITECTURE, SECURITY_AUDIT.

### Dependencies

| | Bot | Pairing service |
|---|---|---|
| Baileys | 7.0.0-rc (release candidate) → **6.7.24** (latest stable, both services pinned to the same version) | 6.7.21+ (caret) → **6.7.24** |
| Node.js | ≥18 (wrong for Baileys) → **≥22.12** | ≥20 → **≥22.12** |
| Runtime deps | 50 declared → 7 pinned: `@whiskeysockets/baileys`, `@anthropic-ai/sdk`, `sharp`, `node-webpmux`, `pino`, `pino-pretty`, `mumaker` | 9 → 6 pinned: `@whiskeysockets/baileys`, `express` 5, `helmet`, `pino`, `qrcode`, `awesome-phonenumber` |
| `npm audit` | 25 vulnerabilities → **0** | 0 → **0** |

Baileys 6.7.24 installs its `libsignal` dependency from GitHub (pinned to a commit in the lockfile), so `git` must be available at install time.
` or `{user}`: these were interpreted by `String.replace`. Variables are now filled in one pass and inserted as written.

### Checked
- 3 tests (169 in total).

## 2.16.0 — 2026-10-06

### Added
- **`.siyam`**: the sunnah fasting days coming up. These are Mondays and Thursdays, the white days, Arafah, Tasu'a and Ashura, and the start of the six days of Shawwal, plus the dates of the next Arafah and Ashura. Days when fasting is not allowed (the Eids and the days of Tashreeq) are never suggested, and nothing is suggested in Ramadan. Dates use the Umm al-Qura calendar offline and were checked against aladhan.com's conversion.
- **`.autosiyam`**: a reminder the evening before each sunnah fast (default 20:00). It says why tomorrow is recommended and is quiet on other days. `weekly off` keeps only the white days and the special days. It is listed in `.autos`, stopped by `.autos off`, and stopped when the bot leaves a group.
- **`.khatma remind`**: mentions members whose juz' aren't read yet, longest first, at most once an hour.

### Checked
- 4 tests (166 in total).

## 2.15.0 — 2026-10-06

### Added
- **`.khatma`: a shared group khatma** (ختمة جماعية). Members take one of the 30 juz' (`.khatma take` / `.khatma take 5`), mark it read (`.khatma done`) or give it back (`.khatma drop 5`). `.khatma` shows the board with a progress bar and mentions. Completion is announced and the next khatma is numbered. Each juz' start (surah and verse) and page range come from `assets/quran-juz-ar.json`, built from alquran.cloud's `/meta`. Arabic digits are accepted (`.khatma take ٥`).
- **`.autojumuah`: a Friday reminder** every week at a chosen time (default 09:00): the verse 62:9, the sunnahs of the day, and the salawat texts from Hisn al-Muslim. The verse is bundled exactly as returned by alquran.cloud (quran-uthmani). `.autojumuah now` previews it.
- `.autos` lists both. `.autos off` also stops the Friday reminder. The khatma is removed only when the bot leaves the group.

### Changed
- `.khatma` was an alias of `.autowird`; it is now the group khatma. `.autowird` / `.dailywird` are unchanged.

### Checked
- 4 tests (162 in total).

## 2.14.0 — 2026-10-06

### Added
- **`.recap`** (also `.catchup`, `.missed`): "what did I miss?" in a group. The AI summarizes the last 100 messages (10–200): topics, decisions, open questions. Recent group text is kept in memory only (200 messages per group, 500 characters each, at most 300 groups; never on disk; commands are skipped) and only when an AI key is set.

### Fixed
- **Automatic posts kept trying in groups the bot had left.** When the bot leaves (`.leave`, `.leavegroup`) or is removed from a group, its adhkar, prayer alerts, tafsir/dua/hadith posts, wird, announcements, group schedule, captcha (and its pending questions) and recap memory there are now stopped. `.leavegroup` says what it stopped.
- **Failed repeating posts retried every 10 minutes forever.** They now back off (10, 20, 40 … minutes, up to every 6 hours). Posts whose content source is down keep retrying; posts that can't be *sent* to the chat 12 times in a row are stopped.

### Changed
- `.autos off` and the leave clean-up share one code path (`services/automations.js`).

### Checked
- 4 tests (158 in total).

## 2.13.0 — 2026-10-06

### Fixed (found by checking the code against Baileys 6.7.24's real event format)
- **Captcha could remove real members in LID groups.** The join event and the member's messages can name the same person by LID and by phone number. The answer is now matched against all of a member's known ids.
- **Captcha and the welcome message treated the bot itself as a new member** when it was added to a group. The bot is now skipped.

### Changed
- **`.help` is a short overview** (about 1,200 characters instead of 7,900): each section with its size and most useful commands. `.menu` / `.help all` give the full list as plain text instead of a long image caption; `.menu <section>` still opens one section.
- **Menus show what you can use.** Owner-only commands appear only for the owner, and sudo commands for owner/sudo. Anyone can still ask `.help <command>`.

### Checked
- Performance with every protection and listener switched on (25 listeners, 50 auto-replies, antilink, antibadword, antispam, levels, activity): **0.06 ms per incoming message**, 48 MB heap after 5,000 messages.
- 3 tests (154 in total).

## 2.12.0 — 2026-10-06

### Added
- **`.captcha on|off|time <1-10>`** (group admins): new members who join by link must answer a small sum within N minutes, or they are removed. Arabic digits are accepted, their other messages are deleted until they answer, and 3 wrong answers also remove them. Members added by an admin skip the check. This stops spam bots.
- **`.imsakiya <city>`**: the Ramadan timetable (Imsak, Fajr, Maghrib for each day) of the current or next Ramadan for any city (aladhan.com).
- **`.iftar <city>`**: time left until Maghrib/iftar and Imsak/suhoor. Near iftar during Ramadan it adds the iftar dua from the bundled Hisn al-Muslim.
- **`.autos`**: everything automatic in a chat in one list; `.autos off` stops all automatic Islamic posts there at once.
- Prayer times now include Imsak.
- 4 tests (151 in total).

### Changed
- Arabic durations use correct number forms (ساعة و5 دقائق، ساعتان، دقيقتين).

## 2.11.0 — 2026-10-06

### Added
- **Daily Quran reading (الورد اليومي)**:
  - `.autowird on [pages 1-20] [time]` sends that many mushaf pages every day at that time, in order from page 1 to 604, then starts a new khatma and counts it.
  - `.autowird` shows the position, pages left and estimated days to finish. `.autowird page <n>` moves the position; `.autowird off` stops.
  - `.wird` sends the next portion now; `.wird page <n>` shows any page.
  - Page text is from alquran.cloud. Each surah's basmala is shown on its own line as in the mushaf (it's verse 1 only in al-Fatiha, and At-Tawbah has none). Verse numbers are in Arabic digits ﴿١﴾.
- **Hadith**:
  - `.hadith [id]` gives a random hadith, weighted so every hadith has the same chance, with its grade (درجة), source (رواه) and a short explanation, from موسوعة الأحاديث النبوية (hadeethenc.com, public developer API, credited in each message).
  - `.autohadith every <hours>` posts one every 1–24 hours, the first right away, with the same quiet hours.
- **`.zakat <amount> [currency]`**: nisab by gold (85 g) and silver (595 g) at today's price, and the 2.5 % due.
- **`.gold [currency]`**: price per gram for 24k/21k/18k gold, the ounce, and silver (gold-api.com spot price).
- 5 tests (147 in total).

## 2.10.1 — 2026-10-06

### Fixed
- **Automatic Islamic posts didn't arrive, or came at the wrong hour.** Without `TIMEZONE`, the bot used the server's time zone, which on most VPSs is UTC. Repeating posts were then held as "night" (quiet hours) until 07:00 UTC, and `.autoazkar` used UTC times.
  - When `TIMEZONE` is not set and the server is on UTC, the bot now uses the owner's country, from the first number in `OWNER_NUMBERS` (single-zone countries only, e.g. 20 → Africa/Cairo, 966 → Asia/Riyadh).
  - The chosen zone and why are in the startup log and in `.doctor`.
- `.autotafsir every N` and `.autoazkar dua every N` post the first verse/dua **immediately**, then every N hours. Before, they said "within a minute", but quiet hours could hold the post.

### Changed
- `.autoazkar`, `.autotafsir` and `.autoprayer` replies show the **next message and when it comes** ("⏭️ التالي: أذكار المساء الساعة 17:00 (بعد 8 س 12 د)"). They also show the bot's time zone and current time, with a hint to set `TIMEZONE` when it's only the server's UTC.
- 5 tests (142 in total). The fix was also checked with the real timers on a simulated UTC server.

## 2.10.0 — 2026-10-06

### Added
- **`.autotafsir every <hours>`**: a random verse with al-Tafsir al-Muyassar posted to the chat every 1–24 hours (`.autotafsir on` = every 3 hours; `.autotafsir off`).
- **`.autoazkar dua every <hours>`**: a random dua every 1–24 hours instead of once a day.
- **Quiet hours** for these repeating posts, default 23:00–07:00 in `TIMEZONE`: posts due then wait until morning. `.autotafsir quiet 22:00-06:00` changes them, `.autotafsir quiet off` removes them. If the Quran API fails, the post is retried 10 minutes later.
- `.tafsir` without a reference gives a random verse.
- 5 tests (137 in total).

### Changed
- **No admin needed**: any group member can now turn `.autoazkar`, `.autoprayer` and `.autotafsir` on or off. The owner can restore the admin-only rule with `.setvar ISLAMIC_ADMIN_ONLY true` (or in `.env`).

## 2.9.0 — 2026-10-06

### Added
- **Prayer-time alerts** (`.autoprayer on <city>` / `.adhan`, `.autoprayer off`): "حان الآن موعد أذان …" in the chat at each of the five prayers, in the city's own time zone (aladhan.com). Each is sent once and never more than 20 minutes late. Group admins only in groups.
- `.hijri`: today's Hijri date (Umm al-Qura, offline).
- `.ramadan`: countdown to Ramadan, Eid al-Fitr, Arafah, Eid al-Adha, the Hijri new year and Ashura.
- `.tafsir 2:255`: the verse with al-Tafsir al-Muyassar.
- `.surah <name|number>`: full recitation by Mishary Alafasy. Matches Arabic names typed with or without diacritics, English names and numbers; surahs over `MAX_DOWNLOAD_MB` come as a link.
- `.quran 2:255 audio`: the verse's recitation.
- `.qibla <city>` and `.asma [n|all]` (the 99 names).
- 5 tests (132 in total).

### Fixed
- `.autoazkar city` compared the city's prayer times with the bot's `TIMEZONE`. For a city in another time zone, the adhkar came at the wrong hour. Times now follow the city's own clock, through a shared prayer-time service (`services/prayertimes.js`) that asks aladhan for that city's local date.
- The HTTP client returns `HEAD` responses without trying to read or decompress a body.

### Changed
- `.prayer` alias `adhan` → `mawaqit` (`.adhan` is now the alerts).

## 2.8.0 — 2026-10-06

### Added
- **Adhkar and duas (الأذكار والأدعية)** from Hisn al-Muslim (حصن المسلم), bundled with the bot (`assets/hisnmuslim-ar.json`: 132 chapters, 267 adhkar, from the official hisnmuslim.com API; "حقوق الطبع لكل مسلم"). The Quran passages in the morning/evening adhkar were verified letter by letter against alquran.cloud. `scripts/fetch-hisnmuslim.js` refreshes the file.
  - `.azkar [صباح|مساء|نوم|استيقاظ|صلاة]`: chooses morning or evening by the time of day. It follows the book's notes on morning-only and evening-only entries, and adds a Surat al-Kahf reminder on Friday mornings.
  - `.dua [topic]`: a random supplication from the general dua chapters (supplications only, not the hadiths about virtues), or from chapters matching a topic.
  - `.hisn [number|word]`: browse all 132 chapters.
  - **`.autoazkar`**: sends the morning and evening adhkar to a group or private chat every day, plus an optional daily dua; `.autoazkar off` stops it.
    - Fixed times (default 06:30 / 17:00), or `.autoazkar city Cairo` for 30 minutes after Fajr / Asr (aladhan.com).
    - Group admins control it in groups. Sends at most once per day per message, catches up after downtime (up to 3 h), and never sends late for times already passed when it is turned on.
- New 🕌 Islamic section in `.help`; `.prayer` and `.quran` moved there.
- 5 tests (127 in total).

## 2.7.0 — 2026-10-06

### Added
- **Backup and restore from WhatsApp** (owner, private chat):
  - `.backup` sends a JSON file of every setting and list.
  - `.backup full` adds API keys set from chat and cookies.
  - `.restore` (reply to the file) shows what's inside and applies it after `.restore confirm`, without a restart. File names with path tricks are ignored.
  - The WhatsApp session is never included.
- **Scheduled announcements** to a group: `.announce every day at 08:00 …`, `.announce at 21:00 …`, `.announce list|del` (group admins). Plain text, no mentions, at most 10 per group.
- **Weekdays** for `.remind` and `.announce`: `friday at 20:00`, `every monday at 9am` (a weekday alone means 09:00).
- **`.inactive [days]`** (group admins): members who haven't written for N days, listed by number without pinging anyone. Only the time of each member's last message is stored.
- **`.welcome test` / `.goodbye test`** preview, and a `{count}` variable (member count).
- 6 tests (122 in total).

### Changed
- Welcome/goodbye building moved to `services/greetings.js`, shared by the listener and the preview.

## 2.6.0 — 2026-10-06

### Added
- **Levels**: members earn XP by chatting (15–25 per message, once a minute; commands don't count).
  - `.rank` sends a level card; `.leaderboard` shows the top 10.
  - `.levelup on|off|reset` (group admins) controls level-up announcements, which are off by default.
- **Antilink allow-list**: `.linkallow youtube.com` lets that domain and its subdomains through. Look-alikes such as `youtube.com.evil.example` are still removed.
- **Command rate limit per person**: `COMMANDS_PER_MINUTE`, default 15; owner and sudo exempt. This protects the bot's number from being flagged for spam.
- **Job queue for heavy work**: at most `MAX_PARALLEL_JOBS` (default 2) yt-dlp/ffmpeg processes run at once and up to 25 wait, so a busy group can't overload the server. `.doctor` shows the queue.
- **"Update finished" message**: after `.update now` or `.restart`, the bot reports the version it now runs once it's connected again.
- 9 tests (116 in total).

### Changed
- **Welcome/goodbye pictures are drawn on the server** with sharp instead of a third-party image API. New members' photos and numbers are no longer sent to some-random-api.com, and the card works even when that service is down. Arabic group names render correctly.

## 2.5.0 — 2026-10-06

### Added
- **Auto-replies** per group: `.filter <trigger> | <reply>` (or reply to a message), `.filters`, `.stopfilter`. Whole-word matching in any language. Rate-limited so it can't flood a group or loop with another bot.
- **Daily group open/close**: `.gcschedule close 23:00`, `.gcschedule open 08:00`, `.gcschedule off`. Uses `TIMEZONE`, runs once a day, and catches up after downtime (up to 3 h).
- **Owner group tools**:
  - `.groups` lists every group with member counts and admin status; `.leavegroup <number>` leaves one.
  - `.join <invite link>`.
  - `.block` / `.unblock` (the owner can't be blocked).
- **Animated sticker → video/GIF**: `.tovideo` (plays like a GIF; needs ffmpeg) and `.togif` (GIF file, no ffmpeg). sharp reads the animated WebP that ffmpeg can't.
- **Games**: `.rps` (rock-paper-scissors, also emoji and Arabic) and `.mathquiz [easy|medium|hard|top]` with points per group.
- 8 tests (107 in total).

### Changed
- **`.tts` speaks any language**: Arabic, Russian, Hebrew, Hindi, Chinese, Japanese, Korean, Thai and Greek are detected from the script; other languages take a code and a colon (`.tts fr: Bonjour`). It now sends a real voice note when ffmpeg is available. Aliases `.say`, `.speak`.
- **Unavailable commands explain themselves**: typing a command whose tool or key is missing (or `.help` for it) says it isn't available, instead of "did you mean". The owner also sees what it needs.
- `.transcribe` keeps the audio it sends to Gemini under the 20 MB request limit; videos may be larger, since only their audio is sent.

## 2.4.0 — 2026-10-06

### Added
- **AI pictures**: `.imagine <description>` draws a picture; reply to a photo with `.imagine <change>` to edit it (Gemini). Uses Gemini (`gemini-3.1-flash-image`, Interactions API, `store: false`) or OpenAI (`gpt-image-2.5-flare`).
- **Voice notes to text**: `.transcribe` (reply to a voice note, audio or video) in any language, optionally `translate <language>`. Uses Gemini or OpenAI (`gpt-transcribe`; audio converted to MP3 with ffmpeg, since OpenAI doesn't take Ogg).
  - Both work alongside Claude: keep Claude for chat and add a Gemini key for these.
- **AI memory**: `.ai` remembers your last 6 exchanges per chat for 30 minutes (follow-up questions work), and the group chatbot remembers the group conversation. Memory is kept in RAM only. `.aireset` forgets. `AI_MEMORY_TURNS`.
- **AI daily limit** per person (`AI_DAILY_LIMIT`, default 50; a picture counts 5; owner and sudo exempt), to keep API costs under control.
- **Audio effects** (ffmpeg): `.bass`, `.nightcore`, `.vaporwave`, `.slow`, `.fast`, `.deep`, `.chipmunk`, `.robot`, `.echo`, `.reverse`, `.8d`. Voice notes come back as voice notes.
- **Picture effects** on the server with sharp (nothing uploaded): `.grayscale`, `.invert`, `.sepia`, `.mirror`, `.flipimg`, `.rotate`, `.sharpen`, `.brighten`, `.saturate`, `.pixelate`, `.resize`, `.circlecrop`, `.compress`, `.toformat` (`.topng`/`.tojpg`/`.towebp`), `.imginfo`.
- **Reminders at a time and repeating**: `.remind at 18:30 …`, `.remind tomorrow at 9am …`, `.remind every day at 08:00 …`, `.remind every 2h …`.
- **Per-group command switches**: `.disable <command>`, `.enable <command|all>`, `.disabled` (group admins; owner/sudo unaffected; `.help` can't be disabled).
- **"Did you mean …?"** for mistyped commands (once per chat a minute; `SUGGEST_COMMANDS=false` turns it off).
- `.stats` (owner): most used commands and totals.
- `.crypto [coin] [currency]`: prices and 24 h/7 d change from CoinGecko, in any currency (information only).
- **yt-dlp auto-update** once a day (`YTDLP_AUTO_UPDATE=true`); `.doctor` shows the last result. Only yt-dlp is updated automatically, never the bot's code.
- 11 tests (99 in total). The ffmpeg features (audio effects, `.toaudio`, `.tovn`, video stickers) were also run against a real ffmpeg 8.1.

### Changed
- **`.sticker` and `.crop` work without ffmpeg** for pictures (made with sharp); ffmpeg is only needed for GIFs and videos. `.emojimix` no longer needs ffmpeg. Optional pack and author: `.sticker My Pack | Me`.
- **`.news` needs no API key**: Google News for any country and language (`.news`, `.news football`, `.news eg:ar`, `NEWS_REGION`). `NEWSAPI_KEY` is ignored.
- The group chatbot reports a reached daily limit instead of staying silent.

## 2.3.0 — 2026-10-06

### Added
- **Change settings from WhatsApp** (owner): `.vars` lists them with current values (keys hidden) and their source, `.setvar NAME value` changes one, `.delvar NAME` goes back to `.env`, and `.restart` restarts. Changes are validated first (invalid values are not saved), applied **without a restart** (config, AI client and command list are rebuilt; newly enabled/disabled commands are listed), and kept in `DATA_DIR/env-overrides.json`, which overrides `.env` and works under Docker too. Tool paths (`YTDLP_PATH`, `FFMPEG_PATH`) are test-run before saving.
  - About 30 settings are allowed: AI, bot name/prefix/stickers/time zone, API keys, limits, tool paths, log level. Owner numbers, folders, pairing, the update source and the health server deliberately stay in `.env`.
  - Secrets are refused in groups and never displayed. The message carrying them is deleted when WhatsApp allows it (sent from the bot's own account), and antidelete never keeps a copy.
- **Gemini and OpenAI-compatible AI**, besides Claude: `AI_PROVIDER` (`auto`/`claude`/`gemini`/`openai`), `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` (Groq, OpenRouter, DeepSeek, Mistral … any https endpoint), and per-provider models (`CLAUDE_MODEL`, `GEMINI_MODEL`, `OPENAI_MODEL`; defaults `claude-opus-5-5`, `gemini-3.8-flash`, `gpt-6-luna`). Images work with all three.
  - `.setai <provider> <key>` tests a key with a free request before saving it.
  - `.aimodel` lists the models your key can use and switches by number or name.
- **Login cookies per site from WhatsApp**: `.setcookie <site>` (attach or reply to cookies.txt, a Cookie-Editor JSON export, or paste `name=value; …`), `.cookies`, `.delcookie`. These cover YouTube, Instagram, Facebook, TikTok, X, Reddit, SoundCloud, Pinterest, Vimeo, Dailymotion, Twitch, Threads and Snapchat.
  - Only cookies for that site's own domains are kept. The files are stored with mode 600 and used by yt-dlp for that site's links.
  - The bot reports whether a logged-in session was found and when it expires. Owner only, private chat only.
- `.summarize` / `.tldr`: summarize (or ask a question about) a replied message, a web page, or a YouTube video via its captions.
- Notes: `.save <name> <text>`, `#name`, `.notes`, `.delnote` (admins in groups).
- `.antispam`: flood protection (more than N messages in S seconds → delete, warn or kick).
- Tools:
  - `.unit` converts length, weight, volume, area (incl. feddan/qirat), speed, temperature, data, time and energy.
  - `.age`, `.password`, `.hash`, `.base64`.
  - `.short` shortens links via TinyURL.
- Fun: `.roll 2d6`, `.flip`, `.pick a, b, c`, `.random 1 100`.
- 16 tests (settings, AI provider selection, cookies, notes, anti-spam, units …); 87 in total.

### Changed
- `.doctor` shows the AI in use, cookie sites and chat-changed settings. Its "how to enable" hints now use `.setvar` / `.setai`.
- The dispatcher reads the configuration per message, so a new prefix or cooldown applies at once.
- Re-checking tools after a settings change happens only when a tool path changed.
- Log redaction also covers the new keys, auth headers and cookies.

## 2.2.0 — 2026-10-06

### Fixed
- **yt-dlp "not installed" although it is.** `~` in `YTDLP_PATH` (and `FFMPEG_PATH`, `FONT_FILE`, `YTDLP_COOKIES`, `SESSION_DIR`, `DATA_DIR`, `TMP_DIR`) is now expanded to your home folder. Before, `YTDLP_PATH=~/.local/bin/yt-dlp` was taken literally, yt-dlp was not found, and every download command was hidden.
- A missing **ffmpeg** no longer hides `.video`, `.tiktok`, `.facebook`, `.instagram` (they fall back to single-file formats). Only `.song`, `.spotify`, `.igs`, stickers and the audio converters need it.
- Non-Latin titles from yt-dlp (Arabic, emoji …) are no longer garbled, and `.song` keeps Arabic song names in the file name.
- Network errors inside commands (DNS failure, connection reset) now show "the external service is not responding" instead of "Something went wrong".

### Added
- **Tool diagnostics.** Startup log, `npm run check` and the new **`.doctor`** (owner) show each tool's path and version, or exactly why it can't be used (`does not exist. Check YTDLP_PATH`, `chmod +x …`, not in `PATH` …). `.doctor` also shows connection, memory and uptime, lists disabled commands grouped by what they need, and says what to install or set for each.
- 🛠️ **Tools**: `.calc` (safe calculator, no `eval`), `.qr` / `.readqr` (make and read QR codes), `.currency` (exchange rates), `.remind` (persistent reminders: `10m`, `1h30m`, `2d` …, list/delete, delivered after restarts), `.poll` (native WhatsApp polls, single or multiple choice), `.afk` (away notices when you're mentioned), `.getpp` (profile or group picture), `.toaudio` (video → MP3), `.tovn` (anything → voice note).
- 📚 **Info & search**: `.wiki` (any language, e.g. `.wiki ar: القاهرة`), `.define` (English dictionary), `.time <city>`, `.prayer <city>` (today's prayer times and the next prayer), `.quran <surah:ayah>`.
- 📥 **Downloads**: `.yts` (YouTube search; then `.play 2` or `.video 2` picks a result), `.dl <link>` (one command for YouTube, TikTok, Instagram, Facebook, X/Twitter, Reddit, SoundCloud, Pinterest, Vimeo, Dailymotion, Twitch, Threads, Snapchat), `.twitter` / `.x`.
- 👮 **Group**: `.link` (invite link), `.lock` / `.unlock` (who may edit group info), `.leave` (owner).
- **`.ai` understands images**: send or reply to a photo or sticker (`.ai what does this say?`, or just `.ai` to describe it).
- **`.help <section>`** (`.help tools`, `.help info`, `.help downloads` …) lists one section with descriptions; mistyped names get "Did you mean …?".
- `TIMEZONE` setting (validated) for `.time` and `.remind`.
- 15 tests for the new features (calculator safety, reminders, AFK, help, polls, site detection …); 71 in total.

### Changed
- **`.weather` needs no API key** anymore: it uses Open-Meteo and adds a 3-day forecast. `OPENWEATHER_KEY` is ignored.
- New `.help` sections: 🛠️ Tools and 📚 Info & search (`.weather` moved to Info).

### Dependencies
- Added `qrcode` 1.5.4 and `jsqr` 1.4.0 (pinned). `npm audit`: 0 vulnerabilities.

## 2.1.0 — 2026-10-04

### Added
- **`.update`** (owner only): reports whether a newer version of the bot is on your GitHub repository (commits, version, last changes) and whether a newer **yt-dlp nightly** exists. **`.update now`** installs both:
  - yt-dlp: `yt-dlp --update-to nightly` (requires the standalone binary).
  - Bot: `git fetch` from `UPDATE_REMOTE`/`UPDATE_BRANCH` (default `origin`/`main`), fast-forward only, refused if the server has local changes or local-only commits; `npm ci` when `package.json`/`package-lock.json` changed; validated with `npm run check`, **automatic rollback** if validation fails; then a graceful restart through PM2/Docker.
  - Unlike the removed 1.x command (audit B-01), it accepts no URL or other input, never runs a shell, and cannot be used by sudo users.
- `UPDATE_REMOTE`, `UPDATE_BRANCH` settings (validated; option-like values are rejected).
- 11 tests for the updater (fake git and processes).

### Changed
- **yt-dlp nightly.** The Docker image now ships the official standalone nightly binary (SHA-256 verified at build time) in `/app/bin`, owned by the bot user so `.update now` can update it; Python is no longer installed in the image. The PM2 instructions install the same binary into `~/.local/bin`.
- **Deployment from GitHub.** The server is now a git clone of <https://github.com/akrmz/whatsagent> (public URL or a read-only deploy key), which is what makes `.update` work. The repository was published with a fresh history; the old local history containing leaked secrets was not pushed.

## 2.0.0 — 2026-10-04

A security-focused rewrite of both services. Your existing session (`MD-main/session/creds.json`) and the old `data/*.json` settings keep working; they are migrated automatically on first start.

### Before you upgrade (action required)

- **Configuration moved from `settings.js` to `MD-main/.env`.** Copy `.env.example` to `.env` and set `OWNER_NUMBERS` to your number **with country code** (the old `settings.js` had it without one).
- **Rotate every secret that was in the old code.** See "Actions you must take" in the security audit.
- The pairing service needs a `.env` with `PAIR_ACCESS_TOKEN`.
- Node.js **22.12 or newer** is required.

### Security fixes

Pairing service:
- **P-01** `?number=..` could delete any directory on the server. Input is now validated before any filesystem access, and temporary folders use random names in a private directory.
- **P-02** The whole project folder, including in-progress session credentials and `mega.js`, was served over HTTP. Now only `public/` is served.
- **P-03** Hardcoded Mega account credentials removed (`mega.js` deleted).
- **P-04** Pairing sockets were never closed, so the server stayed a linked device of every account that paired. The socket is now always closed after delivery, failure or timeout.
- **P-05** Strangers could use the page freely. It now requires an access token, rate-limits per IP, caps concurrent pairings, times out, and retries with bounded backoff.
- **P-06** References to a third-party hosted pairing server removed.
- **P-07/P-10** The session is now saved directly on the server by default instead of being sent through WhatsApp. Promotional messages removed.
- **P-08/P-09** Strict input validation, Helmet security headers and CSP, no CDN scripts, no error-swallowing global handlers, pairing codes never logged, phone numbers masked in logs.

Bot:
- **B-01** Removed `.update`, which downloaded and installed code from any URL or reset to the upstream repository (remote code execution).
- **B-02** Owner check rewritten. The old one matched substrings, let any `@lid` user in a group with the owner count as owner, and made everyone owner if the owner number was empty. Matching is now exact on normalized PN/LID IDs, and an empty owner list refuses to start.
- **B-03** Media from external APIs is downloaded into memory through the safe client and sent as a buffer. A malicious API can no longer make Baileys read local files such as the session.
- **B-04** `link-preview-js` removed, and link previews disabled. Echoing a user-supplied URL no longer makes the server fetch it (SSRF).
- **B-05** All hardcoded API keys and the Telegram bot token removed. Keys now come from `.env`, and commands without a key are disabled.
- **B-06** Sudo users can no longer add sudo users or use owner-only commands.
- **B-07** Antidelete is bounded (message count, 24 h age, media size), and media files are deleted on eviction.
- **B-08/B-18** Downloader links are validated against the exact site. Every outbound request goes through an HTTPS-only client that refuses private, loopback and link-local addresses at connect time, re-checks redirects, and caps size and time.
- **B-09/B-17** Every WhatsApp media download is size-checked. ffmpeg runs without a shell and with a local-file protocol whitelist. `.attp` text can no longer inject ffmpeg options.
- **B-10** Settings are written atomically. A corrupted mode file now fails closed (private) instead of open (public). Message counters are no longer rewritten synchronously on every message.
- **B-11/B-19** `.ban`/`.unban` are owner/sudo only, owners can never be banned, and `.sudo list` is owner only.
- **B-12/B-15** The chatbot sends only the triggering message (no history, no extracted personal details), and the abusive persona was replaced with a neutral, configurable one.
- **B-13** `.vv` (reveal view-once) is owner only.
- **B-14** Removed the self-hot-reload that started duplicate bot instances.
- **B-16** Removed the "Forwarded from Akram MD" newsletter label on every reply, the "join our channel" message on connect, upstream channel and support links, and upstream branding.
- **R-01** A working root `.gitignore` (the old one was UTF-16, which git cannot read) now excludes sessions, `.env` and runtime data.
- **D-01/D-02** Dependencies cut from 50 declared / 569 installed to 7 / 209 for the bot. All are pinned and the lockfiles committed. `npm audit`: 0 vulnerabilities (was 25, 5 critical). The pairing service also has 0.
- **Obfuscated dependency removed:** `ruhend-scraper` (used for Instagram/TikTok) hides about 62 KB of obfuscated code behind about 865,000 lines of invisible padding characters, and builds its `require()` targets at runtime. It was replaced by yt-dlp.

### Removed

| What | Why |
|---|---|
| `.update <url>` command | Remote code execution (B-01). A restricted replacement was added in 2.1.0. |
| `mega.js` | Unused; contained Mega credentials |
| Unwired `commands/pair.js` | Sent your number to a third-party pairing server |
| Unwired `gif.js`, `sticker-alt.js`, `lib/ytdl2.js`, `lib/myfunc2.js`, `lib/sticker.js`, `lib/antilinkHelper.js`, `lib/tempCleanup.js`, `.move` | Dead or broken code |
| `data/owner.json`, `data/premium.json` | Upstream author's phone numbers (they were never used for permissions) |
| `.github/FUNDING.yml`, `assets/bmc_qr.png` | Upstream author's donation links |
| `assets/rapid.jpg`, `stickintro.webp`, `sticktag.webp` | Unused |
| Newsletter decoration, connect promo, upstream button replies, pairing promo messages | Unwanted advertising |
| `fs.watchFile` self-reload, RSS self-kill at 400 MB, `global.gc` timer | Caused duplicate instances and crash loops. PM2/Docker memory limits are used instead. |
| `.imagine`/`.flux`/`.dalle` and `.sora` | Their free APIs no longer return images or video (checked 2026-10-04), and Claude has no image generation |
| `.loli` alias | Mapped to an unsupported type and only returned an error |
| `baileys_store.json` | Recent messages are now kept in memory only (bounded), not written to disk in plaintext |
| `settings.js`, `config.js` | Replaced by `.env` + `src/config.js` |

### Changed behaviour

- **Downloads:** `.song`/`.play`/`.mp3`/`.ytmp3`/`.music`, `.video`/`.ytmp4`, `.spotify`, `.tiktok`, `.fb`, `.instagram`, `.igs`/`.igsc` now use yt-dlp running on your server. The previous free download APIs were all dead or paywalled when checked on 2026-10-04. `.spotify` searches the track on YouTube. Instagram photo posts are not supported (videos only).
- **AI:** `.gpt`/`.gemini` (now aliases of `.ai`) and the group chatbot use Claude through the official Anthropic SDK with your own `ANTHROPIC_API_KEY`. The old free endpoints were dead or returned empty answers.
- **Lyrics** use lrclib.net (the old API was down). **Remove background** uses the official remove.bg API (needs `REMOVEBG_API_KEY`). **Remini** needs your own `REMINI_API_KEY`.
- **Need your own key now:** `.news`, `.weather`, `.emojimix`, `.tg`, `.removebg`, `.remini`, `.github` (`GITHUB_REPO`). They are hidden until configured.
- **Permissions are enforced centrally.** Denial messages are uniform. Non-admins using `.tag` get a text message instead of a sticker. Tagging commands no longer require the bot to be admin. `.settings` and `.cleartmp` are available to sudo users.
- **`.autoread` / `.autotyping` without arguments** show the status instead of toggling. Use `on`/`off`.
- **`.clearsession`** asks for `confirm` first.
- **`.quote` with text** no longer returns an anime quote; use `.animuquote`.
- **`.simpcard`** is now an alias of `.simp`, and `.its-so-stupid` an alias of `.stupid`. In the old router these were shadowed and never ran.
- **Warnings:** the separate counters for `.warn` and for the antilink/antibadword "warn" action are merged (migrated automatically), and the limit is configurable (`WARN_LIMIT`). `.warnings` now shows the real count (it always showed 0).
- **Moderation** never acts on admins, sudo users or owners. `.antitag` now exempts admins too. Moderation runs before the ban check, so banned users can no longer bypass antilink.
- **Message counter** (`.topmembers`) counts group messages only.
- **`.delete`** can only remove messages the bot saw since it started (the message store is in memory).
- **Automatic unmute** after `.mute <minutes>` is cancelled if the bot restarts in between.
- **Logged out:** the session is moved to `session.loggedout-<time>` instead of being deleted, and the bot waits for a new session instead of exiting.
- **Pairing service API:** `GET /pair?number=` and `GET /qr` were replaced by token-protected `POST /api/pair`, `POST /api/qr` and `GET /api/status/:id`. The page has no external scripts or icons.
- **Link previews** no longer appear on bot replies.
- **Help menu** is generated from the commands and grouped by category. `.help <command>` shows details.

### Added

- `src/` framework: validated config, auto-loaded commands and listeners with metadata, central dispatcher (permissions, chat type, bot-admin check, cooldowns, bans, mode, error handling), exact PN/LID identity handling for Baileys 6.7 and 7.x field names.
- `.whoami` (shows your IDs and level; helps set `OWNER_LIDS`), `OWNER_LIDS`, configurable `PREFIX`, `BOT_NAME`, `OWNER_NAME`, sticker pack metadata, limits and timeouts.
- Terminal pairing with `PAIRING_NUMBER`. The bot also picks up a new session from the pairing service automatically.
- Health endpoints: bot `GET /healthz` (port 3000), pairing `GET /healthz`.
- Structured logging (pino) with secret redaction and masked phone numbers. Graceful shutdown on SIGINT/SIGTERM.
- `npm run check` dry run, `npm test` (41 bot tests, 18 pairing tests, none connect to WhatsApp), `npm run lint`.
- Dockerfiles (non-root, tini, health check, ffmpeg + yt-dlp + fonts), `docker-compose.yml` (persistent volumes, restart policy, memory limits, log rotation), `ecosystem.config.js` for PM2.
- Documentation: README, DEPLOYMENT, USAGE, ADDING_FEATURES, TROUBLESHOOTING, ARCHITECTURE, SECURITY_AUDIT.

### Dependencies

| | Bot | Pairing service |
|---|---|---|
| Baileys | 7.0.0-rc (release candidate) → **6.7.24** (latest stable, both services pinned to the same version) | 6.7.21+ (caret) → **6.7.24** |
| Node.js | ≥18 (wrong for Baileys) → **≥22.12** | ≥20 → **≥22.12** |
| Runtime deps | 50 declared → 7 pinned: `@whiskeysockets/baileys`, `@anthropic-ai/sdk`, `sharp`, `node-webpmux`, `pino`, `pino-pretty`, `mumaker` | 9 → 6 pinned: `@whiskeysockets/baileys`, `express` 5, `helmet`, `pino`, `qrcode`, `awesome-phonenumber` |
| `npm audit` | 25 vulnerabilities → **0** | 0 → **0** |

Baileys 6.7.24 installs its `libsignal` dependency from GitHub (pinned to a commit in the lockfile), so `git` must be available at install time.
