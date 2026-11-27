// 체험 방 — 저장소의 createDemoRoom 과 POST /api/rooms/demo
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

import { createStore } from '../src/lib/store.js';
import { createDemoRouter } from '../src/routes/demo.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-26T03:00:00.000Z');
const ago = (ms) => new Date(now.getTime() - ms).toISOString();
const room = (createdAt, demo = true) => ({ name: '체험 방', size: 1, demo, createdAt, members: [], tasks: [] });

function setup(t, enabled = true) {
  const dir = mkdtempSync(join(tmpdir(), 'hallae-demo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'db.json');
  return { path, store: createStore(path, { enabled: () => enabled }) };
}

test('체험 방을 새 방으로 저장하고, 두 번 만들면 서로 다른 방이다', (t) => {
  const { store } = setup(t);
  const a = store.createDemoRoom(room(now.toISOString()), now);
  const b = store.createDemoRoom(room(now.toISOString()), now);
  assert.notEqual(a.code, b.code);
  assert.equal(store.loadRoom(a.code).demo, true);
  assert.equal(store.loadRoom(b.code).name, '체험 방');
});

test('만들 때 하루 지난 체험 방만 지운다 — 일반 방 · 기본 방 · 하루 안 된 체험 방은 남긴다', (t) => {
  const { path, store } = setup(t);
  const old = store.createDemoRoom(room(ago(DAY + 1000)), now);
  const fresh = store.createDemoRoom(room(ago(DAY - 1000)), now);
  const team = store.createRoom({ name: '우리 팀', size: 3 });
  const defaultRoom = store.getDefaultRoomCode();
  // 일반 방은 오래돼도 지우지 않는다
  const db = JSON.parse(readFileSync(path, 'utf8'));
  db.rooms[team.code].createdAt = ago(10 * DAY);
  writeFileSync(path, JSON.stringify(db));

  const made = store.createDemoRoom(room(now.toISOString()), now);
  assert.equal(store.loadRoom(old.code), null);
  for (const code of [fresh.code, team.code, defaultRoom, made.code]) assert.ok(store.loadRoom(code), code);
});

test('방 기능이 꺼져 있으면 체험 방을 만들지 않는다', (t) => {
  const { store } = setup(t, false);
  assert.throws(() => store.createDemoRoom(room(now.toISOString()), now), /꺼져/);
});

async function withApi(t, run, { enabled = true } = {}) {
  const { store } = setup(t, enabled);
  const app = express();
  app.use(express.json());
  app.use('/api/rooms/demo', createDemoRouter({ store, enabled: () => enabled, now: () => now }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/rooms/demo`;
  const post = async () => {
    const res = await fetch(url, { method: 'POST' });
    return { status: res.status, body: await res.json() };
  };
  try {
    await run({ post, store });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('POST /api/rooms/demo — 누를 때마다 처음 상태의 새 방, 날짜는 오늘 기준', async (t) => {
  await withApi(t, async ({ post, store }) => {
    const a = await post();
    const b = await post();
    assert.equal(a.status, 201);
    assert.notEqual(a.body.code, b.body.code);
    // 입장 화면이 쓰는 모양: 방 코드 · 이름 · 정원 · 고를 팀원
    assert.deepEqual(Object.keys(a.body).sort(), ['code', 'members', 'name', 'size']);
    assert.equal(a.body.members.length, a.body.size);

    const saved = store.loadRoom(a.body.code);
    assert.equal(saved.demo, true);
    assert.equal(saved.createdAt, now.toISOString());
    assert.equal(saved.tasks.find((t) => t.id === 't7').dueDate, '2026-11-26'); // seed 의 dueInDays 0

    // 한 방을 바꿔도 다른 방은 처음 상태
    store.saveRoom(a.body.code, { ...saved, tasks: [] });
    assert.ok(store.loadRoom(b.body.code).tasks.length > 0);
  });
});

test('방 기능이 꺼져 있으면 POST /api/rooms/demo 는 404', async (t) => {
  await withApi(t, async ({ post }) => {
    const r = await post();
    assert.equal(r.status, 404);
  }, { enabled: false });
});
