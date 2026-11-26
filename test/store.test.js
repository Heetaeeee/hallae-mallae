import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from '../src/lib/store.js';
import { normalizeRoomCode } from '../src/lib/room.js';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hallae-store-'));
  const path = join(dir, 'db.json');

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  return {
    dir,
    path,
    store: createStore(path, {
        enabled: () => true
        })
    };
}

const readJson = (path) =>
  JSON.parse(readFileSync(path, 'utf8'));

test('파일이 없으면 기본 방을 만들고 재조회해도 같은 방을 유지한다', (t) => {
  const { path, store } = setup(t);

  assert.deepEqual(store.load(), {
    members: [],
    tasks: []
  });

  const first = readJson(path);

  store.load();

  assert.deepEqual(readJson(path), first);
  assert.equal(first.schemaVersion, 1);
  assert.ok(first.rooms[first.defaultRoom]);
});

test('기존 파일을 백업한 뒤 데이터 이전하며 반복 조회해도 다시 이전하지 않는다', (t) => {
  const { dir, path, store } = setup(t);

  const legacy = {
    members: [
      { id: 'A', name: 'A', availableHours: 10 }
    ],
    tasks: [
      {
        id: 't1',
        title: '자료 조사',
        status: 'DONE',
        assigneeId: 'A',
        hours: 3,
        estimates: { A: { hours: 3, reason: '자료 확인' } },
        estimatesRevealed: true,
        estimateHistory: [{ version: 1, values: { A: 3 } }],
        completedAt: '2026-11-21T00:00:00.000Z'
      }
    ]
  };

  const original = JSON.stringify(legacy, null, 2);
  writeFileSync(path, original, 'utf8');

  assert.deepEqual(store.load(), legacy);

  const backups = () => readdirSync(dir).filter(
    (name) => name.startsWith('db.json.before-rooms-')
  );

  assert.equal(backups().length, 1);
  assert.equal(
    readFileSync(join(dir, backups()[0]), 'utf8'),
    original
  );

  const migrated = readFileSync(path, 'utf8');

  assert.deepEqual(store.load(), legacy);
  assert.equal(readFileSync(path, 'utf8'), migrated);
  assert.equal(backups().length, 1);
});

test('방 A 저장 시 방 B와 A의 메타데이터를 보존한다', (t) => {
  const { store } = setup(t);

  const a = store.createRoom({ name: 'A 방', size: 3 });
  const b = store.createRoom({ name: 'B 방', size: 2 });
  const beforeA = store.loadRoom(a.code);
  const beforeB = store.loadRoom(b.code);

  store.saveRoom(a.code, {
    members: [{ id: 'A', name: 'A', availableHours: 10 }],
    tasks: [{ id: 't1', title: 'A 방 작업' }]
  });

  const afterA = store.loadRoom(a.code);

  assert.equal(afterA.name, beforeA.name);
  assert.equal(afterA.size, beforeA.size);
  assert.equal(afterA.demo, beforeA.demo);
  assert.equal(afterA.createdAt, beforeA.createdAt);
  assert.equal(afterA.tasks[0].id, 't1');
  assert.deepEqual(store.loadRoom(b.code), beforeB);
});

test('기존 load와 save는 기본 방만 변경한다', (t) => {
  const { path, store } = setup(t);

  store.load();

  const root = readJson(path);
  const defaultBefore = store.loadRoom(root.defaultRoom);
  const other = store.createRoom({ name: '다른 방', size: 2 });
  const otherBefore = store.loadRoom(other.code);

  const data = {
    members: [{ id: 'A', name: 'A', availableHours: 5 }],
    tasks: [{ id: 't1', title: '기본 방 작업' }]
  };

  store.save(data);

  assert.deepEqual(store.load(), data);
  assert.deepEqual(store.loadRoom(other.code), otherBefore);
  assert.equal(
    store.loadRoom(root.defaultRoom).name,
    defaultBefore.name
  );
  assert.equal(
    store.loadRoom(root.defaultRoom).size,
    defaultBefore.size
  );
});

test('없는 방은 null이며 없는 방 저장은 기존 파일을 변경하지 않는다', (t) => {
  const { path, store } = setup(t);

  store.load();

  const root = readJson(path);
  const missing = root.defaultRoom === 'AAAAAA'
    ? 'BBBBBB'
    : 'AAAAAA';
  const before = readFileSync(path, 'utf8');

  assert.equal(store.loadRoom(missing), null);
  assert.equal(store.loadRoom('잘못된 코드'), null);

  assert.throws(
    () => store.saveRoom(missing, { members: [], tasks: [] }),
    /방을 찾을 수 없습니다/
  );

  assert.equal(readFileSync(path, 'utf8'), before);
});

test('잘못된 JSON과 구조는 덮어쓰거나 백업하지 않는다', (t) => {
  const { dir, path, store } = setup(t);

  for (const text of [
    '{"members":',
    JSON.stringify({}),
    JSON.stringify({ members: {}, tasks: [] }),
    JSON.stringify({
      schemaVersion: 1,
      defaultRoom: 'ABC234',
      rooms: {}
    })
  ]) {
    writeFileSync(path, text, 'utf8');

    assert.throws(() => store.load());
    assert.equal(readFileSync(path, 'utf8'), text);
    assert.deepEqual(readdirSync(dir), ['db.json']);
  }
});

test('잘못된 저장 요청은 기존 파일을 보존한다', (t) => {
  const { path, store } = setup(t);

  const room = store.createRoom({ name: '테스트 방', size: 3 });
  const before = readFileSync(path, 'utf8');

  for (const data of [
    null,
    [],
    {},
    { members: {}, tasks: [] },
    { members: [], tasks: null }
  ]) {
    assert.throws(() => store.save(data), /저장 데이터 형식/);
    assert.throws(
      () => store.saveRoom(room.code, data),
      /저장 데이터 형식/
    );
  }

  assert.equal(readFileSync(path, 'utf8'), before);
});

test('꺼진 상태의 조회는 파일을 만들지 않고 고정 기본 방 코드를 반환한다', (t) => {
  const { path } = setup(t);
  const store = createStore(path, {
    enabled: () => false
  });

  assert.deepEqual(store.load(), {
    members: [],
    tasks: []
  });

  const code = store.getDefaultRoomCode();

  assert.equal(code, 'LEGACY');
  assert.deepEqual(store.loadRoom(code).members, []);
  assert.equal(store.loadRoom('ABC234'), null);
  assert.equal(existsSync(path), false);
});

test('꺼진 상태에서는 원본을 이전하지 않고 방별 저장도 기존 형식을 유지한다', (t) => {
  const { dir, path } = setup(t);
  const original = JSON.stringify({
    members: [{ id: 'A', name: 'A', availableHours: 0 }],
    tasks: []
  }, null, 2);

  writeFileSync(path, original, 'utf8');

  const store = createStore(path, {
    enabled: () => false
  });

  const code = store.getDefaultRoomCode();

  store.load();
  const room = store.loadRoom(code);

  assert.equal(readFileSync(path, 'utf8'), original);
  assert.deepEqual(readdirSync(dir), ['db.json']);

  room.members.push({
    id: 'B',
    name: 'B',
    availableHours: 0
  });
  store.saveRoom(code, room);

  const saved = readJson(path);

  assert.deepEqual(
    Object.keys(saved).sort(),
    ['members', 'tasks']
  );
  assert.equal(saved.members.length, 2);
  assert.equal(store.loadRoom(code).size, 2);
  assert.deepEqual(readdirSync(dir), ['db.json']);
});

test('활성화하면 무작위 기본 방으로 이전하고 재조회·재시작에도 같은 코드를 유지한다', (t) => {
  const { dir, path } = setup(t);
  let enabled = false;

  const legacy = {
    members: [
      { id: 'A', name: 'A', availableHours: 5 }
    ],
    tasks: [
      {
        id: 't1',
        title: '기존 작업',
        status: 'DONE',
        assigneeId: 'A',
        hours: 3,
        estimates: {
          A: { hours: 3, reason: '자료 확인' }
        },
        estimatesRevealed: true,
        estimateHistory: [
          { version: 1, values: { A: 3 } }
        ],
        completedAt: '2026-11-21T00:00:00.000Z'
      }
    ]
  };

  const original = JSON.stringify(legacy, null, 2);
  writeFileSync(path, original, 'utf8');

  const store = createStore(path, {
    enabled: () => enabled
  });

  // 비활성 상태에서는 고정 코드와 기존 파일을 유지한다.
  assert.equal(store.getDefaultRoomCode(), 'LEGACY');
  assert.deepEqual(store.load(), legacy);
  assert.equal(readFileSync(path, 'utf8'), original);
  assert.deepEqual(readdirSync(dir), ['db.json']);

  enabled = true;

  // 활성화한 뒤 처음 읽는 시점에 이전한다.
  assert.deepEqual(store.load(), legacy);

  const root = readJson(path);
  const code = root.defaultRoom;

  assert.equal(root.schemaVersion, 1);
  assert.notEqual(code, 'LEGACY');
  assert.equal(normalizeRoomCode(code), code);
  assert.deepEqual(Object.keys(root.rooms), [code]);
  assert.deepEqual(root.rooms[code].members, legacy.members);
  assert.deepEqual(root.rooms[code].tasks, legacy.tasks);
  assert.equal(store.loadRoom('LEGACY'), null);
  assert.equal(store.getDefaultRoomCode(), code);

  const backups = () => readdirSync(dir).filter(
    (name) => name.startsWith('db.json.before-rooms-')
  );

  assert.equal(backups().length, 1);
  assert.equal(
    readFileSync(join(dir, backups()[0]), 'utf8'),
    original
  );

  const migrated = readFileSync(path, 'utf8');

  // 반복 조회해도 코드·파일·백업 수가 바뀌지 않는다.
  assert.deepEqual(store.load(), legacy);
  assert.equal(store.getDefaultRoomCode(), code);
  assert.equal(readFileSync(path, 'utf8'), migrated);
  assert.equal(backups().length, 1);

  // 저장소 객체를 새로 만들어도 저장된 코드를 사용한다.
  const reopened = createStore(path, {
    enabled: () => true
  });

  assert.equal(reopened.getDefaultRoomCode(), code);
  assert.deepEqual(reopened.load(), legacy);
  assert.equal(readFileSync(path, 'utf8'), migrated);
  assert.equal(backups().length, 1);

  // 다시 비활성화해도 이미 이전된 코드를 유지한다.
  enabled = false;

  assert.equal(store.getDefaultRoomCode(), code);
  assert.deepEqual(store.load(), legacy);
  assert.equal(readFileSync(path, 'utf8'), migrated);
});

test('이미 이전된 파일은 꺼진 상태에서도 보존하고 기본 방 정원은 인원 이상으로 유지한다', (t) => {
  const { path, store: enabledStore } = setup(t);

  enabledStore.load();

  const other = enabledStore.createRoom({
    name: '다른 방',
    size: 3
  });

  const otherBefore = enabledStore.loadRoom(other.code);
  const code = enabledStore.getDefaultRoomCode();

  const disabledStore = createStore(path, {
    enabled: () => false
  });

  disabledStore.save({
    members: [
      { id: 'A', name: 'A', availableHours: 0 },
      { id: 'B', name: 'B', availableHours: 0 }
    ],
    tasks: []
  });

  assert.equal(readJson(path).schemaVersion, 1);
  assert.equal(disabledStore.getDefaultRoomCode(), code);
  assert.equal(disabledStore.loadRoom(code).size, 2);
  assert.deepEqual(
    disabledStore.loadRoom(other.code),
    otherBefore
  );

  assert.throws(
    () => disabledStore.createRoom({
      name: '새 방',
      size: 2
    }),
    /방 기능이 꺼져 있습니다/
  );
});

test('이미 LEGACY로 이전된 방별 파일은 코드와 데이터를 변경하지 않는다', (t) => {
  const { dir, path } = setup(t);

  const root = {
    schemaVersion: 1,
    defaultRoom: 'LEGACY',
    rooms: {
      LEGACY: {
        name: '기존 프로젝트',
        size: 1,
        demo: false,
        members: [
          { id: 'A', name: 'A', availableHours: 5 }
        ],
        tasks: [
          { id: 't1', title: '보존할 작업' }
        ],
        createdAt: '2026-11-21T00:00:00.000Z'
      }
    }
  };

  const original = JSON.stringify(root, null, 2);
  writeFileSync(path, original, 'utf8');

  const store = createStore(path, {
    enabled: () => true
  });

  assert.equal(store.getDefaultRoomCode(), 'LEGACY');
  assert.deepEqual(store.load(), {
    members: root.rooms.LEGACY.members,
    tasks: root.rooms.LEGACY.tasks
  });
  assert.equal(readFileSync(path, 'utf8'), original);
  assert.deepEqual(readdirSync(dir), ['db.json']);
});
