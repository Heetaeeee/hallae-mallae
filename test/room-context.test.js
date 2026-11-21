import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

import { createStore } from '../src/lib/store.js';
import { createRoomsRouter } from '../src/routes/rooms.js';
import { createRoomContext } from '../src/middleware/room-context.js';

async function withApi(run, { enabled = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hallae-room-context-'));
  const path = join(dir, 'db.json');

  const store = createStore(path, {
    enabled: () => enabled
  });

  let server;

  try {
    // 꺼진 상태에서는 방을 만들지 않는다.
    const first = enabled
      ? store.createRoom({ name: '첫 방', size: 2 })
      : null;

    const second = enabled
      ? store.createRoom({ name: '둘째 방', size: 3 })
      : null;

    const app = express();

    app.use(express.json());

    app.get('/api/config', (req, res) => {
      res.json({ roomsEnabled: enabled });
    });

    app.use('/api/rooms', createRoomsRouter({
      store,
      enabled: () => enabled
    }));

    app.use('/api', createRoomContext({
      store,
      enabled: () => enabled
    }));

    app.get('/api/context-check', (req, res) => {
      res.json({ roomCode: req.roomCode });
    });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const base = `http://127.0.0.1:${server.address().port}`;

    async function get(url, headers = {}) {
      const response = await fetch(base + url, { headers });

      return {
        status: response.status,
        body: await response.json()
      };
    }

    await run({ get, store, first, second, path });
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

test('꺼진 상태에서는 헤더와 관계없이 기본 방을 연결한다', async () => {
  await withApi(async ({ get, store, path }) => {
    const expected = store.getDefaultRoomCode();

    for (const headers of [
      {},
      { 'X-Room-Code': 'ABC234' },
      { 'X-Room-Code': 'INVALID!' }
    ]) {
      const result = await get('/api/context-check', headers);

      assert.equal(result.status, 200);
      assert.equal(result.body.roomCode, expected);
    }

    // 공용 미들웨어의 조회만으로 파일을 생성하지 않는다.
    assert.equal(existsSync(path), false);
  }, { enabled: false });
});

test('켜진 상태에서 방 코드 헤더가 없으면 400이다', async () => {
  await withApi(async ({ get }) => {
    const result = await get('/api/context-check');

    assert.equal(result.status, 400);
    assert.equal(
      result.body.error,
      '올바른 방 코드를 함께 보내 주세요.'
    );
  });
});

test('방 코드 헤더의 형식이 잘못되면 400이다', async () => {
  await withApi(async ({ get }) => {
    const result = await get('/api/context-check', {
      'X-Room-Code': 'INVALID!'
    });

    assert.equal(result.status, 400);
  });
});

test('존재하지 않는 방 코드면 404이다', async () => {
  await withApi(async ({ get, store }) => {
    const missing = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD']
      .find((code) => store.loadRoom(code) === null);

    assert.ok(missing);

    const result = await get('/api/context-check', {
      'X-Room-Code': missing
    });

    assert.equal(result.status, 404);
    assert.equal(
      result.body.error,
      '방을 찾을 수 없습니다.'
    );
  });
});

test('소문자 헤더를 정리해 요청의 방 코드로 연결한다', async () => {
  await withApi(async ({ get, first }) => {
    const result = await get('/api/context-check', {
      'X-Room-Code': first.code.toLowerCase()
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.roomCode, first.code);
  });
});

test('설정과 방 조회는 입장 전에도 헤더 없이 접근한다', async () => {
  await withApi(async ({ get, first }) => {
    const config = await get('/api/config');
    const room = await get(`/api/rooms/${first.code}`);

    assert.equal(config.status, 200);
    assert.deepEqual(config.body, {
      roomsEnabled: true
    });
    assert.equal(room.status, 200);
    assert.equal(room.body.code, first.code);
  });
});

test('서로 다른 방 코드가 각각 해당 요청에 연결된다', async () => {
  await withApi(async ({ get, first, second }) => {
    const a = await get('/api/context-check', {
      'X-Room-Code': first.code
    });

    const b = await get('/api/context-check', {
      'X-Room-Code': second.code
    });

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.roomCode, first.code);
    assert.equal(b.body.roomCode, second.code);
    assert.notEqual(a.body.roomCode, b.body.roomCode);
  });
});
