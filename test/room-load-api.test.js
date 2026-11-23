import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

import { createStore } from '../src/lib/store.js';
import { createRoomContext } from '../src/middleware/room-context.js';
import { createLoadsRouter } from '../src/routes/loads.js';
import { createRecommendRouter } from '../src/routes/recommend.js';

async function withApi(run, { enabled = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hallae-room-load-'));
  const store = createStore(join(dir, 'db.json'), {
    enabled: () => enabled
  });

  let server;

  try {
    function seedRoom(code, hours) {
      const room = store.loadRoom(code);

      room.members = [
        { id: 'm1', name: '첫째', availableHours: 10 },
        { id: 'm2', name: '둘째', availableHours: 10 }
      ];

      room.tasks = [
        {
          id: 't1',
          title: '첫째 작업',
          parentId: null,
          assigneeId: 'm1',
          hours,
          status: 'TODO'
        }
      ];

      store.saveRoom(code, room);
    }

    let first;
    let second;

    if (enabled) {
      first = store.createRoom({ name: '첫 방', size: 2 });
      second = store.createRoom({ name: '둘째 방', size: 2 });

      // 같은 팀원 ID와 작업 ID를 쓰되 작업량은 다르게 설정한다.
      seedRoom(first.code, 8);
      seedRoom(second.code, 2);

      const room = store.loadRoom(second.code);

      room.tasks.push({
        id: 'only-second',
        title: '둘째 방에만 있는 작업',
        parentId: null,
        assigneeId: 'm2',
        hours: 7,
        status: 'TODO'
      });

      store.saveRoom(second.code, room);
    } else {
      seedRoom(store.getDefaultRoomCode(), 8);
    }

    const app = express();

    app.use(express.json());
    app.use('/api', createRoomContext({
      store,
      enabled: () => enabled
    }));

    const loadDb = (code) => store.loadRoom(code);

    app.use('/api/loads', createLoadsRouter(loadDb));
    app.use('/api/recommend', createRecommendRouter(loadDb));

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const base = `http://127.0.0.1:${server.address().port}`;

    async function request(path, { code, body } = {}) {
      const headers = {};

      if (code !== undefined) {
        headers['X-Room-Code'] = code;
      }

      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });

      return {
        status: response.status,
        body: await response.json()
      };
    }

    await run({ request, store, first, second });
  } finally {
    try {
      if (server?.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });

          server.closeIdleConnections();
        });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

test('같은 팀원 ID라도 방별 부담률은 해당 방의 작업만 계산한다', async () => {
  await withApi(async ({ request, first, second }) => {
    const a = await request('/api/loads', { code: first.code });
    const b = await request('/api/loads', { code: second.code });

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);

    assert.deepEqual(
      a.body.members.map((member) => member.load),
      [80, 0]
    );

    assert.deepEqual(
      b.body.members.map((member) => member.load),
      [20, 70]
    );

    assert.equal(a.body.members[0].currentHours, 8);
    assert.equal(b.body.members[0].currentHours, 2);
  });
});

test('같은 시간의 새 작업도 각 방의 작업량에 따라 추천 결과가 다르다', async () => {
  await withApi(async ({ request, first, second }) => {
    const a = await request('/api/recommend', {
      code: first.code,
      body: { hours: 2 }
    });

    const b = await request('/api/recommend', {
      code: second.code,
      body: { hours: 2 }
    });

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.recommendedId, 'm2');
    assert.equal(b.body.recommendedId, 'm1');
    assert.equal(a.body.candidates[0].projectedLoad, 20);
    assert.equal(b.body.candidates[0].projectedLoad, 40);
  });
});

test('다른 방에만 있는 작업 ID로 추천하면 404이다', async () => {
  await withApi(async ({ request, first, second }) => {
    const denied = await request('/api/recommend', {
      code: first.code,
      body: { taskId: 'only-second' }
    });

    assert.equal(denied.status, 404);
    assert.equal(denied.body.error, '작업을 찾을 수 없습니다.');

    const allowed = await request('/api/recommend', {
      code: second.code,
      body: { taskId: 'only-second' }
    });

    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.recommendedId, 'm2');
  });
});

test('부담률 조회와 추천은 어느 방의 저장 데이터도 변경하지 않는다', async () => {
  await withApi(async ({ request, store, first, second }) => {
    const beforeA = structuredClone(store.loadRoom(first.code));
    const beforeB = structuredClone(store.loadRoom(second.code));

    for (const code of [first.code, second.code]) {
      const loads = await request('/api/loads', { code });
      const recommendation = await request('/api/recommend', {
        code,
        body: { taskId: 't1' }
      });

      assert.equal(loads.status, 200);
      assert.equal(recommendation.status, 200);
    }

    assert.deepEqual(store.loadRoom(first.code), beforeA);
    assert.deepEqual(store.loadRoom(second.code), beforeB);
  });
});

test('방 기능이 켜져 있으면 두 API 모두 방 코드 누락과 잘못된 형식을 거부한다', async () => {
  await withApi(async ({ request }) => {
    for (const code of [undefined, 'INVALID!']) {
      const loads = await request('/api/loads', { code });
      const recommendation = await request('/api/recommend', {
        code,
        body: { hours: 2 }
      });

      assert.equal(loads.status, 400);
      assert.equal(recommendation.status, 400);
    }
  });
});

test('방 기능이 꺼져 있으면 헤더와 관계없이 기본 방에서 조회하고 추천한다', async () => {
  await withApi(async ({ request }) => {
    for (const code of [undefined, 'ABC234', 'INVALID!']) {
      const loads = await request('/api/loads', { code });
      const recommendation = await request('/api/recommend', {
        code,
        body: { hours: 2 }
      });

      assert.equal(loads.status, 200);
      assert.deepEqual(
        loads.body.members.map((member) => member.load),
        [80, 0]
      );

      assert.equal(recommendation.status, 200);
      assert.equal(recommendation.body.recommendedId, 'm2');
    }
  }, { enabled: false });
});