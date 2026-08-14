# Domain-Date Elasticsearch Load-Shedding: Production Review

## Document status

| Item | Value |
| --- | --- |
| Review status | In review |
| Prepared on | 2026-08-12 |
| Branch | `fix/ai-meta-google-fallback2` |
| Branch starting commit | `ed47ab9cf` |
| Affected endpoint | `PUT /api/v1/common/insert-update-domain-date` |
| Primary incident | Elasticsearch CPU spikes, especially on the Google ad index |
| Elasticsearch topology | ES 6.8 for the domain-date networks; TikTok is ES 8+ and is outside this worker |
| SQL topology | MySQL 8.0 |

This document explains the change, its expected production behavior, compatibility constraints,
known risks, and the checks required before approval. It is intentionally written as a review
document rather than a statement that the change is automatically safe to deploy.

## 1. Executive summary

The domain-registration-date API updates SQL first and then propagates the resolved date to every
matching ad document in Elasticsearch. Most domains match few ads, but high-volume domains can
match tens of thousands. The previous implementation quickly submitted one asynchronous
`update_by_query` task per 1,000 ad ids. Because task submission returned immediately, many tasks
could become active in Elasticsearch at the same time even though submissions used application-side
concurrency. Several large domains arriving close together could therefore create overlapping ES
search and bulk-write work and cause sudden CPU spikes.

The new implementation load-sheds large ES updates through a persistent local queue:

- SQL remains the source of truth and is committed during the API request.
- Updates matching at most 100 unique ads remain synchronous.
- Larger updates are written to disk and the API returns without submitting ES work.
- One background task at a time is allowed per network across cooperating API processes.
- Each task targets at most 10,000 ad ids and uses `requests_per_second: 250`.
- The worker waits for a task to complete before starting the next chunk or domain for that network.
- Active task ids and progress are persisted so processing can resume after an API restart.
- The Painless script no-ops documents that already contain the requested date, making replay safe.
- Submission and completed-task failures use increasing backoff and move to `failed` after 10 attempts.
- Queue admission preserves a 2 GB disk reserve and caps pending jobs and total queue bytes.
- Every new chunk confirms the queued date still matches SQL, preventing stale overwrites.

Expected result: a 16,431-ad Google domain changes from approximately 17 rapidly submitted,
unthrottled ES tasks to two throttled tasks that run sequentially. This should remove task stacking
within Google and reduce average write pressure. Elasticsearch still processes internal bulk batches,
so `requests_per_second` is load shaping rather than a hard CPU limit; production metrics must be
used to validate and tune the value.

## 2. Incident and root cause

The Data Science worker continuously resolves domain registration dates and calls the domain-date
API approximately once every 10-60 seconds. A resolved date must be propagated to all ads associated
with that domain across the applicable ad networks.

Examples supplied during the incident review included:

| Domain | Approximate matched ads |
| --- | ---: |
| `music.apple.com` | 16,431 |
| `maps.google.com` | 10,623 |

The load was uneven because queue order determines when a popular domain is processed. Small domains
were inexpensive, while several high-volume domains arriving within a few minutes caused multiple
asynchronous `update_by_query` tasks to overlap.

The previous code divided ids into 1,000-id terms queries and submitted asynchronous tasks from the
request. `wait_for_completion: false` makes submission return a task id immediately; therefore,
application submission concurrency did not cap the number of tasks that remained active inside ES.
The next chunks could be submitted while earlier tasks were still running.

## 3. Before and after

| Area | Previous behavior | New behavior |
| --- | --- | --- |
| SQL update | Performed in the API request | Unchanged; SQL remains the source of truth |
| Small ES update | Synchronous when matched ads `<= 100` | Unchanged, with throttling and idempotent script added |
| Large ES update | API immediately submitted background ES tasks | API persists a queue job and submits no ES task |
| Top-level terms-query size | 1,000 ids | Up to 10,000 ids for queued jobs |
| Active tasks | Could stack after fast asynchronous submissions | At most one task per network among cooperating processes |
| Throttle | No explicit throttle | Default `requests_per_second: 250` |
| Chunk ordering | Multiple tasks could overlap | Next chunk starts only after the current task completes |
| Domain ordering | Large domains could overlap | One queued domain is processed per network at a time |
| Process coordination | In-process only | MySQL advisory lock per network |
| Restart recovery | Task ids only returned to caller | Queue job, active task id, and chunk progress persisted |
| Repeat writes | Script always assigned the field | Script sets `ctx.op = 'noop'` when the value is already correct |
| Failure behavior | Partial task submissions possible during an outage | Job retries with capped backoff and bounded dead-lettering |
| Queue disk use | No application queue | Admission caps pending jobs/bytes and preserves free disk |
| Stale corrections | Async completion could overwrite a newer date | SQL date is rechecked before each new queued chunk |
| ES refresh | `refresh: false` | Unchanged to avoid forced refresh cost |
| Version conflicts | `conflicts: proceed` | Unchanged to tolerate concurrent crawler writes |

Increasing the terms-query chunk from 1,000 to 10,000 reduces the number of top-level
`update_by_query` tasks. It does not make ES write 10,000 documents in one bulk operation;
`update_by_query` still uses its internal scroll/bulk batching. ES 6.8 defaults that internal batch
to 1,000 documents. At the configured throttle of 250, ES targets an average rate and pads time
between batches, which may still look bursty at the internal batch boundary.

## 4. Request and worker flow

### API request flow

1. The request validates the domain, date, and status rules.
2. The ten independent network operations start concurrently so SQL lookup latency does not add up
   serially across networks.
3. Each matching SQL domain row is updated first.
4. When a date is resolved, the service looks up the unique ad ids associated with the domain rows.
5. If no ads match, no ES request is made.
6. If the unique ad count is at most `esSyncMaxAds`, one synchronous `update_by_query` runs.
7. If the count exceeds `esSyncMaxAds`, the complete ES job is atomically persisted with a temporary
   file plus rename.
8. The API returns `es_mode: "async"`, `es_queued: true`, `es_queue_id`, `es_chunks`, and
   `es_requests_per_second`. `es_tasks` is empty because the request did not submit ES work.
9. A queue-write failure is reported as `elasticsearch_queue_error`; the request does not fall back
   to an immediate ES submission because that would recreate the production spike. The top-level
   response is retryable HTTP `503` with `Retry-After: 5`.
10. A failed or partial synchronous ES response is persisted to the queue for eventual convergence.
    Equivalent pending jobs are reused when a retried API call is detected.

### Background worker flow

1. `createApp()` initializes the worker only when `WORKER_ID` is absent or equals `1`. Cluster
   replacements retain this logical worker slot instead of using Node's increasing `worker.id`.
2. The worker scans the pending directory every `esQueueSweepIntervalMs`; a running network does not
   prevent later scans from discovering jobs for other idle networks.
3. Invalid job files are moved to the `failed` subdirectory for inspection.
4. Due jobs are ordered by creation time and grouped by network.
5. Different networks may process concurrently, but each network selects only its oldest due job.
6. Before processing, the worker obtains `GET_LOCK('pas:domain-date-es:<network>', 0)` from MySQL.
7. If another process owns the lock, the job remains queued and is reconsidered on a later sweep.
8. The worker submits one asynchronous, throttled ES `update_by_query` task.
9. The returned ES task id is persisted before polling starts.
10. The worker polls `GET /_tasks/{taskId}` until completion.
11. A completed response must be well formed, not timed out, conflict-free, and free of bulk/search
    failures. Only then are counts persisted and the next chunk submitted.
12. After all chunks complete, the queue file is deleted and totals are logged.
13. On a transient submission or polling error, progress stays on disk and retry is delayed.
14. The MySQL advisory lock is released using the same SQL connection that acquired it.
15. Before each new chunk, SQL is checked for the same domain-row ids and date; a superseded job is
    removed without writing its stale value to ES.
16. Submission and completed-task failures move to `failed` after the configured attempt limit.

The lock is held while an ES task runs. This is deliberate because releasing it after submission
would allow another API process to submit a second task for the same network. A process crash closes
the SQL connection, and MySQL releases the session lock automatically.

## 5. Queue persistence and recovery

Queue location:

```text
<localCache.dir>/domain-date-es-pending/
<localCache.dir>/domain-date-es-pending/failed/
```

If `localCache.dir` is relative, it is resolved from the `pas_node_api` directory. Each pending JSON
file contains:

- Queue id, network, and registration date.
- All unique ES match ids resolved from SQL.
- Current chunk index.
- Active ES task id, when one has been submitted.
- Retry count and next attempt timestamp.
- Creation timestamp and accumulated completion totals.
- Last error details after a failed attempt.

Recovery behavior:

- API restart before submission: the persisted job is found and submitted later.
- API restart after task-id persistence: the worker resumes polling the same ES task.
- Poll timeout: the active task id is retained, preventing immediate duplicate submission.
- Missing task result (`404`): the task id is cleared and the chunk is replayed after backoff.
- Completed task with ES failures: the chunk is retried after backoff.
- Completed success and failure result documents receive best-effort `.tasks` cleanup.
- Previously applied date: replay produces Painless no-ops instead of rewriting correct documents.
- Newer SQL date: the old job is marked superseded and removed before another task is submitted.
- Invalid JSON or unsupported network: the file is moved to `failed` rather than discarded.

There is a narrow crash window after Elasticsearch accepts a task but before its id is persisted.
A restart in that window can submit the same chunk again. The no-op script protects data correctness,
but the duplicate tasks could overlap temporarily. Eliminating that window would require an external
queue or a more complex submission ledger.

This queue is durable only to the lifetime of its configured storage. It survives a Node.js process
restart, but it does not survive deletion of an ephemeral container filesystem or loss of the host
disk. Production must use a persistent writable path.

## 6. Configuration

The following block has been added to the local `pas_node_api/config.json`:

```json
"domainDateUpdate": {
  "_description": "Load-shedding controls for PUT /api/v1/common/insert-update-domain-date",
  "esSyncMaxAds": 100,
  "sqlQueryTimeoutMs": 10000,
  "esRequestTimeoutMs": 10000,
  "esTermsChunkSize": 10000,
  "esRequestsPerSecond": 250,
  "esTaskPollIntervalMs": 5000,
  "esQueueSweepIntervalMs": 5000,
  "esQueueMaxPendingJobs": 5000,
  "esQueueMaxSizeMb": 512,
  "esQueueMinFreeDiskMb": 2048,
  "esQueueMaxAttempts": 10
}
```

| Setting | Default | Production effect |
| --- | ---: | --- |
| `esSyncMaxAds` | 100 | Maximum unique ads handled synchronously per network; `0` queues every non-empty update |
| `sqlQueryTimeoutMs` | 10,000 | mysql2 inactivity timeout for domain/ad-id `SELECT` operations only |
| `esRequestTimeoutMs` | 10,000 | Client timeout for sync writes, task submission, polling, and cleanup |
| `esTermsChunkSize` | 10,000 | Maximum ids in one queued terms query; chunks are sequential |
| `esRequestsPerSecond` | 250 | Average per-task update-by-query throttle |
| `esTaskPollIntervalMs` | 5,000 | Delay between checks of an active task |
| `esQueueSweepIntervalMs` | 5,000 | Delay between scans for due jobs |
| `esQueueMaxPendingJobs` | 5,000 | Pending-job admission limit |
| `esQueueMaxSizeMb` | 512 | Combined pending/failed queue-size limit |
| `esQueueMinFreeDiskMb` | 2,048 | Free disk reserve preserved by admission |
| `esQueueMaxAttempts` | 10 | Bounded submission/completed-task attempts before dead-lettering |

The source config loader also provides these defaults when the block is missing or invalid. Values
are resolved at module startup, so changing production `config.json` requires an API restart.

Important deployment detail: `pas_node_api/config.json` is ignored by Git. The local edit will not
be included in the PR or deployment artifact unless the deployment process separately supplies that
file. DevOps must add or verify this block in the production-managed config. The code defaults are
still applied if the block is absent, but an explicit production block makes tuning and review clear.

## 7. Elasticsearch 6.8 and TikTok ES 8+ compatibility

The domain-date network registry contains Facebook, LinkedIn, Instagram, Google, YouTube, Native,
Pinterest, Reddit, Quora, and GDN. TikTok is deliberately absent because it has no corresponding SQL
domain table. Therefore, this worker currently reaches only the ES 6.8 clusters.

The ES operations introduced or retained by this change are available in ES 6.8:

- `_update_by_query`
- `wait_for_completion=false`
- `requests_per_second`
- `conflicts=proceed`
- `refresh=false`
- Painless `ctx.op = 'noop'`
- `GET /_tasks/{taskId}` polling
- Completed result storage at `.tasks/task/{taskId}`
- Typed cleanup using `{ index: '.tasks', type: 'task', id: taskId }`

Official ES 6.8 references:

- [Update By Query API](https://www.elastic.co/guide/en/elasticsearch/reference/6.8/docs-update-by-query.html)
- [Task Management API](https://www.elastic.co/guide/en/elasticsearch/reference/6.8/tasks.html)

Task-result cleanup now branches on the `esMajor` exposed by `DatabaseManager`: ES 6 receives the
typed `.tasks/task/{id}` delete and ES 7+ receives a typeless delete. TikTok remains outside the
domain-date registry, but this cleanup path is safe if an ES 8 network is added later.

### Existing client-version concern

The project currently installs `@elastic/elasticsearch` 7.17.14 and uses the shared package for all
clusters. Elastic's supported client matrix pairs a 6.x client with ES 6.x, 7.17 with ES 7.x, and an
8.x client with ES 8.x. Consequently, the project's 7.17-client-to-ES-6.8 connection is not an
officially supported pairing, even if the existing calls work in production. TikTok's ES 8+ access
through the same 7.17 client also needs compatibility-mode or dedicated-client review.

This mismatch predates the load-shedding change, but the new worker introduces real use of the task
polling and task-result cleanup paths. Unit tests mock the ES client and cannot prove wire-level
compatibility. A staging test against the same ES 6.8 distribution and security configuration as
production is required before approval.

Official client reference:

- [Elasticsearch JavaScript client compatibility matrix](https://www.elastic.co/docs/reference/elasticsearch/clients/javascript/installation)

## 8. MySQL 8.0 compatibility and lock scope

MySQL 8.0 supports `GET_LOCK()` and `RELEASE_LOCK()`. Named locks are exclusive, session-scoped, and
limited to 64-character names. The generated names are safely below that limit, and the code holds
the same pooled connection from acquisition through release.

Official reference:

- [MySQL 8.0 locking functions](https://dev.mysql.com/doc/refman/8.0/en/locking-functions.html)

Production constraints:

- Every API process that must coordinate must acquire the lock from the same `mysqld` server.
- A proxy that distributes these calls across independent MySQL servers would not provide a global
  lock because `GET_LOCK()` is server-scoped.
- The SQL pool must have enough capacity for a connection to remain reserved for each concurrently
  active network task. Up to ten networks can run at once with the current design.
- If MySQL is unavailable, no new ES task is submitted; the queue remains pending.
- Session termination releases the lock, preventing a permanent lock after process failure.

## 9. Concurrency boundaries

The change guarantees a per-network boundary, not a global ES boundary:

- Maximum queued task concurrency for Google: one.
- Maximum queued task concurrency for any other single network: one.
- Maximum queued task concurrency across all ten networks: up to ten.
- Small synchronous requests may run while a queued task for that network is active because they do
  not acquire the queue's advisory lock.
- Independent network SQL operations inside an API request remain concurrent.

The reported incident was concentrated on Google, so per-network serialization addresses the known
failure mode. If cluster CPU is shared across network indices or small synchronous traffic is high,
a global concurrency cap or lock should be considered.

## 10. Error handling and data consistency

| Failure | Result |
| --- | --- |
| SQL lookup/update failure | Reported per network; no ES propagation for that failed network |
| Queue directory/write failure | SQL may already be updated; retryable HTTP `503` contains `elasticsearch_queue_error` and `Retry-After: 5` |
| ES task submission failure | Job retried with increasing backoff, then moved to `failed` at the attempt limit |
| ES polling timeout/connection failure | Active task id retained and polled again after backoff |
| ES task times out, conflicts, is malformed, or reports failures | Result cleaned up; chunk retried with increasing backoff and bounded attempts |
| ES task record missing | Chunk replayed safely using the no-op script |
| ES task-result cleanup denied | Debug logged; queue continues |
| Invalid queue file | Moved to `failed` for manual inspection |
| API process crash | MySQL lock released by session close; persisted job resumes on restart |
| Cluster worker 1 crashes repeatedly | Every replacement keeps logical `WORKER_ID=1`, so queue ownership resumes |
| SQL lock provider unavailable | Processing fails closed and the job stays queued |
| SQL date changed after enqueue | Superseded job is removed before a new chunk is submitted |
| Queue count/size/disk reserve reached | New enqueue fails visibly without consuming more disk |

SQL and ES are not part of one distributed transaction. This is unchanged from the earlier design.
If SQL succeeds but queue persistence fails, SQL is correct but ES is not yet represented durably.
The API therefore returns HTTP `503`; the DS caller must retry the same idempotent request. Existing
equivalent pending jobs are reused when found, so retries do not normally duplicate queued work.

Submission and completed-task failures use a linear 30-second step capped at 10 minutes and move to
`failed` after `esQueueMaxAttempts`. Polling errors retain an active task id beyond that limit because
the ES task may still be running and must not be duplicated. Operations must alert on old active-task
jobs, queue admission failures, and files moved to `failed`.

## 11. API contract changes

Small-domain responses continue to include an exact synchronous `es_updated` count.

Large-domain responses now contain:

```json
{
  "es_mode": "async",
  "es_matched_ads": 16431,
  "es_tasks": [],
  "es_queued": true,
  "es_queue_id": "<queue-id>",
  "es_chunks": 2,
  "es_requests_per_second": 250
}
```

The response summary adds `es_queued_networks`. Existing fields remain, but consumers that assumed
`es_tasks` would contain task ids immediately must be reviewed. The DS caller should treat SQL/API
success plus `es_queued: true` as accepted for eventual ES propagation, not as ES completion.
HTTP `503` with `elasticsearch_queue_error` is not accepted and must be retried after `Retry-After`.

## 12. Observability

New or updated log events:

- `domain date ES update queued`
- `domain date ES queue worker initialized`
- `domain date ES task submitted`
- `domain date ES queue job completed`
- `domain date ES queue job deferred`
- `domain date ES queue job superseded`
- `domain date ES queue job moved to failed after retry limit`
- `domain date ES queue network unavailable`
- `domain date ES task result cleanup skipped`
- `invalid domain date ES queue job moved to failed`

Recommended production monitoring:

| Signal | What to watch |
| --- | --- |
| ES CPU | Peak and average CPU before/after rollout, especially Google |
| ES task count | Number and age of `indices:data/write/update/byquery` tasks per network |
| ES write pressure | Bulk/write thread-pool queue and rejected operations |
| Queue depth | Count of pending `.json` files by network |
| Oldest queue age | Time since the oldest pending job's `createdAt` |
| Failed files | Any files under `domain-date-es-pending/failed` |
| Retry logs | Repeated deferrals, task ids, status codes, and attempt counts |
| Completion rate | Queue completions and duration by network |
| MySQL pool | Pool saturation while advisory locks hold connections |
| API latency | Request duration and queue-write time for large domains |
| Data convergence | Sample SQL dates against ES values after queued completion |

The queue currently has no admin API or exported metric for depth/age. Initial monitoring depends on
structured logs and filesystem inspection. An alert should be configured for jobs older than an
agreed service-level threshold.

## 13. Test coverage and current validation

Relevant automated coverage includes:

- Queue jobs are fully persisted before enqueue returns.
- A 15,000-id job is divided into 10,000 and 5,000-id chunks.
- The second chunk is not submitted before the first task completes.
- Every queued task receives the configured throttle.
- The Painless script contains the no-op guard.
- `GET_LOCK` and `RELEASE_LOCK` are called on the pooled connection.
- A job remains pending when another process owns the network lock.
- Processing fails closed when SQL cannot provide the distributed lock.
- An active task id survives a transient poll failure.
- A long-running network does not block discovery for another idle network.
- Retry attempts increase across completed task failures and dead-letter at the configured limit.
- Timed-out, conflicted, malformed, bulk-failed, and search-failed ES responses cannot advance a chunk.
- Failed or partial synchronous writes are durably deferred instead of being lost after SQL commits.
- Queue-admission failure returns retryable HTTP 503, and equivalent request retries reuse pending work.
- Successful and failed task results receive version-aware cleanup.
- Superseded jobs cannot overwrite a newer SQL date.
- Pending-count, queue-size, and free-disk admission controls reject safely.
- Large requests enqueue without submitting ES work in the request.
- Queue failure does not fall back to a burst of ES tasks.
- Small-domain propagation, epoch date conversion, SQL timeouts, and per-network errors remain covered.
- Worker startup is limited to logical worker 1, including after repeated cluster replacements.
- Config defaults, file values, and invalid-value fallback are covered.

Latest local validation completed while developing this change:

| Test scope | Result |
| --- | --- |
| Focused cluster/app/config/domain-date/queue suites | 89 passed, 0 failed |
| Full API test suite | 5,194 passed, 137 failed |

The full-suite failures were reviewed as unrelated existing failures, but the full suite is not green.
This must be considered according to the team's merge policy. No automated test in the current suite
uses a real ES 6.8 cluster, a real MySQL 8 advisory lock across two API processes, or production-like
CPU/load. Those checks remain part of staging validation.

## 14. Production prerequisites

Approval should require all of the following:

- Production config contains the reviewed `domainDateUpdate` values.
- `localCache.dir` resolves to a persistent, writable filesystem with sufficient space.
- Every API host starts exactly one queue worker (`WORKER_ID=1` ownership is verified).
- All coordinating API hosts use the same MySQL server for advisory locks.
- The MySQL connection pool can tolerate long-held worker connections.
- The ES account can submit `update_by_query` and call `GET /_tasks/{taskId}`.
- The ES account can preferably delete `.tasks/task/{taskId}`; this permission is non-blocking.
- A real ES 6.8 staging test verifies request names, task polling response shape, and typed cleanup
  through the installed 7.17 JavaScript client.
- Queue disk growth and oldest-job age have an operational alert or manual runbook.
- DS confirms it does not require immediate non-empty `es_tasks` values.
- DevOps agrees on initial throttle and success thresholds for ES CPU and queue delay.

## 15. Automated production preflight

The standalone preflight can be copied with the release and run before the changed application code
is started. It resolves credentials through the same production configuration as the API and never
prints them.

Run the strongest Google check first because Google is the reported incident path:

```bash
NODE_ENV=production node scripts/verify-domain-date-production-readiness.js --network google --active --strict
```

Then verify every network participating in domain-date propagation with zero-match tasks against
the configured real indices:

```bash
NODE_ENV=production node scripts/verify-domain-date-production-readiness.js --all --strict
```

`--active` creates a uniquely named, one-shard temporary ES index. It verifies a real YMD update,
an idempotent no-op, an epoch-second update, task polling/result validation, and cleanup, then always
attempts to delete the temporary index in a `finally` block. It never updates a production ad index. The default mode
submits `match_none` update tasks against the configured indices, so it verifies permissions and the
async task response without matching or modifying ad documents. `--read-only` is available when even
zero-match tasks are not allowed, but that mode cannot prove the task lifecycle.

Exit code `0` means all blocking checks passed. Exit code `1` means a failure was found; with
`--strict`, warnings such as a missing reviewed config block or inability to clean `.tasks` also make
the command fail. The output intentionally states that a pass proves runtime prerequisites and wire
compatibility, not the deployed commit SHA, sustained CPU behavior, or multi-host storage topology.
Those still require the canary steps below.

## 16. Recommended staging test

1. Deploy the code with the production-intended config and persistent queue path.
2. Confirm exactly one `domain date ES queue worker initialized` event per API host.
3. Call the endpoint for a domain matching fewer than 100 ads and verify synchronous SQL/ES values.
4. Call it for a controlled domain matching more than 100 ads and verify the API queues without an
   immediate ES task submission from the request.
5. Confirm the queue file contains the expected network, date, ids, and initial progress.
6. Confirm the worker obtains the MySQL advisory lock and submits one throttled task.
7. Restart the API while the task is active and confirm it resumes polling the same task id.
8. Run two API processes against the same MySQL server and verify only one task for Google runs.
9. Use a 10,000+ ad test domain and confirm chunk two starts only after chunk one completes.
10. Verify the final ES date, no-op behavior on replay, and removal of the pending file.
11. Deny or simulate task-result cleanup failure and confirm the queue still completes.
12. Measure ES CPU, write queue, task duration, API latency, and queue delay at `250`.
13. Lower `esRequestsPerSecond` if CPU peaks remain unacceptable; restart and repeat.

Suggested acceptance criteria should be agreed with DevOps before testing. At minimum, there should
be no overlapping Google queue tasks, no ES write rejections, no growing queue without recovery, and
verified SQL-to-ES convergence.

## 17. Rollout plan

1. Back up the production-managed `config.json` and record current ES CPU/task baselines.
2. Ensure the persistent queue directory exists or can be created by the API user.
3. Deploy to one canary host and confirm startup ownership, lock acquisition, and permissions.
4. Send one small and one controlled large domain update.
5. Monitor CPU, ES tasks, pending files, retries, and convergence through completion.
6. Roll out remaining hosts while verifying the MySQL lock prevents duplicate per-network work.
7. Keep the DS request rate unchanged initially so the code change is the only load variable.
8. Monitor for at least one normal high-volume processing window before declaring success.
9. Tune `esRequestsPerSecond` downward if CPU remains too bursty, accepting longer queue latency.

## 18. Rollback and emergency handling

There is currently no dedicated feature flag that disables only the queue worker. A safe rollback
must account for pending files and ES tasks:

1. Pause the DS domain-date caller if ES is under immediate pressure.
2. Record pending queue files and active task ids before stopping API processes.
3. Allow active work to drain when safe, or cancel active ES tasks during an emergency.
4. Preserve pending queue files; do not delete them unless SQL-to-ES repair is handled separately.
5. Deploying the previous code stops queue consumption and may restore the original burst behavior
   if DS calls resume.
6. If the new code is redeployed, retained queue files will resume automatically.
7. Verify SQL-to-ES convergence for any jobs interrupted during rollback.

Adding `domainDateUpdate.workerEnabled` before production would make emergency rollback and controlled
canary operation safer. Without it, stopping the worker requires process/deployment intervention.

## 19. Known limitations and review decisions

The following are not hidden by the implementation and should be accepted, mitigated, or changed by
the reviewer before approval:

| Item | Impact | Suggested decision |
| --- | --- | --- |
| Local filesystem queue | Jobs are lost with ephemeral host storage | Require persistent volume/disk |
| Per-network, not global, limit | Up to ten queued ES tasks can run across networks | Accept for Google incident or add global cap |
| Small writes bypass queue lock | Small synchronous writes can overlap a large task | Accept due to `<= 100` size or queue all writes |
| Worker holds SQL connection | One pooled connection per active network task | Verify pool capacity |
| MySQL lock is single-server scope | Multi-primary/routed connections may not coordinate | Pin lock calls to one server |
| ES 7.17 client against ES 6.8 | Officially unsupported client/server pairing | Mandatory real ES 6.8 staging test; plan adapter/client fix |
| No worker feature flag | Operational rollback is less controlled | Recommended follow-up before production |
| No queue metrics/admin endpoint | Backlog depends on logs/filesystem checks | Add alert/runbook or health metric |
| Active-task polling can remain pending | Avoids duplicating an ES task whose state is temporarily unreachable | Alert on active-task age and investigate manually |
| Crash before task-id persistence | Brief duplicate task is possible | Accept idempotent replay risk or use external queue |
| Unit tests mock infrastructure | No wire/load guarantee | Complete staging test |
| Full test suite not green | Merge confidence depends on failure baseline | Confirm failures are accepted by team policy |

## 20. Files changed

| File | Purpose |
| --- | --- |
| `src/services/common/helpers/domainDateEsQueue.js` | Durable queue, advisory lock, ES task lifecycle, retries, and worker |
| `src/services/common/services/updateDomainDateService.js` | Routes large updates to the queue and throttles small updates |
| `src/app.js` | Starts the queue worker on the owning process |
| `src/server.js` / `src/clusterWorkerIdentity.js` | Preserve logical worker ownership across cluster restarts |
| `src/services/common/controllers/updateDomainDateController.js` | Returns `Retry-After` for queue-admission failures |
| `src/config/index.js` | Loads and validates queue/load-shedding controls |
| `config.json` | Local production-value example; ignored by Git and must be deployed separately |
| `docs/INSERT_UPDATE_DOMAIN_DATE_API.md` | Updates API contract and operational behavior |
| `tests/services/common/domainDateEsQueue.test.mjs` | Queue ordering, persistence, throttle, lock, and recovery tests |
| `tests/services/common/updateDomainDateService.test.mjs` | API/service enqueue and failure behavior tests |
| `tests/services/common/updateDomainDateController.test.mjs` | Retryable queue-admission response/header tests |
| `tests/app.test.mjs` | Worker startup ownership tests |
| `tests/clusterWorkerIdentity.test.mjs` | Repeated worker-replacement ownership regression tests |
| `tests/config/index.test.mjs` | Configuration loading/default tests |
| `scripts/verify-domain-date-production-readiness.js` | Safe production environment and ES/MySQL wire preflight |
| `tests/scripts/verifyDomainDateProductionReadiness.test.mjs` | Preflight parser, mapping, and task-result validation tests |
| `Release_Notes/Anij_Release_Notes.md` | Change summary for release tracking |

## 21. Reviewer sign-off

| Review area | Owner | Decision / evidence |
| --- | --- | --- |
| Application design | Senior engineer | Pending |
| Real ES 6.8 compatibility | Backend/DevOps | Pending |
| MySQL advisory-lock topology | DBA/DevOps | Pending |
| Persistent queue storage | DevOps | Pending |
| ES permissions | DevOps | Pending |
| DS response compatibility | Data Science | Pending |
| Load-test acceptance | DevOps/Backend | Pending |
| Rollout and rollback plan | Release owner | Pending |

Recommended approval state: **conditionally ready for staging, not yet proven production-ready**.
Production approval should follow successful ES 6.8/MySQL 8 integration testing and confirmation of
the deployment prerequisites above.
