import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';

import { createEstimatesRouter } from '../src/routes/estimates.js';

// 방 두 개 — 정원 3 인데 두 명만 들어온 방(R1), 두 명이 다 찬 방(R2)
function rooms() {
  const task = () => ({ id: 't1', title: '자료 조사', parentId: null, hours: null, estimates: {}, estimatesRevealed: false, estimateHistory: [] });
  return {
    R1AAAA: { size: 3, members: [{ id: 'm1', name: '김권섭' }, { id: 'm2', name: '박지호' }], tasks: [task()] },
    R2BBBB: { size: 2, members: [{ id: 'm1', name: '김권섭' }, { id: 'm2', name: '박지호' }], tasks: [task()] },
  };
}

async function withApi(run) {
  const db = rooms();
  const app = express();
  app.use(express.json());
  // 공용 room-context 대신 헤더를 그대로 방 코드로 쓴다
  app.use((req, res, next) => { req.roomCode = req.get('X-Room-Code'); next(); });
  app.use('/api', createEstimatesRouter((code) => structuredClone(db[code]), (code, next) => { db[code] = next; }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (room, path, body) => {
    const res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Room-Code': room },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await run({ call, db });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('추정은 요청한 방에만 저장된다', async () => {
  await withApi(async ({ call, db }) => {
    const r = await call('R2BBBB', '/tasks/t1/estimates', { memberId: 'm1', hours: 3 });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(db.R2BBBB.tasks[0].estimates), ['m1']);
    assert.deepEqual(db.R1AAAA.tasks[0].estimates, {});
  });
});

test('등록된 전원이 내도 정원이 차기 전이면 공개하지 않는다', async () => {
  await withApi(async ({ call, db }) => {
    await call('R1AAAA', '/tasks/t1/estimates', { memberId: 'm1', hours: 3 });
    const r = await call('R1AAAA', '/tasks/t1/estimates', { memberId: 'm2', hours: 5 });
    assert.equal(r.body.estimate.revealed, false);
    assert.equal(db.R1AAAA.tasks[0].estimatesRevealed, false);
    assert.equal((await call('R1AAAA', '/estimates')).body.t1.revealed, false);
  });
});

test('정원이 찬 방은 전원이 내면 공개된다', async () => {
  await withApi(async ({ call }) => {
    await call('R2BBBB', '/tasks/t1/estimates', { memberId: 'm1', hours: 3 });
    const r = await call('R2BBBB', '/tasks/t1/estimates', { memberId: 'm2', hours: 5 });
    assert.equal(r.body.estimate.revealed, true);
    assert.equal((await call('R2BBBB', '/estimates')).body.t1.revealed, true);
  });
});

test('다른 방의 팀원으로는 낼 수 없다', async () => {
  await withApi(async ({ call }) => {
    const r = await call('R2BBBB', '/tasks/t1/estimates', { memberId: 'm9', hours: 3 });
    assert.equal(r.status, 400);
  });
});
