// Shared helpers for talking to a Codex app-server (JSON-RPC 2.0 over WebSocket) and managing processes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const compact = (m) => {
  const p = m.params || {}, it = p.item || {};
  if (m.method === 'item/completed' && it.type === 'agentMessage') return `\n[message] ${it.text}`;
  if (m.method === 'item/started' && !['agentMessage', 'userMessage', 'reasoning'].includes(it.type))
    return `\n[${it.type}] ${it.command ?? it.changes?.map((c) => c.path).join(',') ?? it.tool ?? ''}`;
  if (m.method === 'error') return `\n[error] ${JSON.stringify(p.error ?? p)}`;
  if (m.serverRequest) return m.accepted ? `\n[elicitation accepted] ${JSON.stringify(m.params).slice(0, 400)}` : `\n[server request refused] ${m.method}`;
  if (m.method === 'turn/completed') return `\n[turn ${p.turn?.status}${p.turn?.error ? ` ${JSON.stringify(p.turn.error)}` : ''}]`;
};

export const writeJson = (file, obj) => {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(obj));
  fs.renameSync(`${file}.tmp`, file); // atomic: readers never see a half-written file
};
export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const ping = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export const alive = (pid) => !!pid && ping(pid);
const groupAlive = (pid) => !!pid && (ping(pid) || ping(-pid)); // the leader may be dead while its children live on

// Kill a process group (the process and everything it spawned): TERM, wait, then KILL.
export async function killGroup(pid, graceMs = 5000) {
  const send = (sig) => { try { process.kill(-pid, sig); } catch { try { process.kill(pid, sig); } catch {} } };
  if (!groupAlive(pid)) return;
  send('SIGTERM');
  for (let t = 0; t < graceMs && groupAlive(pid); t += 100) await sleep(100);
  if (groupAlive(pid)) { send('SIGKILL'); for (let t = 0; t < 2000 && groupAlive(pid); t += 100) await sleep(100); }
  if (groupAlive(pid)) throw new Error(`could not kill process group ${pid}`);
}

const psTable = () => { // Map(pid -> ppid) of every process
  try { return new Map(execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n').map((r) => r.trim().split(/\s+/).map(Number))); } catch { return new Map(); }
};

// All descendants of `root` as a Map(pid -> ppid). Commands a worker runs often detach from the server's process group.
export function descendants(root) {
  const all = psTable(), tree = new Map();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of all) if (!tree.has(pid) && (ppid === root || tree.has(ppid))) { tree.set(pid, ppid); grew = true; }
  }
  return tree;
}

// SIGKILL previously seen descendants that survived their parent (orphans are re-parented to pid 1).
export function reapOrphans(known) {
  const all = psTable();
  for (const pid of known.keys()) if (all.get(pid) === 1 || known.has(all.get(pid))) { try { process.kill(pid, 'SIGKILL'); } catch {} }
}

// Validate the flags shared by gpt-session and gpt-batch. Returns the service tier: fast (priority) only with --fast.
export function checkRun({ model, effort, cwd, fast }) {
  if (!['gpt-6.1-terra', 'gpt-6.1-sol'].includes(model)) throw new Error('--model must be gpt-6.1-terra or gpt-6.1-sol');
  if (!['medium', 'high', 'xhigh'].includes(effort)) throw new Error('--effort must be medium, high or xhigh');
  if (!cwd || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error('--cwd must be an existing directory');
  return fast ? 'priority' : 'default';
}

// Pipes are async on macOS: make stdout/stderr blocking so process.exit() cannot drop buffered output.
for (const s of [process.stdout, process.stderr]) s._handle?.setBlocking?.(true);

export const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

export async function ready(port, timeoutMs = 15000) {
  for (let t = 0; t < timeoutMs; t += 200) {
    try { if ((await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(1000) })).ok) return true; } catch {}
    await sleep(200);
  }
  return false;
}

// Open a JSON-RPC connection. `closed` resolves when the socket drops; in-flight calls then reject.
// Accept an MCP elicitation (e.g. a computer-use app approval), picking an allow-style option for each requested field.
function acceptance(params) {
  const content = {};
  for (const [key, field] of Object.entries(params?.requestedSchema?.properties ?? {}))
    content[key] = field.enum?.find((v) => /always|allow|approve|yes|accept/i.test(v)) ?? field.default ?? field.enum?.[0] ?? (field.type === 'boolean' ? true : '');
  return { action: 'accept', content };
}

export async function connect(port, { rpcTimeoutMs = 30000, acceptElicitations = false } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  let id = 0, onEvent = () => {};
  const pend = new Map();
  let closeFn;
  const closed = new Promise((r) => (closeFn = r));
  const fail = (err) => { for (const [, p] of pend) p.rej(err); pend.clear(); closeFn(err); };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.id != null && m.method === 'mcpServer/elicitation/request' && acceptElicitations) {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: acceptance(m.params) }));
      onEvent({ ...m, serverRequest: true, accepted: true });
    } else if (m.id != null && m.method) { // server-to-client request (e.g. approval): we cannot answer it, so refuse rather than hang
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unsupported by gpt-session' } }));
      onEvent({ ...m, serverRequest: true });
    } else if (m.id != null && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.rej(new Error(`${p.method}: ${JSON.stringify(m.error)}`)) : p.res(m.result);
    } else onEvent(m);
  };
  ws.onclose = () => fail(new Error('connection closed'));
  ws.onerror = () => fail(new Error('connection error'));
  await Promise.race([
    new Promise((r) => (ws.onopen = r)),
    closed.then((e) => { throw e; }),
    sleep(rpcTimeoutMs).then(() => { throw new Error('connect timeout'); }),
  ]);
  const call = (method, params) => new Promise((res, rej) => {
    const i = ++id;
    const timer = setTimeout(() => { pend.delete(i); rej(new Error(`${method}: timed out after ${rpcTimeoutMs}ms`)); }, rpcTimeoutMs);
    pend.set(i, { method, res: (v) => (clearTimeout(timer), res(v)), rej: (e) => (clearTimeout(timer), rej(e)) });
    try { ws.send(JSON.stringify({ jsonrpc: '2.0', id: i, method, params })); } catch (e) { pend.delete(i); clearTimeout(timer); rej(e); }
  });
  await call('initialize', { clientInfo: { name: 'gpt-session', version: '2' } });
  ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }));
  return { call, closed, setHandler: (h) => (onEvent = h ?? (() => {})), close: () => { try { ws.close(); } catch {} } };
}
