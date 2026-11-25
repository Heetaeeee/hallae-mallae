// C — 팀원 · 작업 API 가 방 두 개를 섞지 않는지 실제 저장소 · 공용 방 코드 검사와 함께 확인 (#58 리뷰 지호 제안)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

import { createStore } from '../src/lib/store.js';
import { createRoomContext } from '../src/middleware/room-context.js';
import { createMembersRouter } from '../src/routes/members.js';
import { createTasksRouter } from '../src/routes/tasks.js';

async function withRooms(run) {
  const dir = mkdtempSync(join(tmpdir(), 'hallae-room-board-'));
  const store = createStore(join(dir, 'db.json'), { enabled: () => true });
  const first = store.createRoom({ name: '첫 방', size: 2 });
  const second = store.createRoom({ name: '둘째 방', size: 2 });
  // 두 방에 같은 ID · 같은 이름의 팀원을 둔다 — 방 코드만으로 갈려야 한다
  for (const { code } of [first, second]) {
    store.saveRoom(code, { ...store.loadRoom(code), members: [{ id: 'm1', name: '김권섭', availableHours: 10 }, { id: 'm2', name: '박지호', availableHours: 10 }] });
  }

  const app = express();
  app.use(express.json());
  app.use('/api', createRoomContext({ store, enabled: () => true }));
  const load = (code) => store.loadRoom(code);
  const save = (code, room) => store.saveRoom(code, room);
  app.use('/api/members', createMembersRouter(load, save, { enabled: () => true }));
  app.use('/api/tasks', createTasksRouter(load, save));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, code, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Room-Code': code },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await run({ call, store, a: first.code, b: second.code });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}

test('한 방에 만든 작업은 다른 방 목록에 없고, 다른 방 코드로는 고치거나 지울 수 없다', async () => {
  await withRooms(async ({ call, a, b }) => {
    const made = await call('POST', '/tasks', a, { title: '첫 방 작업' });
    assert.equal(made.status, 201);
    assert.deepEqual((await call('GET', '/tasks', b)).body, []);
    assert.equal((await call('PATCH', `/tasks/${made.body.id}`, b, { status: 'DONE' })).status, 404);
    assert.equal((await call('DELETE', `/tasks/${made.body.id}`, b)).status, 404);
    const [kept] = (await call('GET', '/tasks', a)).body;
    assert.equal(kept.status, 'TODO');
  });
});

test('같은 ID 의 팀원을 한 방에서 지워도 다른 방 팀원 · 정원은 그대로다', async () => {
  await withRooms(async ({ call, store, a, b }) => {
    assert.equal((await call('DELETE', '/members/m1', a)).status, 200);
    assert.deepEqual((await call('GET', '/members', a)).body.map((m) => m.id), ['m2']);
    assert.deepEqual((await call('GET', '/members', b)).body.map((m) => m.id), ['m1', 'm2']);
    assert.equal(store.loadRoom(a).size, 1);
    assert.equal(store.loadRoom(b).size, 2);
  });
});

test('이름 · 가능한 시간을 고쳐도 그 방에만 반영된다', async () => {
  await withRooms(async ({ call, a, b }) => {
    assert.equal((await call('PATCH', '/members/m2', a, { availableHours: 3 })).status, 200);
    assert.equal((await call('GET', '/members', a)).body.find((m) => m.id === 'm2').availableHours, 3);
    assert.equal((await call('GET', '/members', b)).body.find((m) => m.id === 'm2').availableHours, 10);
  });
});
