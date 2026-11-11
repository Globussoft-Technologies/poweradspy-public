# Copyright Request: admin panel guide

For the reviewers and the team who use the **Copyright Request** page of the admin panel. It explains every screen, every button and every word you see, and what each one does to the data. Updated 6 November 2026.

> **Two buttons change data, everything else only reads.** On the **Requests** tab, **Accept** and **Reject** (and **Retry** after an accept) change things. Every tab under **Monitoring** is read only: nothing there can delete, block or edit anything.

## 1. What this page is for

- **Review claims.** People who say "you are showing my copyrighted work" send a claim through the website form. Each claim waits here for a person to accept or reject it.
- **Block.** Accepting a claim blocks the named advertiser, so new ads of that advertiser are refused, and queues the advertiser's images for hashing so copies of those images can be caught later.
- **Watch what happened.** The Monitoring tab shows what is blocked, which ads were refused, which images were hashed, which new ads are still waiting for the copyright check, what was deleted, is waiting or failed, and the audit of every cleanup.

Open it from the left menu: **Copyright Request** (below Competitor Tracker).

## 2. Who can use it

- You must be **logged in** to the admin panel.
- Your user name must be on the **reviewers list**. The menu item is visible to everyone, but a person who is not a reviewer sees "You do not have access to copyright requests" inside the page, and cannot see any claim.
- The name saved with every Accept, Reject or Retry is **your login name**. It cannot be typed or changed on the page.

## 3. The whole flow in one picture

| Step | What happens | Where you see it |
| --- | --- | --- |
| 1 | A person fills the **copyright form** on the website (advertiser name, their name and email, company, reason, optional link, supporting files). | not in the admin panel yet |
| 2 | The website's server sends it to our backend. The claim is saved as **Waiting** and the files are stored privately. | **Requests** tab, filter *Waiting* |
| 3 | A reviewer opens the claim, checks the documents, and presses **Accept** or **Reject**. | **Requests** tab |
| 4 | **Accept:** the advertiser is blocked on every network and its images are queued for hashing. **Reject:** nothing is blocked. | Claim details: *What happened after the decision* |
| 5 | A background job (every minute) hashes the images of the blocked advertiser. | **Monitoring, Hash jobs** |
| 6 | The blocklist entry itself is listed. | **Monitoring, Blocked list** |
| 7 | **The copyright check (every 2 minutes).** Every new ad is hidden from search until it is checked against the blocklist (advertiser name, ad id, link, domain, same or similar image). It is then **approved** (shown) or **failed**. The same job also finds the ads that **already exist** for a new blocked advertiser, ad id or image, and marks them failed. | **Monitoring:** *Waiting for check* box and **Rejected ads** |
| 8 | **The cleanup (every 15 minutes).** Failed ads are deleted from storage, the database and search. Each cleanup is one takedown run, with a log of every step and an audit. | **Monitoring, Takedown runs**, **Failed steps** and **Audit** |

> Steps 7 and 8 run only when an administrator has switched on the copyright check (section 11). The decision itself does not delete anything: the existing ads of the blocked advertiser are removed later by these two jobs, within a few minutes. The claim page says the same under *What happened after the decision*.

A block can also be added **without a claim**, by a trusted team member through the block request. That block has no entry on the Requests tab. It still appears under **Monitoring, Blocked list** (and its hash job under **Hash jobs**). The cleanup job also adds blocks by itself: the ad id of every ad it deletes (added by `copyright-verification`, from `verification`), so a copy that is scraped again is refused.

## 4. The menu item and its badges

The **Copyright Request** item in the left menu can carry small round badges. Only reviewers see them.

| Badge | Colour | Meaning |
| --- | --- | --- |
| A number | red | Claims **waiting** for a decision |
| A number | dark grey | Delete steps that **failed** |
| A number | amber | Delete steps **waiting** (shown only when nothing failed) |

The badges refresh by themselves (claims every minute, delete steps every two minutes).

## 5. The top of the page

- **Title and short line:** "Claims that came in, what was decided, and what was deleted, is waiting or failed."
- **Checked 10:16 am:** the time the page last asked the server whether everything works.
- **Check** button: asks the server again right now. It changes nothing. The page also does this by itself every minute.
- **Requests** and **Monitoring:** the two tabs. A small badge on a tab shows the same numbers as the menu (claims waiting on Requests, failed delete steps on Monitoring).

### When the page cannot work, it says why

Instead of the tabs you may see one of these boxes. Press **Retry** on the ones that have it.

| What it says | What it means | What to do |
| --- | --- | --- |
| The admin server cannot be reached | The admin backend did not answer. | Ask an administrator to start it, or check the address in the panel's settings. |
| Copyright claims are not set up on the server yet | The backend runs but a required setting is missing. | Ask an administrator (section 11). |
| You do not have access to copyright requests | Your name is not on the reviewers list. | Ask an administrator to add your user name. |
| The claims service is not answering | The backend runs but the service that stores claims is down or switched off. | Ask an administrator. |

If your login has expired you are sent to the login page.

## 6. The Requests tab

This is where claims are reviewed.

### 6.1 The three boxes at the top

| Box | Meaning |
| --- | --- |
| Waiting for review | How many claims have no decision yet. |
| Oldest waiting | How long the oldest waiting claim has been waiting, in hours. It turns **red at 48 hours or more**. |
| Accepted, but not fully processed | Accepted claims where some step after the decision did not finish. It turns **amber** when it is above zero. Open those claims and use **Retry**. |

The round arrows button next to the title **refreshes** the boxes, the list and the open claim. It changes nothing.

### 6.2 The list on the left

- **Waiting / Accepted / Rejected / All:** filters the list by decision. It opens on *Waiting*.
- Each row shows the advertiser's name, a coloured status (**Waiting** amber, **Accepted** green, **Rejected** grey), the claim reference (`CR-XXXXXX`), the company and the date received. Newest first.
- An accepted claim whose processing is not complete also shows a small **Partly done** or **Failed** tag.
- Clicking a row opens the claim on the right.
- **Load more** shows older claims.

### 6.3 One claim, on the right

From top to bottom:

| Part | What it shows |
| --- | --- |
| Name, reference, received date, status | The advertiser named by the claim, its reference and when it came in. |
| **Claimant** | Who sent it: name, company, email, and the sender's own reference if there is one. |
| **Reason** | What the claimant wrote. |
| **Link given by the claimant** | A link the claimant supplied, shown as **plain text**. It is never opened for you. **Copy** copies it. **Open…** asks for confirmation ("This is a website outside PowerAdspy... Open it in a new tab?") and then opens it. Only `https://` links can be opened. |
| **Supporting files** | The files the claimant uploaded (name, type, size, and "scanned" or "scan pending"). **Download** saves a file to your computer. It is greyed out while the scan is pending. Files are kept in a private store and are only reachable here, through your login. |
| **Does the name exist in our data?** (waiting claims only) | **Search networks** looks the name up on every network. It only reads. See 6.5. |
| **Accept…** and **Reject…** (waiting claims only) | Open the decision windows. See 6.4. |
| **Decision** (decided claims) | "Accepted by *name* on *date*" or "Rejected by...", with the reason or note if one was written. |
| **What happened after the decision** (accepted claims) | The result of blocking and hashing, network by network. See 6.6. |

### 6.4 The decision windows

**Accept…** opens "Accept this claim?". It shows the advertiser's name and says:
"The advertiser below will be blocked on every network and its images will be queued for hashing."

| Control | What it does |
| --- | --- |
| Tick box "I reviewed the supporting documents and the name is the advertiser this claim is about." | **Required.** The **Accept claim** button stays disabled until it is ticked. |
| Note | Optional, up to 255 characters. Saved with the decision. |
| **Accept claim** | Records the decision once, blocks the advertiser on every network and queues the image hashing. A green message says "Accepted. The advertiser is blocked and its images are queued." If some steps did not finish the message is amber: "Accepted, but some steps did not finish. See the details and use Retry." |
| **Cancel** or the X | Closes the window. Nothing is saved. |

**Reject…** opens "Reject this claim?". It says "Nothing will be blocked. The claim is closed."

| Control | What it does |
| --- | --- |
| Reason | **Required**, up to 255 characters. The **Reject claim** button stays disabled until a reason is written. |
| **Reject claim** | Closes the claim as rejected. Nothing is blocked. |
| **Cancel** or the X | Closes the window. Nothing is saved. |

> **A decision is made once.** If another reviewer decided the same claim a moment before you, your press is refused with a message such as "already decided" and nothing is overwritten.

### 6.5 Search networks (before you decide)

It checks, network by network, whether an advertiser with that name exists in our stored ads. It never changes anything.

| Result | Meaning |
| --- | --- |
| Found | The name exists. It shows "N ads, M advertiser(s)". |
| Not found | No advertiser of that name on that network. |
| Unable to check | The search could not run (for example no database connection). **This is not the same as "no ads found."** |
| Not supported | That network is not covered by the search. |

"Not found" or "Unable to check" does not stop you from accepting. The block is added either way and will refuse new ads of that name.

### 6.6 What happened after the decision

Shown for accepted claims. The tag next to the heading is one of:

| Tag | Meaning |
| --- | --- |
| Not started | The processing has not run. |
| Done | Every network was blocked and its hashing queued. |
| Partly done | Some networks or steps did not finish. |
| Failed | Nothing could be blocked. |

For each network the page shows **Block** (Blocked, Failed, Not tried) and **Image hashing** (Queued, Not queued, Not available), the number of ads found, and an error text if there was one.

**Retry** (shown only for *Partly done* and *Failed*) runs the blocking and hashing again. It is safe to repeat: an entry that already exists is not duplicated. A green message says "Processing was run again."

A line under the list says: "The ads that already exist are not deleted by this decision itself. When the copyright check is switched on, the background jobs find them and remove them within a few minutes; follow this under Monitoring (Rejected ads, then the takedown runs)." The check job finds them and the cleanup job deletes them (section 3, steps 7 and 8). Follow them in **Monitoring, Rejected ads** (source *verification-recheck*) and **Takedown runs**.

## 7. The Monitoring tab

Everything here is **read only**. Its title is *Takedown Monitor*.

- **Refresh** (top right) reloads the numbers and the open tab. The numbers also refresh by themselves every minute.
- A yellow note "Not available (tables missing or not readable): reddit..." means that network's tables do not exist yet or could not be read. Those networks are **not counted as zero**; they are left out.

### 7.1 The boxes at the top

| Box | Meaning |
| --- | --- |
| Deleted | Ads removed in **real** takedown runs (sum of *Done* of all runs). A dry run never counts. |
| Waiting | Ads planned in a run but neither done nor failed yet (*Planned − Done − Failed*). Normally 0, or a few while a run is working. |
| Failed | Ads whose delete failed in a run (sum of *Failed* of all runs). See the note below. |
| Waiting for check | New ads that are hidden from search until the copyright check looks at them. Shown only when the copyright check is set up. |
| Waiting for cleanup | Ads that failed the check and are not deleted yet. The cleanup job removes them within about 15 minutes. |
| Takedown runs | Number of takedown runs, with how many are done, failed, running or waiting. |
| Hash jobs | Number of image hashing jobs, with their statuses. |

> **Failed is counted per run, not per ad.** If a run stops before it finishes, its ads count as failed in that run and are tried again by a later run. The same ad can then appear as failed in several runs and as deleted in the last one. To know whether an ad is still there, look at *Waiting for cleanup*, not at *Failed*.

### 7.2 The network table

One row per network. Columns: **Runs, Deleted, Waiting, Failed, Dry runs, Last run, To check / to remove, Hash jobs**.

- **To check / to remove** shows two numbers: the ads waiting for the check (amber) and the failed ads waiting for cleanup (red). "not migrated" means that network's ad table does not have the copyright status column yet. "—" means it could not be read.

**Click a row to choose the network.** The tabs below always show the chosen network (the name is on the right of the tab bar). "Takedown: not available" or "not available" means that network's tables are missing.

> The tabs are **below** this table. Scroll down to reach them.

### 7.3 Takedown runs

A *run* is one takedown of a group of ads: either the ads of a complaint, or one pass of the cleanup job (the ads that failed the copyright check).

- Filters: **All, Failed, Running, Waiting, Done**.
- **Find by complaint id** (and the magnifier button): shows the runs of one complaint across **all** networks. It only accepts a complaint id (a long code like `11111111-1111-4111-8111-111111111111`); anything else shows "That is not a complaint id." **clear** goes back to the chosen network.
- Each row: run code, network, status, **mode** (*real*, or "dry run: deleted nothing"), **Planned**, **Done**, **Failed**, started, and **Complaint / trigger**: the first part of the complaint id, or what started the run when there is no complaint (*verification* for the cleanup job).
- How to read the counts:

| Status | Planned / Done / Failed | Meaning |
| --- | --- | --- |
| Done | 3 / 3 / 0 | All planned ads were deleted. |
| Failed | 3 / 1 / 2 | Some deletes failed. Open the log to see why. |
| Failed | 3 / 0 / 3 | The run **stopped before it finished** (for example the server restarted). Its ads were not finished here and are retried by a later run. The log says so. |
| Running | 3 / 0 / 0 | The run is working now. A run still *running* after **1 hour** is treated as stopped and closed as failed by the next cleanup pass. |

- **Click a row** to open the **log of that run** (a panel on the right):
  - the run's status, planned/done/failed counts and operator;
  - a grey box with the run's notes, when there are some (for example "process stopped before the run finished...", or a step that could not be saved);
  - **Open audit:** opens the audit of this run (see 7.8). If there is none it says "There is no audit for this run: it removed no ad, or it ran before the audit was saved.";
  - one button per **system** (sql, mongo, elastic, storage...) with the counts of its steps. Click one to show only that system, click again to clear;
  - a **status** dropdown to show only steps with one status;
  - the table of every step: system and operation, what was targeted, status, number of tries, when, and the error text. A step waiting to be tried again shows "retry" and the time;
  - **Load more** and the X (close).
- "No steps recorded for this run" is normal for runs from before 5 November 2026: steps were not saved then.
- **Load more** below the table shows older runs.

### 7.4 Failed steps

The newest steps that failed on the chosen network, with when, the system, what was targeted, the status, the number of tries, the error and the next retry time. **Click a row** to open the full log of its run. **Load more** shows older ones.

### 7.5 Hash jobs

A *hash job* looks at the images of one blocked advertiser and records a fingerprint of each, so copies can be recognised.

- Filters: **All, pending, running, failed, limit_reached, unresolved, done, no_owner**.
- Each row: job number, what was blocked, status, tries, last update and the last error.
- **Click a row** to open **Job results**: one line per image with the ad, the image address, the **result** (hashed, duplicate, skipped, failed), the reason and the time. A dropdown filters by result. "run 1 of 1" tells you which run you are looking at, because a job can run again.
- **Load more** shows more rows.
- Hash jobs run on every network the job supports (Facebook, Instagram, Reddit, Quora, Pinterest, Native, GDN, ChatGPT Ads, LinkedIn, YouTube, Google text ads and AdMob), as far as the administrator has switched them on. A blocked advertiser gets one job per network. On YouTube the image is the video's thumbnail. TikTok is not covered.
- When the administrator has switched on **carousel images**, the extra images of an ad are hashed too and appear in the job results like any other image.

### 7.6 Blocked list

Everything blocked on the chosen network: advertisers, ads, links and images. An advertiser blocked from an accepted claim, or by the block request, appears here at once.

- **Three boxes:** *Blocked (active)* with the count by type (for example "advertiser 3 · image_hash 120"), *Revoked* (blocks that were lifted), *Expired*.
- **Filters:** All / Active / Revoked / Expired; a **type** dropdown (Advertiser, Ad id, URL, Domain, Image URL, Image (hash), Page); and a **search box** for a blocked name or link (press Enter or the magnifier; **clear** removes it).
- **Table:** type, what is blocked (a long image fingerprint is shortened, hover to see it all), status, who added it and where from, when (and when it expires, if it does), the reason, and the first part of the complaint id. A lifted block shows who lifted it and when.
- An **ad id** entry also says which kind of id it is: **platform id** (the network's own ad id) or **our row id** (the id of the row in our database).
- Entries added by the cleanup job show *copyright-verification* as the adder, *verification* as the source and the reason "failed copyright verification".
- **Load more** shows older entries.

An advertiser is listed once per network. The same advertiser blocked "on every network" appears in each network's list.

### 7.7 Rejected ads

Ads that the blocklist **refused or failed** (newest first). Only identifiers are kept, never the ad itself.

| Column | Meaning |
| --- | --- |
| When | Time of the refusal. |
| Refused because | **Advertiser name**, **Ad id**, **URL**, **Domain**, **Same image (exact)**, or **Similar image** (with "N bits apart": the smaller the number, the closer the copy). |
| Advertiser, Ad id, Image | What was in the ad. The image address is shown when an image matched. |
| Source | Which check refused it (see below). |

| Source | Meaning |
| --- | --- |
| ingestion | Refused at the moment the ad was sent in. It was never saved. |
| verification | A new ad failed the copyright check. The cleanup job deletes it. |
| verification-recheck | An ad that **already existed** matched a new block (advertiser, ad id or image). The cleanup job deletes it. |

**Load more** shows older ones.

### 7.8 Audit

The audit is a second record of every cleanup: what the run expected to remove and what it found removed. It is written by the cleanup job and is read only here.

- **Table** (newest first): when, audit code, **type**, **status**, **Expected** (ads the run meant to remove), **Found** (ads it found removed; green when equal to Expected, red when not), and the **takedown run** (click the code to open that run's log).
- **Click a row** to open **Audit findings**:
  - the status, type, expected and found counts, the time, and the audit's notes;
  - **Open takedown run** goes back to the run's log;
  - small tags with the count of findings by status, and a dropdown to show only one status;
  - the table of findings: the ad (platform ad id, and "row" with our row id), the finding type (for example *blocklist_hit*), where (system / table), status and resolution, details (for example what was deleted from storage), and when.
- "No audit yet" means no cleanup has removed an ad on that network since the audit started being saved.

### 7.9 Claim requests

The claims that came in (same claims as the Requests tab), with who sent them, when, the decision and the result after an accept. Filters: **All, Waiting, Accepted, Rejected**. The link **Review and decide on the Copyright Claims page** takes you to the page where Accept and Reject are.

## 8. Every button in one table

| Button | Where | What it does | Changes data? |
| --- | --- | --- | --- |
| Copyright Request (menu) | Left menu | Opens this page | No |
| Check | Page header | Asks the server if everything works | No |
| Retry | Error box | Asks the server again | No |
| Requests / Monitoring | Page header | Switches the tab | No |
| Round arrows | Requests tab | Refreshes boxes, list and open claim | No |
| Waiting / Accepted / Rejected / All | Requests list | Filters the list | No |
| Load more | Any list | Shows older rows | No |
| A claim row | Requests list | Opens the claim | No |
| Copy | Claim, link | Copies the claimant's link | No |
| Open… | Claim, link | Opens the link in a new tab after you confirm | No |
| Download | Claim, files | Saves one supporting file to your computer | No |
| Search networks | Claim, waiting | Looks the name up on each network | No |
| **Accept…** then **Accept claim** | Claim, waiting | **Blocks the advertiser on every network and queues image hashing** | **Yes** |
| **Reject…** then **Reject claim** | Claim, waiting | **Closes the claim, blocks nothing** | **Yes** |
| **Retry** | Claim, accepted | **Runs blocking and hashing again** | **Yes** (safe to repeat) |
| Cancel / X | Decision window | Closes it without saving | No |
| Refresh | Monitoring | Reloads the numbers and the open tab | No |
| A network row | Monitoring table | Chooses the network for the tabs | No |
| Takedown runs, Failed steps, Hash jobs, Blocked list, Rejected ads, Audit, Claim requests | Monitoring tabs | Switch the view | No |
| Filter buttons, dropdowns, search | Monitoring tabs | Narrow the list | No |
| A run, step, job or audit row | Monitoring tabs | Opens its log, results or findings | No |
| Open audit | Run log | Opens the audit of that run | No |
| Open takedown run / run code | Audit | Opens the log of the linked run | No |
| X | Log, results or findings panel | Closes it | No |

## 9. Words and statuses

**Claim**

| Word | Meaning |
| --- | --- |
| Waiting | No decision yet. |
| Accepted | A reviewer accepted it. The advertiser is blocked. |
| Rejected | A reviewer rejected it. Nothing is blocked. |
| Reference `CR-XXXXXX` | The short code shown to the claimant. Quote it when asking about a claim. |
| Complaint id | A long unique code of the claim. It ties the claim to its blocks, hash jobs and takedown runs. |

**Copyright check (each ad)**

| Word | Meaning |
| --- | --- |
| Waiting for check | A new ad, hidden from search until the check looks at it. |
| Approved | It passed the check and is shown in search. |
| Failed (waiting for cleanup) | It matched the blocklist. It is hidden and the cleanup job deletes it. |

**Takedown**

| Word | Meaning |
| --- | --- |
| Run | One takedown on one network: the ads of a complaint, or one pass of the cleanup job. |
| Trigger | What started a run when there is no complaint. *verification* is the cleanup job. |
| Step | One delete action inside a run, in one system (sql, mongo, elastic, storage...). |
| Planned / Done / Failed | Ads the run meant to delete / deleted / did not delete. Waiting = Planned − Done − Failed. |
| Real / dry run | A dry run only plans and deletes **nothing**. It is never counted as deleted. |
| Done / Failed / Running / Waiting | The state of a run or step. Any other word the system uses is shown as it is. |

**Audit**

| Word | Meaning |
| --- | --- |
| Expected / Found | Ads the run meant to remove / ads found removed. They should be equal. |
| completed / failed | The state of an audit. |
| Finding | One ad checked by the audit. |
| open, in_progress, resolved, false_positive | The state of a finding. *resolved* with resolution *removed* means the ad is gone. |

**Hash job**

| Status | Meaning |
| --- | --- |
| pending | Queued, not started. |
| running | Being worked on now. |
| done | All images of the advertiser were processed. |
| no_owner | No stored ads were found for that advertiser, so there was nothing to hash. This is normal for a name with no ads. |
| limit_reached | It stopped at the safety limit of images. It can be continued. |
| unresolved | The ads for that name could not be found. |
| failed | It kept failing and stopped. |

**Image results:** *hashed* (fingerprint recorded), *duplicate* (same image as one already recorded), *skipped* (not an image, for example a video), *failed* (could not be downloaded or read).

**Blocklist types:** *advertiser* (a name), *ad id* (platform id or our row id), *URL*, *domain*, *image URL*, *image hash* (a fingerprint of an exact image), *page*. **Status:** *active* (in force), *revoked* (lifted), *expired* (ran out).

## 10. Common questions

**A claim I sent is not in the list.**
Check the filter (it opens on *Waiting*, use *All*) and press **Refresh**. A block made with the block request, without a claim, is **not** a claim: look under Monitoring, Blocked list.

**I blocked a name but "Test Brand" is not in Requests.**
Only claims appear in Requests. A direct block appears in **Monitoring, Blocked list**, and its hash job in **Hash jobs**.

**Hash jobs show "done 1 · no_owner 1". Is something wrong?**
No. *done* is an advertiser whose images were hashed. *no_owner* is a blocked name that has no stored ads.

**Download is greyed out.**
The file's virus scan is still pending. It becomes available once the scan reports clean.

**Accept says "Accepted, but some steps did not finish."**
The decision is saved. Open the claim, read the per-network result, and press **Retry**. If a network keeps failing, tell an administrator.

**I accepted a claim. When are the existing ads of that advertiser removed?**
If the copyright check is switched on: within a few minutes. The check job marks them failed (they appear in **Rejected ads** with source *verification-recheck* and in *Waiting for cleanup*), and the cleanup job deletes them in its next pass (every 15 minutes). A large advertiser is handled over several passes. If the check is switched off, nothing existing is removed.

**Deleted shows 0.**
Nothing has been deleted yet: no ad has failed the check, or the copyright check is switched off. A dry run is never counted.

**A run shows Failed with Planned 3, Done 0, Failed 3.**
That run stopped before it finished (for example the server restarted). Its ads were retried by a later run. Look for a later *Done* run with the same ads, or check that *Waiting for cleanup* is 0.

**Failed in the top boxes is higher than the ads that really failed.**
Failed is counted per run. An ad that was in two stopped runs counts twice, even if a third run deleted it. *Waiting for cleanup* shows the ads that are really still there.

**A run log says "No steps recorded for this run".**
Runs from before 5 November 2026 did not save their steps. Newer runs always do.

**Open audit says "There is no audit for this run".**
The run removed no ad, or it ran before the audit was saved.

**I see "not available" or "not migrated" for a network.**
"not available": that network's tables are missing or could not be read. It is left out of the numbers, not counted as zero. "not migrated": that network's ad table does not have the copyright status column yet.

**I was sent to the login page.**
Your login expired. Log in again.

**"Unable to check" in Search networks.**
The search could not run for that network. It does not mean "no ads". You may still accept.

## 11. For administrators

Reviewers do not need this section.

- The page talks to the **admin backend**, which checks the admin login and the **reviewers list** and then calls the claims service with its own secret. The browser never holds that secret.
- The admin backend needs these settings (names only): `JWT_SECRET` (must equal the secret that signs the admin login), `PAS_NODE_API_URL`, `COPYRIGHT_CLAIMS_ADMIN_TOKEN`, `COPYRIGHT_CLAIMS_REVIEWERS`. If any is missing the page shows "not set up".
- The claims service needs `compliance.claims.enabled` in its config, the two tables `copyright_claims` and `copyright_claim_files` in the claims' home database, and its own tokens in its environment. The admin token must differ from the token the website uses.
- The panel needs `VITE_ADMIN_PANEL_API` (or `VITE_ADMIN_BACKEND_URL`) to point at the admin backend.
- **The copyright check** (steps 7 and 8 of section 3):
  - Switched on by `compliance.copyrightVerification.enabled` (or `COPYRIGHT_VERIFICATION_ENABLED`). It needs `compliance.blocklist.enabled`, and `compliance.imageMatch` for image checks.
  - Before switching it on, run `node src/services/copyrightVerification/migrate.js --apply` to add the `copyright_status` column (0 waiting, 1 approved, 2 failed) to each network's ad table. Until then the monitor shows "not migrated".
  - Two crons: `crons.jobs.copyrightVerification` (default every 2 minutes) and `crons.jobs.copyrightCleanup` (default every 15 minutes). Both do nothing while the switch is off.
  - The check of existing ads is controlled by `recheckExisting` (on by default), `recheckEntries`, `recheckAds` and `recheckLookbackHours`.
  - Other settings: `networks` (empty means all supported; TikTok is never included), `batchSize`, `cleanupBatchSize`, `maxHashAttempts`, `afterMaxAttempts`, `maxNasAttempts`, `blockAdvertiser`, `audit`.
  - `node src/services/copyrightVerification/repairEs.js` (dry run unless `--apply`; `--networks=` to limit) is a one-time fix for search documents left at status 0 while the database says 1.
- Monitoring reads the blocklist tables, the image hash tables, the takedown and audit tables, and the `copyright_status` column of each network. It never writes to them.
- Nothing is deleted by this page. Evidence files are never given out by a link; they are streamed through the login.

## 12. Limits to know

- The decision starts blocking and hashing, **not** deletion. Existing ads are removed only by the copyright check and cleanup jobs, and only when they are switched on.
- The check of existing ads covers new **advertiser**, **ad id** and **image hash** blocks. A new **URL**, **domain**, **page** or **image URL** block applies only to new ads.
- Two claims for the same advertiser are two separate claims; the page does not merge them.
- No email is sent to the claimant or to reviewers. The claimant sees only the reference on the website.
- The numbers on the menu refresh every one to two minutes, not instantly.
- The check at the moment an ad arrives (source *ingestion*) exists today for **Facebook, Instagram, ChatGPT Ads and AdMob**. On the other networks a new ad is saved first and then checked by the copyright check job, which hides it until then.
- An ad close to a blocked image, but not close enough to be refused, stays hidden (*Waiting for check*) until the server restarts or a person decides. There is no button for this on the page yet.
- A blocked **link** (destination URL) is not matched to existing ads on **Native, GDN and AdMob**. The job then shows the status *unresolved*. Blocks by advertiser name, ad id and image are not affected.
- Hash jobs for Google text ads often find few images, because text ads mostly have none.
- TikTok is not covered by the copyright check or the hash jobs.
- Runs from before 5 November 2026 have no step log and no audit, and some of them show wrong Planned / Done / Failed counts until the one-time fix is run.
