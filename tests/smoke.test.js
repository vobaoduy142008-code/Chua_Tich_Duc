// Smoke + anti-cheat tests. Starts its own server on a temp DB (your data is untouched).
// Run: npm test
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');

const PORT = 3111;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(require('os').tmpdir(), 'tich-duc-test-' + process.pid + '.db');
for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`);
  if (!cond) failures++;
};

async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

function connect(token) {
  return new Promise((resolve) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve({ s, err: null }));
    s.on('connect_error', (e) => resolve({ s, err: e.message }));
  });
}
const ack = (s, ev, data) => s.timeout(4000).emitWithAck(ev, data);

(async () => {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT, DB_PATH: DB }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 40 && !log.includes('đang chạy'); i++) await sleep(150);

  const look = { gender: 'male', skin_color: '#F3CDA8', hair_color: '#2A1A14', hair_style: 'short', robe_color: '#8E8C8F' };
  // ---- REST ----
  let r = await api('POST', '/api/players', { ...look, display_name: 'đụ má' });
  check('bad name rejected by server', r.status === 400, r.data && r.data.message);
  r = await api('POST', '/api/players', { ...look, display_name: 'An', skin_color: '#123456' });
  check('colour outside palette rejected', r.status === 400, r.data && r.data.fields);
  r = await api('POST', '/api/players', { ...look, display_name: 'An', merit_points: 99999 });
  check('create ignores merit_points', r.status === 201 && r.data.profile.merit_points === 0);
  const tokA = r.data.token;
  const idA = r.data.profile.id;
  r = await api('POST', '/api/players', { ...look, display_name: 'Bình' });
  const tokB = r.data.token;

  r = await api('GET', '/api/me');
  check('GET /api/me without token → 401', r.status === 401);
  r = await api('PUT', '/api/me', { display_name: 'Hacker' }, 'WRONGTOKENWRONGTOKENWRONGTOKEN12');
  check('PUT /api/me with wrong token → 401', r.status === 401);
  r = await api('PUT', '/api/me', { robe_color: '#8A5A36', merit_points: 5000 }, tokA);
  check('PUT /api/me changes look, not merit', r.status === 200 && r.data.profile.robe_color === '#8A5A36' && r.data.profile.merit_points === 0);
  r = await api('GET', `/api/profiles/${idA}`);
  check('old public profile endpoint is gone', r.status === 404);
  r = await api('POST', '/api/players/claim-legacy', { user_id: idA });
  check('cannot "claim" an account that has a token', r.status === 404);

  // ---- sockets ----
  let c = await connect('nope');
  check('socket without valid token refused', c.err === 'unauthorized');
  c.s.close();

  const A = (await connect(tokA)).s;
  const B = (await connect(tokB)).s;
  const joinA = await ack(A, 'room:join', {});
  await ack(B, 'room:join', {});
  check('join returns self state', joinA.ok && joinA.self.merit === 0);

  let corrected = null;
  A.on('self:correct', (d) => { corrected = d; });
  A.emit('move', { x: 768, y: 300, dir: 'up', moving: true });
  await sleep(150);
  check('cannot walk onto the altar', corrected && corrected.y > 600, corrected);
  corrected = null;
  A.emit('move', { x: 1400, y: 950, dir: 'right', moving: true });
  await sleep(150);
  check('teleport rejected (speed check)', !!corrected, corrected);

  r = await ack(A, 'action:incense', { eventId: 'evt-far-000001' });
  // spawn is ~230 units from the burner
  check('incense from far away refused', !r.ok && r.code === 'too_far', r.code);

  // walk legitimately to the burner
  let x = joinA.self.x;
  let y = joinA.self.y;
  while (Math.hypot(x - 768, y - 700) > 5) {
    const dx = 768 - x; const dy = 700 - y; const d = Math.hypot(dx, dy); const step = Math.min(d, 14);
    x += (dx / d) * step; y += (dy / d) * step;
    A.emit('move', { x, y, dir: 'up', moving: true });
    await sleep(70);
  }
  await sleep(100);
  r = await ack(A, 'action:incense', { eventId: 'evt-incense-01' });
  check('incense near burner +2', r.ok && r.delta === 2 && r.total === 2, r);
  const replay = await ack(A, 'action:incense', { eventId: 'evt-incense-01' });
  check('retry with same eventId not double counted', replay.ok && replay.duplicate && replay.total === 2, replay);
  await sleep(3800);
  r = await ack(A, 'action:incense', { eventId: 'evt-incense-02' });
  check('incense cooldown enforced', !r.ok && r.code === 'cooldown', r.code);

  // meditation: counts on the server, stops on disconnect
  A.emit('move', { x, y: y + 80, dir: 'down', moving: true });
  await sleep(120);
  r = await ack(A, 'meditation:start', {});
  check('meditation start', r.ok, r);
  await sleep(3300);
  A.disconnect();
  await sleep(500);
  const A2 = (await connect(tokA)).s;
  const j2 = await ack(A2, 'room:join', {});
  check('meditation ended & credited at disconnect (≈+3)', j2.self.activity === 'idle' && j2.self.merit >= 4 && j2.self.merit <= 6, j2.self.merit);
  await sleep(4000);
  const j3 = await ack(A2, 'room:join', {});
  check('no points accrue after disconnect', j3.self.merit === j2.self.merit, [j2.self.merit, j3.self.merit]);

  // wooden fish: occupancy + rate limit
  const goFish = async (s, fx, fy, sx, sy) => {
    let px = sx; let py = sy;
    while (Math.hypot(px - fx, py - fy) > 5) {
      const dx = fx - px; const dy = fy - py; const d = Math.hypot(dx, dy); const step = Math.min(d, 14);
      px += (dx / d) * step; py += (dy / d) * step;
      s.emit('move', { x: px, y: py, dir: 'right', moving: true });
      await sleep(70);
    }
  };
  const jB = await ack(B, 'room:join', {});
  await goFish(B, 1176, 690, jB.self.x, jB.self.y);
  r = await ack(B, 'action:fish', { eventId: 'evt-fish-b-001' });
  check('B sits at the right wooden fish', r.ok && r.fishId === 'fish_right', r);
  await goFish(A2, 1176, 690, j3.self.x, j3.self.y);
  r = await ack(A2, 'action:fish', { eventId: 'evt-fish-a-001' });
  check('A cannot take an occupied fish', !r.ok && r.code === 'occupied', r.code);
  let ok = 0; let fast = 0;
  for (let i = 0; i < 10; i++) {
    const k = await ack(B, 'action:fish', { eventId: `evt-fish-spam-${i}` });
    if (k.ok) ok++; else if (k.code === 'too_fast') fast++;
    await sleep(100);
  }
  check('fish spam is rate limited', ok <= 2 && fast >= 8, { ok, fast });

  A2.close(); B.close();
  srv.kill();
  await sleep(300);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch (_) {} }
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  if (failures) console.log(log.slice(-2000));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
