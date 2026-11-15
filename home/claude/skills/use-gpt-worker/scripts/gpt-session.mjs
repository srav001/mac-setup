#!/usr/bin/env node
// Persistent Codex app-server session for a GPT worker. Usage: gpt-session.mjs <cmd> <dir> [args]
//   start <dir> --cwd C --model gpt-6.1-terra|gpt-6.1-sol --effort medium|high|xhigh [--fast]   start server + thread
//   send <dir> "text" [--timeout SEC]   run a turn until it ends; prints only its final message (events go to events.log; default timeout 1800s)
//   steer <dir> "text"                  add guidance to the running turn
//   interrupt <dir>                     stop the running turn
//   tail <dir> [chars]                  recent events      status <dir>   server up/down, turn running/idle, last activity
//   result <dir>                        the last turn's final message only
//   read <dir>                          full thread history (JSON)
// start --full-access: no sandbox and no approvals; only for the T3 Code relay, never for normal workers.
//   stop <dir>                          shut everything down (always run this when the job ends)
// Exit codes: 0 ok, 1 error, 2 server problem, 3 turn timed out, 4 turn failed/interrupted, 130 client signalled.
// The server runs under a supervisor that kills it (and all its children) on `stop`, on supervisor signals,
// or after GPT_SESSION_TTL_SEC (default 3600) without any client activity.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alive, checkRun, compact, connect, descendants, freePort, killGroup, readJson, reapOrphans, ready, sleep, writeJson } from './lib/appserver.mjs';

const [cmd, dir, ...rest] = process.argv.slice(2);
const F = (n) => path.join(dir ?? '.', n);
const flag = (n, d) => (rest.includes(`--${n}`) ? rest[rest.indexOf(`--${n}`) + 1] : d);
const die = (msg, code = 1) => { console.error(`error: ${msg}`); process.exit(code); };
const exists = (f) => fs.existsSync(f);
const heartbeat = () => { try { fs.utimesSync(F('heartbeat'), new Date(), new Date()); } catch { fs.writeFileSync(F('heartbeat'), ''); } };
const logTail = () => { try { return fs.readFileSync(F('server.log'), 'utf8').slice(-600); } catch { return ''; } };

// ---------- supervisor: owns the app-server process, guarantees it never outlives its session ----------
if (cmd === '_serve') {
  const ttl = Number(process.env.GPT_SESSION_TTL_SEC || 3600) * 1000;
  const log = fs.openSync(F('server.log'), 'a');
  const port = await freePort();
  const child = spawn('codex', ['app-server', '--listen', `ws://127.0.0.1:${port}`], { detached: true, stdio: ['ignore', log, log] });
  let down = false, known = new Map();
  const shutdown = async (why, code = 0) => {
    if (down) return; down = true;
    try { writeJson(F('server.exit'), { why, at: new Date().toISOString() }); } catch {}
    await killGroup(child.pid).catch(() => {});
    reapOrphans(known); // commands the server started in their own sessions
    process.exit(code);
  };
  process.on('exit', () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }); // last resort, also on supervisor crashes
  child.on('error', (e) => shutdown(`spawn failed: ${e.message}`, 1));
  child.on('exit', (code, sig) => shutdown(`server exited (code ${code}, signal ${sig})`, 1)); // also reaps its orphaned children
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => shutdown(s));
  writeJson(F('server.json'), { supervisorPid: process.pid, serverPid: child.pid, port });
  heartbeat();
  setInterval(() => {
    known = new Map([...known, ...descendants(child.pid)]);
    if (exists(F('stop'))) shutdown('stop requested');
    else if (Date.now() - fs.statSync(F('heartbeat')).mtimeMs > ttl) shutdown('idle ttl expired');
  }, 2000);
  await new Promise(() => {});
}

// ---------- client side ----------
process.on('unhandledRejection', (e) => die(e?.stack || e, 1));
if (!cmd || !dir) die('usage: gpt-session.mjs <start|send|steer|interrupt|tail|status|result|read|stop> <dir> [args]');
if (!path.isAbsolute(dir)) die(`<dir> must be an absolute path (use the scratchpad), got ${dir}`);

const serverInfo = () => { try { return readJson(F('server.json')); } catch { return null; } };

async function serverUp() {
  const s = serverInfo();
  return s && alive(s.serverPid) && alive(s.supervisorPid) && (await ready(s.port, 5000)) ? s : null;
}

async function launchServer() {
  fs.rmSync(F('stop'), { force: true }); fs.rmSync(F('server.json'), { force: true }); fs.rmSync(F('server.exit'), { force: true });
  spawn(process.execPath, [fileURLToPath(import.meta.url), '_serve', dir], { detached: true, stdio: 'ignore' }).unref();
  for (let t = 0; t < 20000; t += 200) {
    const s = serverInfo();
    if (s && (await ready(s.port, 1000))) return s;
    if (exists(F('server.exit'))) break;
    await sleep(200);
  }
  const exit = exists(F('server.exit')) ? readJson(F('server.exit')) : 'no exit record';
  await stopServer();
  die(`app-server failed to start: ${JSON.stringify(exit)}\n${logTail()}`, 2);
}

async function ensureServer() {
  heartbeat();
  return (await serverUp()) ?? (console.error('[server was down; restarting]'), await stopServer(), await launchServer());
}

async function stopServer() {
  const s = serverInfo();
  fs.writeFileSync(F('stop'), '');
  await killGroup(s?.supervisorPid, 8000); // SIGTERM makes the supervisor shut the server group down itself
  await killGroup(s?.serverPid, 1000); // anything the server left behind
}

const loadState = () => { try { return readJson(F('state.json')); } catch { die(`no session in ${dir} (run start first)`); } };
const turnsOf = async (c, s) => (await c.call('thread/read', { threadId: s.threadId, includeTurns: true })).thread?.turns ?? [];
const activeTurn = async (c, s) => { const t = (await turnsOf(c, s)).at(-1); return t?.status === 'inProgress' ? t : undefined; }; // older in-progress turns are stale leftovers of a crash
const turnStatus = async (c, s, id) => (await turnsOf(c, s)).find((t) => t.id === id)?.status;

// The session's fixed settings, applied identically on thread/start and every thread/resume. They never change mid-session.
const settings = (s) => ({
  model: s.model, cwd: s.cwd, serviceTier: s.tier,
  ...(s.fullAccess ? { approvalPolicy: 'never', sandbox: 'danger-full-access' } : { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandbox: 'workspace-write' }),
  config: { model_reasoning_effort: s.effort, 'sandbox_workspace_write.network_access': true },
});

async function open(s) {
  const { port } = await ensureServer();
  const c = await connect(port, { acceptElicitations: s.fullAccess });
  await c.call('thread/resume', { threadId: s.threadId, ...settings(s) });
  return c;
}

// Wait for turn `id` to end. Survives a dropped connection by reconnecting and polling thread state;
// a server that had to be restarted lost the turn, which is reported as 'lost'.
async function waitTurn(c, s, id, deadline, done, handler) {
  const serverPid = serverInfo()?.serverPid;
  for (let attempt = 0; ; ) {
    const r = await Promise.race([done.then(() => 'done'), c.closed.then(() => 'closed'), sleep(Math.max(0, deadline - Date.now())).then(() => 'timeout')]);
    if (r !== 'closed') return { res: r, c };
    for (;;) {
      if (Date.now() > deadline) return { res: 'timeout', c };
      if (++attempt > 5) die('lost connection to app-server 5 times; the turn may still be running (try tail/status)', 2);
      console.error(`[connection lost, reconnecting ${attempt}/5]`);
      await sleep(1000 * attempt);
      try {
        c = await open(s);
        c.setHandler(handler);
        if (serverInfo()?.serverPid !== serverPid) return { res: 'lost', c };
        const status = await turnStatus(c, s, id);
        if (status && status !== 'inProgress') return { res: status, c };
        break;
      } catch (e) { console.error(`[reconnect failed: ${e.message}]`); }
    }
  }
}

async function main() {
  if (cmd === 'start') fs.mkdirSync(dir, { recursive: true });
  else if (!exists(dir)) die(`no session dir ${dir}`);
  heartbeat();
  if (cmd === 'start') {
    const model = flag('model'), effort = flag('effort'), cwd = flag('cwd');
    const s = { model, effort, cwd, tier: checkRun({ model, effort, cwd, fast: rest.includes('--fast') }), fullAccess: rest.includes('--full-access') };
    try { fs.writeFileSync(F('lock'), '', { flag: 'wx' }); } catch { die(`${dir} already has a session; stop it and use a new dir`); }
    try {
      const { port } = await launchServer();
      const c = await connect(port, { acceptElicitations: s.fullAccess });
      const t = await c.call('thread/start', settings(s));
      s.threadId = t.thread.id;
      // A thread cannot be resumed on a new connection until it has run one turn.
      const first = new Promise((r) => c.setHandler((m) => m.method === 'turn/completed' && r(m.params.turn?.status)));
      await c.call('turn/start', { threadId: s.threadId, model, effort, serviceTier: s.tier, input: [{ type: 'text', text: 'Reply READY.' }] });
      const status = await Promise.race([first, c.closed.then(() => 'closed'), sleep(120000).then(() => 'timeout')]);
      c.close();
      if (status !== 'completed') throw new Error(`warm-up turn ended with: ${status}`);
      writeJson(F('state.json'), s);
      console.log(`started thread ${s.threadId} (${model}, ${effort}, tier ${s.tier})`);
    } catch (e) { await stopServer(); fs.rmSync(F('lock'), { force: true }); die(`start failed: ${e.message}\n${logTail()}`, 2); }
    return;
  }

  if (cmd === 'stop') { await stopServer(); console.log('stopped'); return; }
  if (cmd === 'tail') { console.log(exists(F('events.log')) ? fs.readFileSync(F('events.log'), 'utf8').slice(-Number(rest[0] || 4000)) : ''); return; }

  const s = loadState();
  if (cmd === 'status') {
    const info = await serverUp();
    let turn = null;
    if (info) { const c = await open(s); try { turn = (await turnsOf(c, s)).at(-1)?.status ?? null; } finally { c.close(); } }
    const lastActivity = exists(F('events.log')) ? fs.statSync(F('events.log')).mtime.toISOString() : null;
    console.log(JSON.stringify({ server: info ? 'up' : 'down', turn: turn === 'inProgress' ? 'running' : turn, lastActivity, exit: exists(F('server.exit')) ? readJson(F('server.exit')) : null, ...s }));
    return;
  }

  let c = await open(s);
  try {
    if (cmd === 'result') { console.log((await turnsOf(c, s)).at(-1)?.items.findLast((i) => i.type === 'agentMessage')?.text ?? ''); return; }
    if (cmd === 'read') { console.log(JSON.stringify(await c.call('thread/read', { threadId: s.threadId, includeTurns: true }), null, 1)); return; }

    if (cmd === 'steer' || cmd === 'interrupt') {
      const active = await activeTurn(c, s);
      if (!active) die('no turn is running');
      if (cmd === 'steer') await c.call('turn/steer', { threadId: s.threadId, expectedTurnId: active.id, input: [{ type: 'text', text: rest[0] }] });
      else await c.call('turn/interrupt', { threadId: s.threadId, turnId: active.id });
      console.log(`${cmd} ok`);
      return;
    }

    if (cmd === 'send') {
      if (!rest[0]) die('send needs text');
      if (await activeTurn(c, s)) die('a turn is already running; use steer, interrupt or tail');
      let finish, outcome, final = '';
      const done = new Promise((r) => (finish = r));
      const handler = (m) => {
        const line = compact(m);
        if (line) fs.appendFileSync(F('events.log'), line);
        if (m.method === 'item/completed' && m.params.item?.type === 'agentMessage') final = m.params.item.text;
        if (m.method === 'turn/completed') { outcome = m.params.turn?.status; finish(); }
      };
      c.setHandler(handler);
      const detach = (sig) => () => { c.close(); console.error(`\n[${sig}: detached; the turn keeps running — use tail/steer/interrupt/stop]`); process.exit(130); };
      process.on('SIGINT', detach('SIGINT')); process.on('SIGTERM', detach('SIGTERM'));
      const beat = setInterval(heartbeat, 30000);
      const deadline = Date.now() + Number(flag('timeout', 1800)) * 1000;
      const r = await c.call('turn/start', { threadId: s.threadId, model: s.model, effort: s.effort, serviceTier: s.tier, cwd: s.cwd, input: [{ type: 'text', text: rest[0] }] });
      const { res, c: cur } = await waitTurn(c, s, r.turn.id, deadline, done, handler);
      clearInterval(beat);
      if (cur !== c) { c.close(); c = cur; }
      if (res !== 'done') final = (await turnsOf(c, s)).at(-1)?.items.findLast((i) => i.type === 'agentMessage')?.text ?? final;
      if (final) console.log(final);
      if (res === 'lost') die('the app-server was restarted mid-turn, so the turn was lost; re-send it', 2);
      if (res === 'timeout') {
        const err = await c.call('turn/interrupt', { threadId: s.threadId, turnId: r.turn.id }).then(() => null, (e) => e.message);
        die(err ? `turn timed out and could NOT be interrupted (${err}); run stop` : 'turn timed out and was interrupted', 3);
      }
      const status = res === 'done' ? outcome : res;
      if (status !== 'completed') die(`turn ${status}`, 4);
      return;
    }
    die(`unknown command: ${cmd}`);
  } finally { c.close(); }
}

try { await main(); } catch (e) { die(e?.message || e, 1); }
process.exit(0);
