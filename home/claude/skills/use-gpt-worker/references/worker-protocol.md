# GPT Worker Protocol

How the main agent runs each GPT worker. One session per job, several jobs in parallel. Model choice, escalation and tier live in `SKILL.md`; the scripts validate model/effort and set the tier, so never bypass them with a hand-rolled `codex` call. The user's `~/.codex/config.toml` defaults (`xhigh`, `danger-full-access`, fast tier) are wrong for workers; the scripts override them.

You own each session: the worker implements; you specify, verify, steer and correct. If it cannot get there, say so — never quietly finish the work and present it as the worker's.

## Two tools (scripts in `scripts/`, run with `node`)

**Always run the worker in a background shell.** `send`, `gpt-batch.mjs`, and any `codex exec` run through Bash with `run_in_background: true` — never in the foreground, never waited on (no `sleep`, no polling loop). Keep working; the harness notifies you when the command exits, then read its output (`events.log`, `tail`, or the batch `<outDir>`). The quick control calls (`start`, `steer`, `interrupt`, `tail`, `status`, `result`, `read`, `stop`) return in seconds and run normally.

Verified against `codex-cli 0.169.0`; re-verify if the CLI version changes.

### 1. `gpt-session.mjs` — interactive session (almost every job)

One persistent `codex app-server` thread per job. The thread keeps its context across turns; you can watch it, steer it, and interrupt it.

```bash
G=/Users/sravan/.claude/skills/use-gpt-worker/scripts/gpt-session.mjs
J=<scratchpad>/session-<job>
node $G start $J --cwd <repo> --model <model> --effort <effort>
node $G send $J "<brief or follow-up>"     # runs the turn; prints only the final message
node $G steer $J "<guidance>"              # from another call, while send is running
node $G interrupt $J                       # stop the running turn
node $G tail $J                            # recent compact events
node $G status $J                          # server up/down, turn running/idle, last activity, why it exited
node $G result $J                          # the last turn's final message only (cheapest way to read the outcome)
node $G read $J                            # full thread history (JSON)
node $G stop $J                            # always stop when the job ends
```

- `send`'s output is just the worker's final message, like a subagent's report; every event goes to `events.log`. Use `tail` to see where a running turn is, and `read` for the full history only when the final message isn't enough. `send` waits until the turn finishes, so it always runs in the background (`run_in_background: true`); call `steer`/`interrupt` separately while it runs.
- The first `send` should be the brief (point to the brief file: "Read <path> and do it").
- **Permissions:** sandbox `workspace-write`, network on, approvals `on-request` routed to **auto-review** (`approvals_reviewer=auto_review`): when a command needs to leave the sandbox, a separate reviewer agent approves or denies it — no human prompt, and never `danger-full-access`. The reviewer changes who approves, not what is possible: it can't widen the sandbox. A denial comes back to the worker as a failed command. Still tell the worker in the brief not to commit, push, or touch anything outside the workspace.
- **Exit codes:** 0 ok · 1 error · 2 server problem · 3 turn timed out (`--timeout SEC`, default 1800; the turn is interrupted) · 4 turn failed/interrupted · 130 client was signalled (`send` only) (the turn keeps running; use `tail`/`steer`/`interrupt`).
- **Fault tolerance:** a supervisor owns the server and kills it, its process group, and any commands it started in their own sessions, on `stop`, on a server crash, on supervisor signals, or after 1 hour with no client activity (`GPT_SESSION_TTL_SEC`). If the supervisor itself is `kill -9`'d, run `stop`. A dropped connection is retried 5 times. If the server dies, the next call restarts it and resumes the thread (context kept), but a turn that was running is lost and must be re-sent. Never leave a session running: **always `stop` when the job ends or fails.** If `stop` errors that it could not kill a process group, kill that pid yourself.
- `events.log` in `$J` keeps every event (commands, file changes, messages, errors); `server.log` holds server errors.

### 2. `gpt-batch.mjs` — fire-and-forget fan-out

Only for one-off jobs that need no steering or follow-up: once a run starts you can't interact with it. Each job is its own `codex exec` run, in parallel.

```bash
node /Users/sravan/.claude/skills/use-gpt-worker/scripts/gpt-batch.mjs jobs.json <outDir> \
  --cwd <repo> --model <model> --effort <effort> [--max 4]
```

Run it in the background (`run_in_background: true`); you are notified when every job has finished. `jobs.json` is `[{"id":"case-1","prompt":"..."}, ...]`. Results land in `<outDir>/<id>.txt` (final message), `.jsonl` (full events), `.err`, plus `summary.json` (per-job status: ok / failed / error / timeout / aborted / not-run). Exit is 0 only if every job succeeded (130 if aborted); `--timeout SEC` (default 1800) kills a stuck job; Ctrl-C/SIGTERM kills all running jobs. A worker's `.txt` is its own summary — verify it like any other claim.

Shared helpers live in `scripts/lib/appserver.mjs`. Reuse them for any new tool instead of copying.

## UI testing and screenshots

For UI work the worker drives the app through the Codex Chrome and computer-use plugins. "Chrome" is Ardia (Chromium, ChatGPT extension installed); if the worker reports Chrome missing, it uses Ardia, never installs Chrome or launches a Playwright browser. Tell it to save every screenshot into a fresh temp folder (`<scratchpad>/shots-<job>/`). UI checks run on Terra `xhigh`: for each screenshot it compares the whole screen against the acceptance criteria, then each part one by one, and reports pass or fail per part. **You** still open the screenshots for the final review — do not accept the worker's description alone. Delete the folder when done and say so in the report. This applies to both tools.

## Verify after every turn

Never take the worker's report as evidence. Each round, independently:

1. `git status --short` and `git diff --stat` — did it change what it claims, and only that?
2. `git diff` — read the change. Look for stubs, `TODO`, commented-out assertions, weakened tests, out-of-scope files.
3. Run the verification commands from the brief and read the real output.
4. Check every acceptance criterion; for UI work, check the screenshots.

A round is complete only when the diff is coherent, verification passes, and every criterion is met. Otherwise send specific feedback: the command, actual output, file and line, what you expected. Use `steer` mid-turn if it is heading the wrong way; don't wait for it to finish.

## Effort and model changes

Run at the assigned model and effort for the whole session. On bad output or a second failed round on the same obstacle: diagnose why, `stop` the session, and `start` a new one on the next step of the ladder in `SKILL.md` with a brief that records what failed. At the top of the ladder, report back instead.

## Waiting

A turn can look idle for minutes while the worker reasons — normal. Don't block or loop on it; the background command's exit notifies you. Check progress with `tail` only when needed; never start a second session for the same job because output is slow.

## Round cap

Stop after **5** rounds and report, even if incomplete. Stop early and report if the worker oscillates between wrong approaches, the brief's diagnosis looks wrong, it touches out-of-scope files, or verification cannot be run.

## Report back (per job)

- **Status** — complete / partial / blocked.
- **Rounds used** and effort at each.
- **Files changed**, one line each.
- **Verification** — exact commands and real outcome; quote failures. For UI work, what the screenshots showed and that the folder was deleted.
- **Remaining work** and **judgment** (where you disagree with the worker or the brief).
- **Paths** — session dir, brief file.
