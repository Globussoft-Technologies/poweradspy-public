# Copyright Request: admin panel guide

For testers, reviewers and anyone else who opens the **Copyright Request** page of the admin panel. It assumes you have never seen the page before. It explains every screen, every box, every button and every word, what each one does to the data, and how to test the page. Updated 24 November 2026.

**Hover to learn a word.** On the page, every column title and lesser-known word has a dotted underline, and every coloured status label and tab name shows a help cursor. Hover over it for a one- or two-line explanation, so most questions are answered on the page itself. This guide gives the full picture.

If you only read one thing, read this:

> **Only three buttons change data: Accept, Reject and Retry.** They are all on the **Requests** tab, inside one claim. Everything else on the page, including the whole **Monitoring** tab, only **reads**. You cannot delete, block or edit anything from Monitoring, so you can click around there freely.

For the technical side (tables, jobs, settings) see [COPYRIGHT_COMPLIANCE_FLOW.md](COPYRIGHT_COMPLIANCE_FLOW.md).

---

## Contents

1. [The idea in plain words](#1-the-idea-in-plain-words)
2. [Words you need first](#2-words-you-need-first)
3. [Opening the page and who can use it](#3-opening-the-page-and-who-can-use-it)
4. [The whole flow, step by step](#4-the-whole-flow-step-by-step)
5. [The menu item and its badges](#5-the-menu-item-and-its-badges)
6. [The top of the page](#6-the-top-of-the-page)
7. [The Requests tab](#7-the-requests-tab)
8. [The Monitoring tab](#8-the-monitoring-tab)
9. [Moving through pages](#9-moving-through-pages)
10. [Following one claim from start to end](#10-following-one-claim-from-start-to-end)
11. [Every button in one table](#11-every-button-in-one-table)
12. [Every status word](#12-every-status-word)
13. [How to test the page](#13-how-to-test-the-page)
14. [Common questions](#14-common-questions)
15. [Limits to know](#15-limits-to-know)
16. [For administrators](#16-for-administrators)

---

## 1. The idea in plain words

PowerAdSpy collects ads from many ad networks (Facebook, Instagram, YouTube and others) and lets customers search them. Sometimes the owner of a brand or a picture says: *"You are showing ads that use my copyrighted work. Please stop."* That message is a **copyright claim**.

The Copyright Request page is where our team handles those claims:

1. **Read the claim** and the documents the person sent.
2. **Decide**: *Accept* (the claim is valid) or *Reject* (it is not).
3. If accepted, the system **blocks** the advertiser named in the claim, so we stop collecting and showing its ads, and it **removes** the ads we already have.
4. **Watch** that it really happened: what was blocked, which ads were refused, which were deleted, and proof of each deletion.

Steps 1 and 2 are done by a person on the **Requests** tab. Steps 3 and 4 happen by themselves in the background, and you watch them on the **Monitoring** tab.

---

## 2. Words you need first

These words appear all over the page. Learn them once.

| Word | What it means |
| --- | --- |
| **Claim** | One complaint sent through the copyright form on the website. |
| **Claimant** | The person or company who sent the claim. |
| **Advertiser** | The brand whose ads appear in PowerAdSpy. The claim names one advertiser: the one to block. |
| **Network** | An ad platform we collect from: facebook, instagram, youtube, google, linkedin, reddit, quora, pinterest, native, gdn, chatgpt ads, admob and so on. Every network has its own database, so most Monitoring views show **one network at a time**. |
| **Reference** | A short code like `CR-7K3QXP`. It is shown to the claimant and is easy to read aloud. Use it when you talk about a claim. |
| **Complaint id** | A long code like `11111111-1111-4111-8111-111111111111` (36 characters). Every claim has one. The system uses it to link the claim to everything it caused: its blocks, its image fingerprints and its refused ads. You see it on the claim page (with a **Copy** button) and in the **Claim requests** list. **The Monitoring tab searches by this id, never by the reference.** |
| **Block** / **blocklist** | The list of everything that must not be shown: advertiser names, single ads, links, websites and images. "Blocked" means "on that list". |
| **Hash** / **fingerprint** | A short code computed from an image. Two copies of the same picture give the same fingerprint, even under another advertiser's name. That is how copies are caught. |
| **Hash job** | A background task that takes every image of a blocked advertiser and records its fingerprint. |
| **Copyright check** (verification) | A background job, every 2 minutes, that checks ads against the blocklist. A new ad is **hidden from search** until it passes this check. |
| **Cleanup** / **takedown** | A background job, every 15 minutes, that **deletes** ads that failed the check, from storage, the database and search. |
| **Run** (takedown run) | One pass of the cleanup job on one network. |
| **Step** | One delete action inside a run, for example "delete the image from storage" or "delete the row from the database". |
| **Audit** | A second record written after each run: how many ads it meant to remove and how many it found removed. It is our proof. |
| **Platform ad id** | The network's own id for an ad (what the scraper sent). |
| **Row id** (internal id, "our row id") | The number of the ad's row in our own database. It is different from the platform ad id. |

### How an ad is shown on the Monitoring tab

Wherever an ad appears (Ad verification, a run's steps, Failed steps, hash job results, audit findings), it is shown as a small block:

```
Acme Brand                       ← the advertiser
Platform ad id 990001110009      ← the network's own id
Our row id 131579                ← our database row
```

- Every id has its **label**, so you never have to guess which kind it is. **Hover** a label for a one-line explanation.
- **To find the ad on the network or in PowerAdSpy search, use the platform ad id.** The row id is only for developers looking in the database.
- **"advertiser unknown"** means the name could not be found: the ad was deleted by a run made before 24 November 2026 (older runs did not save the name), or the network's advertiser table could not be read. The ids are still correct.
- Where the advertiser name comes from: for an ad that still exists, from the ad itself; for an ad the cleanup already deleted, from the copy saved by the run just before deleting it.

---

## 3. Opening the page and who can use it

**Where:** the left menu of the admin panel, **Copyright Request** (shield icon, below Competitor Tracker). It is shown when the panel is in PowerAdSpy mode.

**Who:**

- You must be **logged in** to the admin panel.
- Your user name must be on the **reviewers list** (an administrator sets it). Without it, the page opens but says **"You do not have access to copyright requests"**, and you see no claim and no numbers.
- When you Accept, Reject or Retry, the name saved with it is **your login name**. It cannot be typed or changed on the page.

---

## 4. The whole flow, step by step

| # | What happens | Who or what does it | Where you see it |
| --- | --- | --- | --- |
| 1 | Someone fills the copyright form on the website: the advertiser's name, their own name, email and company, the reason, an optional link and supporting files. | The claimant | Not in the admin panel yet |
| 2 | The claim is saved with the status **Waiting**. The files are stored privately. The claim gets its reference (`CR-…`) and its complaint id. | Our server | **Requests** tab, filter *Waiting* |
| 3 | A reviewer opens the claim, reads it, downloads the files and presses **Accept…** or **Reject…**. | You | **Requests** tab |
| 4a | **Accept:** the advertiser is added to the blocklist on **every** network, and one hash job per network is queued for its images. | Our server, at once | The claim: *What happened after the decision*. **Monitoring › Blocked list** |
| 4b | **Reject:** the claim is closed. Nothing is blocked. | Our server, at once | The claim: *Decision* |
| 5 | The hash job fingerprints the advertiser's stored images and adds each fingerprint to the blocklist. | Background job, every minute | **Monitoring › Hash jobs** |
| 6 | **The copyright check.** New ads stay hidden until they are checked. Each one is then **approved** (shown) or **failed** (stays hidden). The same job also finds ads we **already had** that match a new block (advertiser, ad id or image) and marks them failed. | Background job, every 2 minutes | **Monitoring:** *Waiting for check*, *Waiting for cleanup*, **Ad verification**, **Rejected ads** |
| 7 | **The cleanup.** Failed ads are deleted from storage, the database and search. Each pass is one takedown run with a log of every step. | Background job, every 15 minutes | **Monitoring › Takedown runs**, **Failed steps** |
| 8 | **The audit.** After each run, the expected and found removals are recorded, ad by ad. | Same background job | **Monitoring › Audit** |

Important:

- **The decision itself deletes nothing.** Accepting only blocks and queues the fingerprinting. The existing ads are removed by steps 6 and 7, a few minutes later.
- Steps 6 to 8 happen **only if an administrator has switched on the copyright check** (section 16). If it is off, an accepted claim still blocks new ads, but nothing existing is removed.
- A block can also be added **without a claim**, by a trusted team member or system (the "block request"). Such a block is **not** a claim and is not on the Requests tab. It still appears in **Monitoring › Blocked list** and **Hash jobs**.
- The cleanup job also blocks by itself the **ad id** of every ad it deletes (added by `copyright-verification`, source `verification`), so a copy that is collected again is refused.

---

## 5. The menu item and its badges

Next to **Copyright Request** in the left menu, reviewers can see small round numbers. Hover over a badge to see what it counts.

| Badge colour | Tooltip | Meaning |
| --- | --- | --- |
| Red | Claims waiting for a decision | How many claims have no decision yet. This is your to-do list. |
| Dark grey | Ads whose delete failed | Ads whose delete failed in a takedown run, all networks added up. **Counted per run** (see 8.1). |
| Amber | Ads waiting to be deleted | Ads planned in a run but not done yet. Shown only when nothing failed. |

The red badge refreshes every minute, the other two every two minutes. People who are not reviewers see no badge.

---

## 6. The top of the page

From top to bottom:

- **Title "Copyright Request"** and the line "Claims that came in, what was decided, and what was deleted, is waiting or failed."
- **Checked 10:16 am**: the last time the page asked the server whether everything works. It asks by itself every minute.
- **Check** button: asks again now. It changes nothing.
- **How this page works (start here)**: a box you can open. It has the five-line summary of the flow and explains the two codes (reference and complaint id). It is closed by default; click its title to open it.
- **Requests** and **Monitoring**: the two tabs. A red number on *Requests* is the waiting claims; a grey number on *Monitoring* is the ads whose delete failed.

### When the page cannot work, it says why

Instead of the tabs you may see one of these boxes. Press **Retry** on those that have it.

| What it says | What it means | What to do |
| --- | --- | --- |
| The admin server cannot be reached | The admin backend did not answer. The box shows the address it tried. | Ask an administrator to start it, or check the address in the panel's settings. |
| Copyright claims are not set up on the server yet | The backend runs, but a required setting is missing. The box lists the three settings. | Ask an administrator (section 16). |
| You do not have access to copyright requests | Your user name is not on the reviewers list. | Ask an administrator to add it. |
| The claims service is not answering | The backend runs, but the service that stores claims is down or switched off. | Ask an administrator. |

If your login has expired, you are sent to the login page.

---

## 7. The Requests tab

This is where claims are read and decided. The screen has three boxes at the top, the list of claims on the left and the open claim on the right.

### 7.1 The three boxes

| Box | What the number means | Colour |
| --- | --- | --- |
| **Waiting for review** | Claims with no decision yet. | Always dark |
| **Oldest waiting** | How long the oldest waiting claim has waited, in hours (for example `5 h`). | Turns **red at 48 hours or more** |
| **Accepted, but not fully processed** | Accepted claims where blocking or fingerprinting did not finish on some network. | Turns **amber** above zero. Open those claims and press **Retry**. |

Each box has a small grey line under the number that says the same in short. "unavailable" means the numbers could not be read.

The **round arrows** button (top right of the tab) reloads the boxes, the list and the open claim. It changes nothing.

### 7.2 The list of claims (left)

- **Waiting / Accepted / Rejected / All**: shows only claims with that decision. The tab opens on **Waiting**. The selected filter is dark blue.
- Each row shows:
  - the **advertiser** named by the claim (bold);
  - its status as a coloured pill: **Waiting** (amber), **Accepted** (green), **Rejected** (grey);
  - a grey line: the **reference** (`CR-…`), the claimant's **company**, and the **date received**;
  - for an accepted claim that did not fully finish, a second pill: **Partly done** or **Failed**.
- Newest claims are first.
- **Click a row** to open that claim on the right. The open row is light blue.
- **‹ Previous / Page N / Next ›** at the bottom move between pages of 25 claims (section 9).
- "No claims here." means no claim has that status.

### 7.3 One claim (right)

Until you click a claim, the right side says "Choose a claim on the left to see it here."

From top to bottom:

| Part | What it shows and what you can do |
| --- | --- |
| **Name, reference, date, status** | The advertiser named by the claim, its reference, when it came in, and its status pill. |
| **Complaint id** | The long id of the claim, in full, with a small **Copy** button. Use it when you need to search Monitoring by hand, or when you report a problem. |
| **Claimant** | Who sent it: name, company and email. "Their reference" is the sender's own reference, if they gave one. |
| **Reason** | What the claimant wrote, exactly as sent. |
| **Link given by the claimant (not opened by us)** | Shown only if they gave a link. It is shown as **plain text** and never opened for you. **Copy** copies it. **Open…** asks "This is a website outside PowerAdspy, given by the claimant… Open it in a new tab?" and only then opens it. Only links starting with `https://` can be opened. |
| **Supporting files** | The files they uploaded: name, kind, size and scan state (*scanned* or *scan pending*). **Download** saves a file to your computer. It is **greyed out while the virus scan is pending**. Files are kept in a private store and can only be downloaded here, through your login. "No files were attached" means none came with the form; documents may arrive by email quoting the reference. |
| **Does the name exist in our data?** | Only on waiting claims. **Search networks** looks the advertiser name up on every network. It only reads. See 7.5. |
| **Accept…** and **Reject…** | Only on waiting claims. Each opens a confirmation window. See 7.4. |
| **Decision** | Only on decided claims: "Accepted by *name* on *date*" or "Rejected by *name* on *date*", with the note or reason that was written. |
| **What happened after the decision** | Only on accepted claims. The result of blocking and fingerprinting, network by network. See 7.6. It also has **Follow this claim in Monitoring** (section 10). |

### 7.4 The decision windows

**Accept…** opens **"Accept this claim?"**. It says "The advertiser below will be blocked on every network and its images will be queued for hashing:", then shows the advertiser's name, the reference and the company.

| Control | What it does |
| --- | --- |
| Tick box "I reviewed the supporting documents and the name is the advertiser this claim is about." | **Required.** **Accept claim** stays greyed out until you tick it. |
| Note (optional) | Up to 255 characters, saved with the decision. |
| **Accept claim** | Saves the decision, blocks the advertiser on every network and queues the fingerprinting. A green message "Accepted. The advertiser is blocked and its images are queued." means all went well. An amber message "Accepted, but some steps did not finish. See the details and use Retry." means the decision is saved but some network did not finish. |
| **Cancel** or **X** | Closes the window. Nothing is saved. |

**Reject…** opens **"Reject this claim?"**. It says "Nothing will be blocked. The claim is closed:".

| Control | What it does |
| --- | --- |
| Reason for rejecting (required) | Up to 255 characters. **Reject claim** stays greyed out until you write something. |
| **Reject claim** | Closes the claim as rejected. Nothing is blocked. A green "Rejected." appears. |
| **Cancel** or **X** | Closes the window. Nothing is saved. |

> **A claim is decided once.** If another reviewer decided it a moment before you, your press is refused with a message like "already decided", and nothing is overwritten. Refresh to see their decision. There is no way to undo a decision on this page.

### 7.5 Search networks (before you decide)

It looks, network by network, for an advertiser with that name in our stored ads. It never changes anything. It can take up to a minute.

| Result | Meaning |
| --- | --- |
| **Found** | The name exists there. The line says "N ads, M advertiser(s)". |
| **Not found** | No advertiser with that name on that network. |
| **Unable to check** | The search could not run there (for example the database did not answer). The reason is shown next to it. **This does not mean "no ads".** |
| **Not supported** | That network is not covered by this search. |

"Not found" or "Unable to check" does not stop you from accepting. The block is added either way and refuses new ads with that name.

### 7.6 What happened after the decision

Shown on accepted claims. The pill next to the heading:

| Pill | Meaning |
| --- | --- |
| Not started | The processing has not run yet. |
| Done | Every network was blocked and its fingerprinting queued. |
| Partly done | Some networks or steps did not finish. |
| Failed | Nothing could be blocked. |

Below it, one line per network:

- **Block:** *Blocked*, *Failed* (red) or *Not tried*.
- **Image hashing:** *Queued*, *Not queued* (red) or *Not available* (that network has no fingerprinting).
- "N ads found": how many ads of that advertiser the network has.
- An error text in red, if there was one.

**Retry** (only on *Partly done* and *Failed*) runs the blocking and fingerprinting again. It is safe to press more than once: nothing is added twice. A message says "Processing was run again."

**Follow this claim in Monitoring** switches to the Monitoring tab, filtered to this claim (section 10).

The grey line at the bottom is a reminder: the ads that already exist are not deleted by the decision. The background jobs remove them within a few minutes if the copyright check is switched on.

---

## 8. The Monitoring tab

Everything here is **read only**. Its title is **Takedown Monitor**: "What was deleted, what is waiting, what failed, and the log of every step. Read only."

The layout, from top to bottom: header, number boxes, network table, (follow banner), tab bar, the open tab.

### 8.1 Header and number boxes

- **Image hashing service: Healthy / Unavailable / Checking**: the state of the service that computes fingerprints. Green dot = it answers. Red dot = it does not, so fingerprinting and image checks wait (nothing is approved by mistake). It is checked every minute.
- **Refresh** reloads the numbers and the open tab and goes back to page 1. The numbers also reload by themselves every minute.

**Hover over any box** for a longer explanation.

| Box | Meaning |
| --- | --- |
| **Deleted** | Ads really deleted by takedown runs, all networks added up. A dry run never counts. |
| **Waiting** | Ads a run planned to delete that are neither done nor failed yet. Normally 0, or a few while a run is working. |
| **Failed** | Ads whose delete failed in a run. **Counted per run**, see the note below. |
| **Waiting for check** | New ads saved but hidden from search until the copyright check looks at them. Shown only when the copyright check is set up. |
| **Waiting for cleanup** | Ads that failed the check. They are already hidden; the cleanup job deletes them within about 15 minutes. |
| **Takedown runs** | How many runs there were, with the count by state (for example "Done 3 · Failed 1 · Running 1"). |
| **Hash jobs** | How many fingerprint jobs there are, by state (for example "Done 2 · Waiting 1"). |

> **Why "Failed" can look too high.** It is counted per run, not per ad. If a run stops half way (for example the server restarts), its ads count as failed in that run and are tried again by a later run. The same ad can then be "failed" in two runs and "deleted" in a third. **To know what is really still there, look at *Waiting for cleanup*.**

A yellow box "Not available (tables missing or not readable): reddit…" means those networks' tables do not exist yet or could not be read. They are **left out, not counted as zero**.

### 8.2 The network table

One row per network:

| Column | Meaning |
| --- | --- |
| Network | The network's name. |
| Runs | Takedown runs on this network. |
| Deleted / Waiting / Failed | The same as the boxes, for this network only. |
| Dry runs | Practice runs that deleted nothing. |
| Last run | When the last run started. |
| To check / to remove | Two numbers: ads **waiting for the check** (amber) / ads **failed and waiting for cleanup** (red). "not migrated": this network's ad table does not have the copyright status column yet. "—": it could not be read. |
| Hash jobs | Fingerprint jobs on this network by state, for example "Done 2", "Waiting 1". "none": no job yet. "not available": the tables are missing. |

"Takedown: not available" across a row means that network has no takedown tables yet.

**Click a row to choose that network.** The chosen row is light blue. Everything in the tabs below shows only the chosen network, whose name is at the right end of the tab bar ("Network: **facebook**"). The tabs are **below** this table: scroll down to reach them.

### 8.3 The tabs

The tab bar has eight tabs. Each tab starts with one grey sentence saying what it lists. The page opens on **Takedown runs**.

#### Ad verification

The ads on the chosen network that are **still waiting for the copyright check**, with what the check was last doing with each one.

| Column | Meaning |
| --- | --- |
| Ad | The ad, shown as advertiser, **Platform ad id** and **Our row id** (see "How an ad is shown" in section 2). |
| Current stage | What the check last did (see the list below). Blue = working normally; amber = waiting for something or a problem. |
| Image attempts | How many times the image check was tried. Resets when the check service restarts. |
| Detail | A short explanation of the stage. |
| First checked / Last checked | When the check first and last looked at the ad, and how long ago ("5m ago"). If "last checked" keeps getting older, the ad is stuck. |

Stages: *Not checked yet* (the job has not reached it), *Checking ad details*, *Checking images*, *Waiting for search index*, *Waiting for blocklist*, *Waiting for image hash service*, *Waiting for images* (the image is not uploaded yet), *Near match needs review* (the image looks a bit like a blocked one; it stays hidden), *Matched blocklist*, *Updating search index*, *Search index update failed*, *Saving verification status failed*.

An ad leaves this list once it is approved or failed. This tab refreshes by itself every minute while you are on page 1. "No ads are waiting for check on this network." is the normal, healthy state. "Per-ad stage details are not installed on this network yet" means an administrator must run the schema update for that network.

#### Takedown runs

A **run** is one pass of the cleanup job on one network: it deletes the ads that failed the copyright check.

- **Filters:** All, Failed, Running, Waiting, Done.
- **Find by complaint id**: paste a **long complaint id** and press the magnifier. It shows that complaint's runs on **all** networks. A short `CR-` reference or any other text says "That is not a complaint id." **clear** goes back to the chosen network.
  - **Today this search normally finds nothing**, and the page says so: "No takedown run is linked to this complaint." The cleanup job deletes the ads that failed the check without recording which claim caused it. Use the link under that message, **Show this claim's blocks and rejected ads instead**, or **Follow this claim** on the claim page (section 10).
- **Columns:** run code (first 8 characters) and network, **status**, **mode** (*real*, or the grey pill "dry run: deleted nothing"), **Planned**, **Done** (green), **Failed** (red), **Started**, and **Complaint / trigger**: the start of the complaint id when the run has one, otherwise what started it (*verification* = the cleanup job).

How to read Planned / Done / Failed:

| Status | Planned / Done / Failed | Meaning |
| --- | --- | --- |
| succeeded (Done) | 3 / 3 / 0 | All planned ads were deleted. |
| failed | 3 / 1 / 2 | Some deletes failed. Open the log to see why. |
| failed | 3 / 0 / 3 | The run **stopped before it finished** (for example the server restarted). The log says so. Its ads are taken by a later run. |
| running | 3 / 0 / 0 | Working now. A run still running after **1 hour** is treated as stopped and closed as failed by the next pass. |

**Click a run** to open its **log** on the right side of the screen:

- its status, *planned / done / failed* and *operator* (who or what ran it);
- **Open audit**: opens this run's audit. "There is no audit for this run: it removed no ad, or it ran before the audit was saved." is normal for those cases;
- a grey box with the run's notes, if any (for example "process stopped before the run finished…");
- one button per **system** (*sql* = database, *elastic* = search, *storage* = files, *mongo*…) with its step counts, for example "sql: succeeded 2". Click one to show only that system; click again to show all;
- a **status** list to show only steps with one status;
- the table of steps: number, system / operation, **what** was targeted (for an ad: its advertiser, platform ad id and our row id), status (with "retry *time*" if it will be tried again), tries, when, and the error text in red;
- **‹ Previous / Page N / Next ›** and the **X** to close.

"No steps recorded for this run" is normal for runs from before 5 November 2026.

#### Failed steps

The newest delete steps that failed on the chosen network: when, system / operation, **what** (for an ad: its advertiser, platform ad id and our row id), status, tries, error and next retry time. **Click a row** to open the log of its run. "No failed steps." is the healthy state.

#### Hash jobs

A **hash job** fingerprints the images of one blocked entry (an advertiser, page, ad, link or image link) on one network.

- **Filters:** All, Waiting, Running, Failed, Stopped at image limit, Ads not found, Done, No ads to hash. (Hover a filter or a status label for what it means, followed by the stored word in brackets, for example `[limit_reached]`.)
- **Stopped at image limit:** one job sends at most **50,000 images** to the hashing service. That is the default of the server setting `compliance.imageMatch.worker.maxImagesPerJob` (an administrator can set it between 1 and 1,000,000 in `config.json`; see section 16). The limit protects the hashing service and the database from one very large advertiser. When a job reaches it, it stops and keeps its place, and the images it already fingerprinted stay blocked. The rest of that advertiser's images are **not** fingerprinted until the job is continued, so copies of those images are not caught yet; blocking by advertiser name still works. There is **no button** to continue it on this page; ask an administrator.
- **Columns:** job number, what was blocked ("advertiser: Example Brand"), status, tries, last update, last error.
- **Click a job** to open **Job results**: one row per image with the ad (advertiser, platform ad id, our row id), the image address, the **result** (*hashed*, *duplicate*, *skipped*, *failed*), the reason and the time. A list filters by result. "run 1 of 1" says which run of the job you see, because a job can run again.
  - **Runs.** A job runs again each time its entry is blocked again (another claim on the same name, a block request, or Retry). When a job has more than one run, "run 3 of 3 (latest)" is a list: choose an earlier run to see its images. The panel opens on the latest run. That run can be empty even though an earlier run fingerprinted images, typically because the advertiser's ads were deleted by the cleanup in between; the empty table then says so.
  - **The counts line** ("This run: ads 17 · imagesFound 87 · requested 87 · hashed 87 · duplicates 32 · skipped 3 (video 2, too_small 1) · …") belongs to the job's **latest** run; on an earlier run it reads "Latest run:". *skipped* is followed by the reasons in brackets.
- Jobs exist on Facebook, Instagram, Reddit, Quora, Pinterest, Native, GDN, ChatGPT Ads, LinkedIn, YouTube (the video thumbnail), Google text ads and AdMob, as far as the administrator has switched them on. TikTok is not covered.

#### Blocked list

Everything blocked on the chosen network: advertisers, ads, links, websites and images. An advertiser blocked by an accepted claim appears here at once.

- **Three boxes:** *Blocked (active)* with the count by type (for example "advertiser 3 · image_hash 120"), *Revoked* (blocks that were lifted), *Expired*.
- **Filters:** All / Active / Revoked / Expired; a **type** list (Advertiser, Ad id, URL, Domain, Image URL, Image (hash), Page); a **search box** for a name or a link (press Enter or the magnifier; **clear** removes it).
- **Columns:**

| Column | Meaning |
| --- | --- |
| Type | What kind of thing is blocked. An **ad id** entry says under it which kind of id the value is: *platform ad id* (the network's id; blocks the ad at the door) or *our row id* (added by the cleanup for an ad it deleted). Hover it for the explanation. A **page** entry blocks ads by the name of the page that posted them (for example the Facebook or Instagram Page shown as the poster). It checks the same poster-name field as an **advertiser** entry, so a page block and an advertiser block of the same name count as one block. Hover the type to see what it blocks. |
| Blocked | The blocked value. A long image fingerprint is shortened to 16 characters and "…": hover to see it all. For an **image** entry, "image of the ad:" shows the ad the picture was taken from (advertiser, platform ad id, our row id). |
| Status | *active* (red), *revoked* or *expired*. A lifted block shows who lifted it and when. |
| Added by | Who or what added it, and from where (for example *landing-form* / *intake*, or *copyright-verification* / *verification* for the cleanup job). |
| Added | When, and when it expires if it does. |
| Reason (and why) | The reason written when it was added: the claim's reason, or "failed copyright verification" for the cleanup's ad ids. For those cleanup ad ids, an amber **Why** box says what the ad really matched (see below). |
| Complaint | The first 8 characters of the complaint id, as a blue link. **Hover** to see the full id. **Click** it to follow that claim (section 10). "—" means the block came from no claim. |

Under each type, a grey line says in words what that kind of block catches, for example "blocks every ad of this advertiser name" or "blocks this exact image under any advertiser".

**Why was this ad id blocked?** The cleanup job blocks the platform ad id of every ad it deletes, with the reason "failed copyright verification". That reason alone does not say what matched, so the row shows a **Why** box taken from the check's own record:

```
Why: the ad matched Advertiser name — blocked advertiser Acme Brand
Advertiser of the ad: Acme Brand
Found by the recheck of existing ads · claim 11111111 · 11 Nov 2026, 3:58 pm
```

- **the ad matched …** is the field that matched: *Advertiser name*, *Ad id*, *URL*, *Domain*, *Same image (exact)* or *Similar image* (with how many bits apart).
- **blocked …** is the block entry it hit: the advertiser name, the ad id (and which kind), the link, or the image fingerprint (hover for all of it).
- **Found by** says which check found it: the *new-ad check* (a new ad) or the *recheck of existing ads* (an ad we already had, after a new block), the claim the matched entry belongs to (if any), and when.
- "What this ad matched was not found" means no record of the match was found. On a network where the administrator has not yet added the attempts index (section 16), only the two days before the block are searched, so older blocks show this; after the index, blocks of any age show their cause. The block itself is correct either way.

The same advertiser blocked "on every network" appears once in each network's list.

#### Rejected ads

The ads the blocklist **refused or failed**, newest first. Only identifiers are kept, never the ad itself.

| Column | Meaning |
| --- | --- |
| When | When it was refused. |
| Refused because | **Advertiser name**, **Ad id**, **URL**, **Domain**, **Same image (exact)**, or **Similar image** with "N bits apart" (the smaller, the closer the copy). Under it, **matched …** says which block entry it hit, for example "matched advertiser: Acme Brand", "matched ad id (platform ad id): 990001110002" or "matched image: 3fa4…" (hover for the full value). |
| Advertiser | The ad's advertiser. When the refusal did not record one (for example an image or ad id match), it is looked up from the ad. "unknown" means it could not be found (for example the ad is already deleted). |
| Platform ad id | The network's own id for the ad. Hover the column title for the explanation. |
| Image | The image address, when an image matched. |
| Source | Which check refused it: |

| Source | Meaning |
| --- | --- |
| ingestion | Refused the moment the ad was sent in. It was **never saved**. |
| verification | A new ad failed the copyright check. The cleanup job deletes it. |
| verification-recheck | An ad we **already had** matched a new block. The cleanup job deletes it. |

#### Audit

A second record of every cleanup run: what it meant to remove and what it found removed. Our proof that the deletion happened.

- **Columns:** when, audit code, type, status (*completed* / *failed*), **Expected**, **Found** (green when equal to Expected, red when not), and the **takedown run** (click the code to open that run's log).
- **Click a row** for **Audit findings**: the status, counts, time and notes; **Open takedown run**; small pills with the count of findings by status and a list to show only one; then one row per ad: the ad (advertiser, platform ad id and our row id), the finding type (for example *blocklist_hit*), where (system / table), status and resolution (*resolved* / *removed* means the ad is gone), details (for example what was deleted from storage), when.
- "No audit yet" means no cleanup has removed an ad on that network since audits started being saved.

#### Claim requests

The same claims as the Requests tab, read only, as one table: reference, **complaint id** (start of it; hover for all), advertiser named, sender, received, decision (with who and when) and the result after an accept. Filters: All, Waiting, Accepted, Rejected.

- An accepted claim has **Follow** next to its complaint id (section 10).
- **Review and decide on the Requests tab** switches to the Requests tab, where Accept and Reject are.

---

## 9. Moving through pages

Lists that keep growing are shown **one page at a time**, not as one endless list. Under such a list you see:

```
‹ Previous    Page 2    Next ›
```

- **Next ›** shows the next (older) page. It is greyed out on the last page.
- **‹ Previous** goes back one page. It is greyed out on page 1.
- **Page N** tells you where you are.
- When everything fits on one page, the controls are hidden.

Page sizes: 25 claims (Requests and Claim requests), 25 takedown runs and audits, 50 rows on the other tabs, 100 steps or findings and 200 image results in the side panels.

Changing a filter, a search, the network, or pressing **Refresh**, goes back to **page 1**. Pages are newest first, so new rows appear on page 1.

---

## 10. Following one claim from start to end

To see everything one claim caused:

1. On the **Requests** tab, open an **accepted** claim.
2. Under *What happened after the decision*, press **Follow this claim in Monitoring**.
3. The page switches to **Monitoring › Blocked list** and shows a blue banner: "Following claim **CR-…** (**advertiser**) on **facebook**."
4. While the banner is shown:
   - **Blocked list** shows only this claim's blocks: the advertiser, and the image fingerprints its hash job added.
   - **Rejected ads** shows only the ads refused because of this claim's blocks (by name or by one of its images).
   - The banner's buttons jump to **Blocked list** or **Rejected ads**.
5. **Click another network** in the network table to see the same claim there (a claim blocks on every network).
6. Press **Stop following** to see everything again.

You can start following from two other places too: the **Complaint** link in the Blocked list, and **Follow** in Claim requests.

What following does **not** filter: **Takedown runs**, **Failed steps**, **Audit** and **Hash jobs**. Takedown runs are not linked to a claim today. To see that a claim's ads were deleted, compare its **Rejected ads** (the platform ad ids) with the **Audit** findings, or check that *Waiting for cleanup* is back to 0.

---

## 11. Every button in one table

| Button | Where | What it does | Changes data? |
| --- | --- | --- | --- |
| Copyright Request | Left menu | Opens this page | No |
| Check | Page header | Asks the server if everything works | No |
| How this page works | Page header | Opens or closes the short explanation | No |
| Retry (in an error box) | Error box | Asks the server again | No |
| Requests / Monitoring | Tab bar | Switches the tab | No |
| Round arrows | Requests | Reloads boxes, list and open claim | No |
| Waiting / Accepted / Rejected / All | Requests list | Filters the list | No |
| ‹ Previous / Next › | Under any long list | Moves one page | No |
| A claim row | Requests list | Opens the claim | No |
| Copy (complaint id) | Claim | Copies the complaint id | No |
| Copy (link) | Claim | Copies the claimant's link | No |
| Open… | Claim | Opens the claimant's link in a new tab after you confirm | No |
| Download | Claim | Saves one supporting file | No |
| Search networks | Waiting claim | Looks the name up on every network | No |
| **Accept…** then **Accept claim** | Waiting claim | **Blocks the advertiser on every network and queues image fingerprinting** | **Yes** |
| **Reject…** then **Reject claim** | Waiting claim | **Closes the claim; blocks nothing** | **Yes** |
| **Retry** | Accepted claim | **Runs blocking and fingerprinting again** | **Yes** (safe to repeat) |
| Follow this claim in Monitoring | Accepted claim | Opens Monitoring filtered to the claim | No |
| Cancel / X | Decision window | Closes it without saving | No |
| Refresh | Monitoring | Reloads numbers and the open tab | No |
| A network row | Network table | Chooses the network | No |
| Any tab name | Monitoring tab bar | Switches the view | No |
| Filters, lists, search boxes, clear | Monitoring tabs | Narrow the list | No |
| A run, step, job or audit row | Monitoring tabs | Opens its log, results or findings | No |
| Complaint link / Follow | Blocked list / Claim requests | Follows that claim | No |
| Show this claim's blocks and rejected ads instead | Empty complaint search | Follows that claim | No |
| Blocked list / Rejected ads / Stop following | Follow banner | Jump to a tab / stop the filter | No |
| Open audit / Open takedown run / run code | Run log / Audit | Opens the linked audit or run | No |
| System buttons, status lists | Run log, findings, results | Narrow the steps or rows | No |
| X | Side panel | Closes it | No |

---

## 12. Every status word

**Claim**

| Word | Meaning |
| --- | --- |
| Waiting | No decision yet. |
| Accepted | Accepted by a reviewer. The advertiser is blocked. |
| Rejected | Rejected by a reviewer. Nothing is blocked. |
| Not started / Done / Partly done / Failed | The processing after an accept (7.6). |

**Ad (copyright check)**

| Word | Meaning |
| --- | --- |
| Waiting for check | A new ad, hidden from search until the check looks at it. |
| Approved | Passed the check. Shown in search. |
| Failed, waiting for cleanup | Matched the blocklist. Hidden; the cleanup job deletes it. |

**Takedown run and step**

| Word | Meaning |
| --- | --- |
| succeeded / Done | Finished; everything planned was done. |
| failed | At least one ad or step did not succeed, or the run stopped. |
| running | Working now. |
| pending / Waiting | Not started yet, or waiting to be tried again. |
| real / dry run | A dry run only plans and deletes **nothing**. It is never counted as deleted. |
| Planned / Done / Failed | Ads the run meant to delete / deleted / did not delete. Waiting = Planned − Done − Failed. |
| Trigger *verification* | The run was started by the cleanup job. |

Any word not listed here is shown as the system wrote it.

**Hash job**

| On screen | Stored word | Meaning |
| --- | --- | --- |
| Waiting | pending | Queued, not started. |
| Running | running | Being worked on now. |
| Done | done | All the images were processed. |
| No ads to hash | no_owner | No stored ads were found for that name. Normal for a name with no ads. |
| Stopped at image limit | limit_reached | It reached the limit of 50,000 images per job (setting `maxImagesPerJob`) and stopped, keeping its place. An administrator can continue it with a fresh allowance of 50,000 (section 16). |
| Ads not found | unresolved | The ads for that entry could not be looked up (for example a link on Native, GDN or AdMob). |
| Failed | failed | It kept failing and stopped. Read *Last error*. |

**Image results:** *hashed* (fingerprint recorded), *duplicate* (same image as one already recorded), *skipped* (not an image, for example a video), *failed* (could not be downloaded or read).

**Blocklist** types: *advertiser*, *page*, *ad id* (platform id or our row id), *URL*, *domain*, *image URL*, *image hash* (fingerprint of an exact image). Status: *active* (in force), *revoked* (lifted), *expired* (ran out).

**Audit:** *completed* / *failed* (the audit); *open*, *in_progress*, *resolved*, *false_positive* (one finding). *resolved* with resolution *removed* means the ad is gone.

---

## 13. How to test the page

Use a test server, never production: an accepted claim really blocks the advertiser on every network, and if the copyright check is on, its ads are really deleted.

### 13.1 Before you start

- You are logged in and your user name is on the reviewers list.
- The top of the Copyright Request page shows tabs, not an error box.
- Ask an administrator whether the **copyright check** is switched on. If it is off, the tests in 13.4 will show no deletion, and that is correct.
- Pick a **test advertiser name** that is clearly fake, for example "QA Test Brand 2411".

### 13.2 Send a claim

Fill the copyright form on the test website with the test advertiser name and a small PDF.

Expected:

- Within a minute, the red badge in the menu and on the Requests tab goes up by one.
- **Requests**, filter *Waiting*: the claim is first in the list, with a `CR-` reference.
- Open it: claimant, reason, link and file are as you sent them. The **Complaint id** is shown in full; **Copy** copies it.
- **Download** is greyed out while the file says *scan pending*, and works once it says *scanned*.
- **Open…** on the link asks for confirmation first.

### 13.3 Decide

**Reject path:** press **Reject…**. **Reject claim** is greyed out until you type a reason. After rejecting, the claim shows "Rejected by *you*", leaves the *Waiting* filter, and nothing appears in Monitoring › Blocked list.

**Accept path** (with a second claim):

1. Press **Search networks**. Each network shows *Found*, *Not found*, *Unable to check* or *Not supported*. For a fake name, expect *Not found*.
2. Press **Accept…**. **Accept claim** is greyed out until you tick the box.
3. Accept. Expect the green message, the *Decision* line with your name, and *What happened after the decision* showing **Done**, with *Blocked* on every network.
4. Try to decide the same claim again from another browser: it is refused as already decided.

### 13.4 Follow it in Monitoring

1. Press **Follow this claim in Monitoring**. The blue banner names your claim.
2. **Blocked list** shows one *advertiser* entry with your test name, status *active*, and the complaint link.
3. Click other networks in the network table: the same entry is on each.
4. **Hash jobs** (not filtered): a job for your name appears; for a fake name it ends as **No ads to hash**.
5. **Rejected ads** for a fake name: "No ad has been refused for this claim on this network yet."
6. **Stop following**: the lists show everything again.

With a **real** advertiser that has ads (test server only, copyright check on):

- Within a few minutes, *Waiting for cleanup* goes up and **Rejected ads** (following the claim) shows its ads with source *verification-recheck*.
- Within 15 more minutes, **Takedown runs** has a new run (trigger *verification*); its log shows the steps; **Open audit** shows *Expected* = *Found*.
- *Waiting for cleanup* goes back to 0 for that network.

### 13.5 Check the reading screens

- **Pages:** on any list longer than one page, **Next ›** replaces the rows with the next page and **Page 2** shows; **‹ Previous** goes back; both are greyed out at the ends.
- **Complaint search:** in Takedown runs, paste the complaint id. Expect the message "No takedown run is linked to this complaint" and the link to the claim's blocks. Type `CR-…` instead: expect "That is not a complaint id."
- **Tooltips:** hover each number box at the top of Monitoring; each explains itself.
- **Image hashing service** shows *Healthy* or *Unavailable*, never stays on *Checking*.
- Networks without tables show "not available", never 0.

### 13.6 What to put in a bug report

- The **reference** and the **complaint id** (copy it from the claim).
- The **network** and the **tab**.
- For a run: its code (first 8 characters) and what the log says.
- For an ad: the **advertiser** and the **platform ad id** (copy them as shown; say which is which).
- A screenshot, and the time it happened.

---

## 14. Common questions

**A claim I sent is not in the list.**
The list opens on *Waiting*. Choose *All*, press the round arrows, and check the other pages. A block made without a claim is not a claim: look in Monitoring › Blocked list.

**I blocked a name, but it is not in Requests.**
Only claims appear in Requests. A direct block appears in **Monitoring › Blocked list** and its job in **Hash jobs**.

**I see an id and do not know what it is.**
Read its label: *Platform ad id* is the network's own id (use it to search), *Our row id* is our database row. Hover the label for the explanation. A long code with dashes is a complaint id, run id or audit id, depending on the column.

**The advertiser says "advertiser unknown" or "unknown".**
The name could not be found: the ad was deleted by a run from before 24 November 2026, or the advertiser table of that network could not be read. Use the platform ad id to follow it up.

**Where do I find the complaint id?**
On the claim page under the reference (with **Copy**), and in **Monitoring › Claim requests** (hover the short id).

**I searched Takedown runs by complaint id and got nothing.**
That is expected today: the cleanup job's runs are not linked to a claim. Use **Show this claim's blocks and rejected ads instead**, or **Follow this claim** on the claim page.

**"That is not a complaint id."**
You typed a `CR-` reference or something else. Paste the long id (36 characters with dashes).

**A hash job shows "No results recorded for this run". Were records lost?**
Usually not. If it says "run 3 of 3", choose run 1 or 2 in the list: an earlier run normally holds the images. The latest run finds nothing when the advertiser's ads were already deleted by the cleanup.

**Why does the same advertiser have two hash jobs?**
Before 26 November 2026, the cleanup (with the `blockAdvertiser` setting on) blocked the advertiser of the ads it deleted again, even when a claim had already blocked it. The claim blocks on "all networks" and the cleanup on one network, so these were two separate entries with two jobs fingerprinting the same images. Since then the cleanup skips an advertiser that is already blocked. Existing duplicates stay, and are harmless.

**Hash jobs show "Done 1 · No ads to hash 1". Is something wrong?**
No. *Done* is an entry whose images were fingerprinted. *No ads to hash* is a blocked name that has no stored ads.

**A hash job says "Stopped at image limit". What does it mean?**
The advertiser has more images than one job may fingerprint: 50,000 by default (setting `maxImagesPerJob`). The first 50,000 are fingerprinted and blocked; the rest are not until an administrator continues the job (section 16). The advertiser name itself is blocked either way.

**Download is greyed out.**
The file's virus scan is still pending. It becomes available once the scan is clean.

**Accept said "Accepted, but some steps did not finish."**
The decision is saved. Read the per-network lines and press **Retry**. If a network keeps failing, tell an administrator.

**When are the existing ads of an accepted advertiser removed?**
If the copyright check is on: within a few minutes they are hidden and shown in **Rejected ads** (*verification-recheck*), and the next cleanup pass (every 15 minutes) deletes them. A large advertiser takes several passes. If the check is off, nothing existing is removed.

**Deleted shows 0.**
No ad has been deleted yet: no ad failed the check, or the check is switched off. Dry runs never count.

**A run shows Failed with 3 / 0 / 3.**
It stopped before it finished, and a later run took its ads. Check that *Waiting for cleanup* is 0.

**Failed in the boxes is higher than the ads that really failed.**
Failed is counted per run. Use *Waiting for cleanup* for what is really left.

**A run log says "No steps recorded for this run".**
Runs from before 5 November 2026 did not save their steps.

**Image hashing service says Unavailable.**
The fingerprint service does not answer. Hash jobs and image checks wait until it is back; nothing is approved by mistake. Tell an administrator if it lasts.

**I was on page 3 and it jumped back to page 1.**
You changed a filter, the network, or pressed Refresh. Those always start again at page 1.

**I see "not available" or "not migrated".**
"not available": that network's tables are missing or unreadable; it is left out of the numbers. "not migrated": its ad table has no copyright status column yet.

**I was sent to the login page.**
Your login expired. Log in again.

---

## 15. Limits to know

- The decision blocks and starts fingerprinting. It does **not** delete. Existing ads are removed only by the copyright check and cleanup jobs, and only when they are switched on.
- **Takedown runs are not linked to a claim.** The complaint search of the runs normally finds nothing; follow a claim through Blocked list and Rejected ads instead.
- The check of existing ads covers new **advertiser**, **ad id** and **image** blocks. A new **URL**, **domain**, **page** or **image URL** block applies only to new ads.
- Two claims for the same advertiser are two separate claims; the page does not merge them.
- A decision cannot be undone on this page, and a block cannot be lifted from it.
- No email is sent to the claimant or to reviewers.
- The menu numbers refresh every one to two minutes, not instantly.
- The check at the moment an ad arrives (source *ingestion*) by image exists only for **Facebook, Instagram, ChatGPT Ads and AdMob**. Other networks save the ad hidden first, and the copyright check job looks at it a minute or two later.
- An ad whose image is close to a blocked one, but not close enough to be refused (*Near match needs review*), stays hidden. There is no button to decide it yet.
- A blocked **link** cannot be matched to existing ads on **Native, GDN and AdMob**; its hash job ends as *Ads not found*.
- Google text ads often have few images, so their hash jobs find little.
- **TikTok** is not covered by the copyright check, the hash jobs or the cleanup.
- Runs from before 5 November 2026 have no step log and no audit.

---

## 16. For administrators

Reviewers and testers do not need this section.

- The page talks only to **admin_panel_backend**, which checks the admin login and the **reviewers list**, then calls the claims service in `pas_node_api` with its own secret token. The browser never holds that token.
- **admin_panel_backend** settings (names only): `JWT_SECRET` (the secret that signs the admin login), `PAS_NODE_API_URL`, `COPYRIGHT_CLAIMS_ADMIN_TOKEN`, `COPYRIGHT_CLAIMS_REVIEWERS` (comma-separated user names). If one is missing the page shows "not set up".
- The **Image hashing service** indicator is answered by admin_panel_backend, which calls the service's `/health` address (fixed in `routes/copyright-claims.js`) with a 5-second timeout.
- **pas_node_api** needs `compliance.claims.enabled`, the tables `copyright_claims` and `copyright_claim_files` in the claims' home database, and its tokens in the environment. The admin token must differ from the website's token.
- **react_admin** needs `VITE_ADMIN_PANEL_API` (or `VITE_ADMIN_BACKEND_URL`) pointing at admin_panel_backend.
- **The copyright check** (section 4, steps 6 to 8):
  - Switch: `compliance.copyrightVerification.enabled` (or `COPYRIGHT_VERIFICATION_ENABLED`). It needs `compliance.blocklist.enabled`, and `compliance.imageMatch` for image checks.
  - First run `node src/services/copyrightVerification/migrate.js --apply` to add the `copyright_status` column (0 waiting, 1 approved, 2 failed). Until then the monitor shows "not migrated".
  - Run `node scripts/apply-copyright-schema.js` so each network has the copyright tables, including `copyright_verification_diagnostics` (needed by the Ad verification tab).
  - Crons: `crons.jobs.copyrightVerification` (default every 2 minutes) and `crons.jobs.copyrightCleanup` (default every 15 minutes). Both do nothing while the switch is off.
  - Existing-ad check: `recheckExisting` (on by default), `recheckEntries`, `recheckAds`, `recheckLookbackHours`.
  - **Hash job image limit:** `compliance.imageMatch.worker.maxImagesPerJob` (default 50,000, allowed 1 to 1,000,000) is the most images one hash job sends to the hashing service; the job then ends as `limit_reached` (*Stopped at image limit*). Continue it from its saved place, with a fresh allowance, with `POST /api/v1/copyright/jobs/requeue` and the body `{ "network": "facebook", "blocklistId": <the job's blocklist entry id>, "mode": "resume" }` (copyright request token required; `mode: "rerun"` instead starts the job again from scratch).
  - Other settings: `networks` (empty = all supported; TikTok never), `batchSize`, `cleanupBatchSize`, `maxHashAttempts`, `afterMaxAttempts`, `maxNasAttempts`, `blockAdvertiser`, `audit`.
  - `node src/services/copyrightVerification/migrateAttemptsIndex.js` (dry run first: it prints each network's `copyright_blocked_attempts` size; then `--apply`, optionally `--networks=`) adds `idx_blocked_attempts_ad (network, platform_ad_id)` online. Without it, the Blocked list's **Why** box only looks two days back. The monitor notices the new index within 10 minutes, no restart needed.
  - `node src/services/copyrightVerification/repairEs.js` (dry run unless `--apply`; `--networks=` to limit) is a one-time fix for search documents left at 0 while the database says 1.
- Monitoring reads the blocklist, image hash, takedown, audit and diagnostics tables and `copyright_status`. It never writes. The claim filter (`complaintId` on `/monitor/blocklist` and `/monitor/attempts`) uses the `idx_blocklist_complaint` and `idx_blocked_attempts_entry` indexes.
- Evidence files are never given out by a link; they are streamed through the login.
