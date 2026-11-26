import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  copyFileSync,
  constants
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  generateRoomCode,
  normalizeRoomCode,
  validateRoomInput,
  migrateLegacyData
} from './room.js';

const dataDir = process.env.DATA_DIR ||
  fileURLToPath(new URL('../../data', import.meta.url));

const dbPath = join(dataDir, 'db.json');

// 스위치가 꺼진 기존 형식의 데이터를 식별하는 고정 기본 방 코드.
const LEGACY_ROOM_CODE = 'LEGACY';

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function validateData(db) {
  if (
    !isObject(db) ||
    !Array.isArray(db.members) ||
    !Array.isArray(db.tasks)
  ) {
    throw new Error(
      '저장 데이터 형식이 올바르지 않습니다. members와 tasks는 배열이어야 합니다.'
    );
  }

  return db;
}

function validateStore(db) {
  if (
    !isObject(db) ||
    db.schemaVersion !== 1 ||
    !isObject(db.rooms) ||
    typeof db.defaultRoom !== 'string' ||
    !Object.hasOwn(db.rooms, db.defaultRoom)
  ) {
    throw new Error('방 저장 데이터 형식이 올바르지 않습니다.');
  }

  for (const [code, room] of Object.entries(db.rooms)) {
    if (normalizeRoomCode(code) !== code) {
      throw new Error('저장된 방 코드가 올바르지 않습니다.');
    }

    validateData(room);

    if (
      !validateRoomInput(room).ok ||
      typeof room.demo !== 'boolean' ||
      typeof room.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(room.createdAt))
    ) {
      throw new Error('저장된 방 정보가 올바르지 않습니다.');
    }
  }

  return db;
}

// 기존 팀원 등록 API를 사용하는 전환 기간의 기본 방만 보정한다.
// 일반 방의 정원을 자동으로 늘리지는 않는다.
function syncDefaultSize(db) {
  const room = db.rooms[db.defaultRoom];

  room.size = Math.max(room.size, room.members.length, 1);

  return db;
}

export function createStore(filePath, {
  enabled = () => process.env.ROOMS_ENABLED === '1'
} = {}) {
  function writeAtomic(db) {
    const text = JSON.stringify(db, null, 2);

    mkdirSync(dirname(filePath), { recursive: true });

    const tempPath = `${filePath}.${randomUUID()}.tmp`;

    try {
      writeFileSync(tempPath, text, {
        encoding: 'utf8',
        flag: 'wx'
      });

      renameSync(tempPath, filePath);
    } finally {
      rmSync(tempPath, { force: true });
    }
  }

  function readState() {
    let text = null;

    try {
      text = readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const parsed = text === null
      ? { members: [], tasks: [] }
      : JSON.parse(text);

    const isRoomStore = isObject(parsed) &&
      ['schemaVersion', 'rooms', 'defaultRoom'].some(
        (key) => Object.hasOwn(parsed, key)
      );

    // 이미 이전된 파일은 스위치를 꺼도 옛 형식으로 되돌리지 않는다.
    if (isRoomStore) {
      return {
        legacy: false,
        data: syncDefaultSize(validateStore(parsed))
      };
    }

    validateData(parsed);

    // 꺼진 상태에서는 조회만으로 파일을 만들거나 이전하지 않는다.
    if (!enabled()) {
      return {
        legacy: true,
        data: parsed
      };
    }

    // LEGACY는 비활성 상태의 기존 형식에만 사용한다.
    // 활성화 시에는 고정 코드를 제외한 무작위 코드로 이전한다.
    const defaultRoomCode = generateRoomCode([LEGACY_ROOM_CODE]);

    const migrated = migrateLegacyData(
      parsed,
      defaultRoomCode
    );

    validateStore(migrated);

    // 기존 파일이 있을 때만 원본 백업을 남긴다.
    if (text !== null) {
      const backupPath =
        `${filePath}.before-rooms-${randomUUID()}.bak`;

      copyFileSync(
        filePath,
        backupPath,
        constants.COPYFILE_EXCL
      );
    }

    writeAtomic(migrated);

    return {
      legacy: false,
      data: migrated
    };
  }

  // 기존 형식에는 방 메타데이터가 없으므로 임시 정보로 감싸서 반환한다.
  function legacyRoom(data) {
    return {
      name: '기존 프로젝트',
      size: Math.max(data.members.length, 1),
      demo: false,
      members: data.members,
      tasks: data.tasks,
      createdAt: null
    };
  }

  function getDefaultRoomCode() {
    const state = readState();

    return state.legacy
      ? LEGACY_ROOM_CODE
      : state.data.defaultRoom;
  }

  function load() {
    const state = readState();

    const room = state.legacy
      ? state.data
      : state.data.rooms[state.data.defaultRoom];

    return {
      members: room.members,
      tasks: room.tasks
    };
  }

  function save(data) {
    validateData(data);

    const state = readState();

    if (state.legacy) {
      writeAtomic(validateData({
        ...state.data,
        ...data
      }));
      return;
    }

    const db = state.data;

    db.rooms[db.defaultRoom] = {
      ...db.rooms[db.defaultRoom],
      members: data.members,
      tasks: data.tasks
    };

    writeAtomic(validateStore(syncDefaultSize(db)));
  }

  function loadRoom(code) {
    const normalized = normalizeRoomCode(code);

    if (normalized === null) return null;

    const state = readState();

    if (state.legacy) {
      return normalized === LEGACY_ROOM_CODE
        ? legacyRoom(state.data)
        : null;
    }

    return Object.hasOwn(state.data.rooms, normalized)
      ? state.data.rooms[normalized]
      : null;
  }

  function saveRoom(code, room) {
    validateData(room);

    const normalized = normalizeRoomCode(code);
    const state = readState();

    if (state.legacy) {
      if (normalized !== LEGACY_ROOM_CODE) {
        throw new Error('저장할 방을 찾을 수 없습니다.');
      }

      // 기존 형식에서는 팀원·작업만 저장한다.
      // 방 이름·정원 등 메타데이터는 활성화 이후 저장할 수 있다.
      writeAtomic(validateData({
        ...state.data,
        members: room.members,
        tasks: room.tasks
      }));
      return;
    }

    const db = state.data;

    if (
      normalized === null ||
      !Object.hasOwn(db.rooms, normalized)
    ) {
      throw new Error('저장할 방을 찾을 수 없습니다.');
    }

    db.rooms[normalized] = {
      ...db.rooms[normalized],
      ...room
    };

    writeAtomic(validateStore(syncDefaultSize(db)));
  }

  function createRoom(input) {
    if (!enabled()) {
      throw new Error('방 기능이 꺼져 있습니다.');
    }

    const result = validateRoomInput(input);

    if (!result.ok) {
      throw new Error(result.error);
    }

    const { data: db } = readState();
    const code = generateRoomCode(Object.keys(db.rooms));

    const room = {
      ...result.value,
      demo: false,
      members: [],
      tasks: [],
      createdAt: new Date().toISOString()
    };

    db.rooms[code] = room;

    writeAtomic(validateStore(syncDefaultSize(db)));

    return {
      code,
      ...room
    };
  }

  return {
    load,
    save,
    loadRoom,
    saveRoom,
    createRoom,
    getDefaultRoomCode
  };
}

const defaultStore = createStore(dbPath);

export const load = defaultStore.load;
export const save = defaultStore.save;
export const loadRoom = defaultStore.loadRoom;
export const saveRoom = defaultStore.saveRoom;
export const createRoom = defaultStore.createRoom;
export const getDefaultRoomCode = defaultStore.getDefaultRoomCode;

export function newId() {
  return randomUUID();
}
