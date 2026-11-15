#!/usr/bin/env node
// Fire-and-forget parallel `codex exec` runs (independent checks / edge cases).
// Usage: gpt-batch.mjs <jobs.json> <outDir> --cwd C --model gpt-6.1-terra|gpt-6.1-sol --effort medium|high|xhigh [--fast] [--max N] [--timeout SEC]
// jobs.json: [{ "id": "case-1", "prompt": "..." }, ...]
// Writes <outDir>/<id>.txt (final message), .jsonl (events), .err, and <outDir>/summary.json.
// Exit 0 only if every job exited 0. Ctrl-C / SIGTERM kills every running job (whole process groups).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkRun, killGroup } from './lib/appserver.mjs';

const [jobsFile, outDir, ...rest] = process.argv.slice(2);
const flag = (n, d) => (rest.includes(`--${n}`) ? rest[rest.indexOf(`--${n}`) + 1] : d);
const die = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

const model = flag('model'), effort = flag('effort'), cwd = flag('cwd');
const max = Number(flag('max', 4)), timeoutMs = Number(flag('timeout', 1800)) * 1000;
if (!jobsFile || !outDir) die('usage: gpt-batch.mjs <jobs.json> <outDir> --cwd C --model M --effort E');
let tier;
try { tier = checkRun({ model, effort, cwd, fast: rest.includes('--fast') }); } catch (e) { die(e.message); }
if (!(max >= 1) || !(timeoutMs > 0)) die('--max and --timeout must be positive numbers');

let jobs;
try { jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8')); } catch (e) { die(`cannot read ${jobsFile}: ${e.message}`); }
if (!Array.isArray(jobs) || !jobs.length) die('jobs.json must be a non-empty array');
const ids = new Set();
for (const j of jobs) {
  if (!/^[\w.-]+$/.test(j?.id ?? '') || typeof j.prompt !== 'string' || !j.prompt) die(`bad job ${JSON.stringify(j)} (need safe "id" and non-empty "prompt")`);
  if (ids.has(j.id)) die(`duplicate id ${j.id}`);
  ids.add(j.id);
}
fs.mkdirSync(outDir, { recursive: true });

const running = new Set();
const results = [];
let aborted = false;
const summarize = () => {
  const ran = new Set(results.map((r) => r.id));
  results.push(...jobs.filter((j) => !ran.has(j.id)).map((j) => ({ id: j.id, status: 'not-run' })));
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(results));
};

const run = (job) => new Promise((resolve) => {
  const o = (ext) => path.join(outDir, `${job.id}.${ext}`);
  const fds = [fs.openSync(o('jsonl'), 'w'), fs.openSync(o('err'), 'w')];
  const rec = { id: job.id, status: 'error', exit: null };
  const finish = () => { fds.forEach((fd) => fs.closeSync(fd)); results.push(rec); console.log(`${job.id}: ${rec.status}${rec.exit != null ? ` (exit ${rec.exit})` : ''}`); resolve(); };
  const p = spawn('codex', [
    'exec', '--model', model, '-c', `model_reasoning_effort=${effort}`, '-c', `service_tier="${tier}"`,
    '-c', 'approval_policy="on-request"', '-c', 'approvals_reviewer="auto_review"', '-c', 'sandbox_workspace_write.network_access=true',
    '--sandbox', 'workspace-write', '-C', cwd, '--json', '-o', o('txt'), '-',
  ], { detached: true, stdio: ['pipe', fds[0], fds[1]] });
  running.add(p);
  let timer;
  p.on('error', (e) => { rec.error = e.message; }); // a failed spawn is still followed by 'close', which finishes the job
  p.stdin.on('error', () => {}); // codex may exit before reading the prompt
  p.stdin.end(job.prompt);
  timer = setTimeout(() => { rec.status = 'timeout'; killGroup(p.pid).catch(() => {}); }, timeoutMs);
  p.on('close', (code, sig) => {
    clearTimeout(timer); running.delete(p);
    rec.exit = code ?? sig;
    if (rec.status !== 'timeout') rec.status = rec.error ? 'error' : aborted ? 'aborted' : code === 0 ? 'ok' : 'failed';
    killGroup(p.pid).catch(() => {}).then(finish); // reap anything the job left running in the background
  });
});

const abort = async (sig) => {
  if (aborted) return; aborted = true;
  console.error(`[${sig}: killing ${running.size} running job(s)]`);
  await Promise.all([...running].map((p) => killGroup(p.pid).catch(() => {})));
};
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => abort(s));

const queue = [...jobs];
await Promise.all(Array.from({ length: Math.min(max, jobs.length) }, async () => { while (queue.length && !aborted) await run(queue.shift()); }));
summarize();
const bad = results.filter((r) => r.status !== 'ok');
if (bad.length) console.error(`${bad.length}/${results.length} job(s) did not succeed: ${bad.map((r) => r.id).join(', ')}`);
process.exit(aborted ? 130 : bad.length ? 1 : 0);
