---
name: use-gpt-worker
description: Run GPT workers (Codex CLI) as your subagents, instead of Claude subagents. The default for every task that uses subagents, whether or not the user asks; skip only when the user explicitly asks for Haiku/Sonnet subagents. Covers parallel work, UI and computer-use testing that Claude models can't do alone (CW Agents and Customware sign-in, the user's browser Ardia, Safari, desktop apps), and for build, fix and refactor handoffs.
---

# Use GPT Workers

GPT workers are your subagents: they do the work, you split it, brief it, run it, check it and stay accountable. Never accept a worker's claim of success as evidence of success.

GPT workers are the default subagents for every task, without the user asking. Use Claude subagents (Haiku, Sonnet) only when the user explicitly asks for them.

## The rules

1. **No Claude subagents** (Haiku, Sonnet) unless the user explicitly asks. GPT workers replace them, and you run every worker yourself.
2. **Parallel by default.** Split the work into independent jobs (separate files, scenarios, searches, checks) and run several workers at once, each in its own background shell. Jobs that touch the same files stay in one worker.
3. **Models** (state the choice to the user before starting):

   | Model | Effort | When |
   | --- | --- | --- |
   | `gpt-6.2-sol` | `low` | the default for targeted edits and smaller changes |
   | `gpt-6.2-sol` | `medium` | much more complex work only, or after a Sol `low` worker's output is bad or it fails twice on the same job |
   | `gpt-6.2-sol` | `high` | after a Sol `medium` worker's output is bad or it fails twice on the same job |
   | `gpt-6.2-sol` | `xhigh` | every review, always |
   | `gpt-6.1-terra` | `medium` | all search, exploration and research; computer use and browser work |
   | `gpt-6.1-terra` | `high` | more complex computer use |
   | `gpt-6.1-terra` | `xhigh` | after a Terra `high` worker's output is bad or it fails twice on the same job; and UI checks: confirming a change landed, emulating a real user, and comparing screenshots whole and part by part |

   Terra does only two kinds of work: search, exploration and research, and Chrome/Ardia and computer use. Only Terra does computer use; Sol never drives a browser or app. Terra stays on 6.1; Sol is always 6.2.

4. **Tier:** default only. Pass `--fast` (priority tier) only when the user asks.
5. Honor an explicit model or effort request from the user. Never `max` or `ultra` (the scripts reject both).

## Escalating

- **Never change model or effort inside a session** (it burns money). Settings are fixed at `start`.
- On bad output or a second failure on the same job: find why it failed and what to do differently, `stop` the session, then `start` a new one on the next step with those findings in the brief.
- Ladders: for edits and changes, Sol `low` → Sol `medium` → Sol `high`; for exploration and computer use, Terra `medium` → Terra `high` → Terra `xhigh`. Start higher when the job is knowingly hard (long multi-step UI flows, flaky or stateful apps). If the top step also fails, report back instead.

## Computer use and browsers

Workers drive UIs through the Codex Chrome and computer-use plugins, which can do what Claude models can't:

- **Project testing skills** live in `/Users/sravan/.codex/skills/`. For CW Agents, tell the worker to follow `/Users/sravan/.codex/skills/cw-agents-testing/SKILL.md`; it covers sign-in, the browser and console checks.
- **The user's browser.** "Chrome" here means **Ardia**, a Chromium browser with the ChatGPT/Codex extension already installed. Say so in every browser brief: if the worker reports Chrome missing, it should use Ardia (`open -a Ardia <url>`), never install Chrome or launch a Playwright browser.
- **When the Chrome plugin can't do something, use the `ardia` CLI.** The ChatGPT/Chrome plugin's page evaluation is read-only, its file upload needs a consent prompt plus "Allow access to file URLs", and worker sessions refuse its prompts. The installed `ardia` command (`~/.local/bin/ardia`, skill `~/.claude/skills/ardia/SKILL.md`; Ardia Settings > Advanced > Command line is on) drives the same signed-in Ardia from the shell: `ardia browse --session <job> open|fill|click|press|wait|screenshot|eval`. `eval` can change the page, so a file upload works by building the file in the page: `new File([text], name, {type})` into a `DataTransfer`, set it on the `input[type=file]` and dispatch `change` (pass long JS with `eval -b <base64>`). `ardia browse upload`, `cookies` and `state` are gated (refused over the real connection). You can run it yourself instead of briefing a worker; a worker brief must name it explicitly. A worker that uses it must be started with `--full-access` (see Ardia CLI sessions below): in the normal sandbox every `ardia browse` command fails writing Ardia's daemon log.
- **Other desktop apps** via computer use: Safari, native apps.

Screenshots:

1. Each worker saves every screenshot into a fresh folder (`<scratchpad>/shots-<job>/`).
2. UI checks run on Terra `xhigh`. For each screenshot it compares the whole screen against the acceptance criteria, then each part (header, navigation, content, controls, empty and error states) one by one, and reports a pass or fail per part with what it saw.
3. You open the screenshots for the final review, delete the folder afterwards, and say so in the report.

## Tools

Scripts in `scripts/`; full usage in `references/worker-protocol.md`.

- `gpt-session.mjs` — **use for almost every job.** A persistent session you control while it runs: it keeps context, streams every message, and you can `steer`, `interrupt` and follow up.
- `gpt-batch.mjs` (plain `codex exec`) — only for one-off jobs that need no steering or follow-up. Once it starts you can't interact with it.

Rules:

- **Always run workers in background shells** (`run_in_background: true`). Never wait on one: no `sleep`, no polling loop. Keep working; the harness notifies you on exit. Use `tail`/`status` only for a progress check.
- One session per job. Never split one job across sessions or run two models on one job at once. A failed session is stopped before its replacement starts.
- Always `stop` a session when its job ends or fails; a leaked session is a leaked process tree.

## Prepare each brief

Finish the investigation that makes the job specifiable and decide acceptance criteria first. Then write one self-contained brief file per job in the scratchpad (absolute path) with:

1. exact task and definition of done;
2. repo root, files in scope, non-goals, files not to touch;
3. build/test commands, conventions, `CLAUDE.md`/`AGENTS.md` constraints;
4. original request or symptom, evidence so far, approaches tried and how they failed;
5. current diagnosis, marked as diagnosis, with your uncertainties;
6. how to verify (exact commands, or the UI flow and expected result);
7. for UI work: app URL, testing skill to follow, the screenshot folder, and the Chrome-means-Ardia note.

Don't use this skill when the job is faster to do yourself than to specify, or the scope is still undefined.

## Check the results

1. Read each worker's output and the diff it left (`git status`, `git diff`).
2. Confirm material claims yourself: read the code, run the checks, open the screenshots.
3. Separate verified, plausible-but-unchecked, and wrong/incomplete.
4. Get a Sol review (below).
5. Tell the user what changed, how it was verified, and what remains.

## Sol review

Run it read-only at `xhigh`, in a background shell:

```bash
codex exec -m gpt-6.2-sol -c model_reasoning_effort=xhigh -s read-only "<brief>" < /dev/null
```

Add `-c service_tier=priority` only when the user asks for fast.

The review is two thorough passes, and the brief asks for both by name, simplification first and bugs second, with a per-file answer for each. Never brief Sol for bugs alone.

1. **Simplification** (carries the most weight). Read every changed line and reduce the code while keeping behaviour and guarantees the same:
   - remove unnecessary checks, guards, flags and re-validation of values already guaranteed;
   - remove unwanted and near-duplicate paths, single-use helpers and wrappers, and anything dead;
   - simplify the logic, especially fixes stacked on earlier fixes across review rounds;
   - check the code uses the project's correct patterns and replace what does not.

   Report per file: what was cut or simplified, and lines before and after.
2. **Bugs:** real and possible bugs.

Scope: non-UI work, the code only. UI work, the code plus part-by-part screenshot comparisons against criteria you write.

Accept a finding only once you confirm it (with numbers for performance claims). Note far-fetched or very minor findings as not fixed, with the reason. Stop after 2 or 3 rounds.

## Constraints

- Workers never commit, push or touch production. Changes come back in the working tree.
- Never start a second session for a job because the first is slow.
- Never leave contrary evidence or failed approaches out of a brief.
- Permissions are fixed by the scripts: `workspace-write` sandbox with auto-review approvals. Never `danger-full-access` or approvals `never`. `start --full-access` exists only for the T3 Code relay, sign-in sessions and `ardia` CLI sessions.
- **Sign-in sessions (emailed codes, OTPs):** any flow that requests, reads and enters a one-time code runs in its own dedicated session, `gpt-6.1-terra` at `high`, started with `--full-access` (no sandbox, no approvals) so neither the approval reviewer nor the classifier blocks it. That session alone requests the code, reads it from the inbox, types it into the sign-in form, confirms sign-in and hands back. Stop it at once, then run every other worker in the normal mode. It never passes the code to a file, pipe or report. The project testing skill (e.g. `cw-agents-testing`) gives the exact flow.
- **Ardia CLI sessions:** like sign-in sessions, any worker that drives Ardia with the `ardia` CLI (for example when the Chrome plugin is restricted: read-only page eval, refused uploads or permission prompts) runs in its own session started with `--full-access`, because the normal sandbox blocks the CLI's writes outside the workspace. Keep its brief to the browser job, have it use its own `--session <job>` and new tabs, never other sessions' tabs, and stop it as soon as the job ends.
