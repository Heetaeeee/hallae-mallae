import {
  getDefaultRoomCode,
  loadRoom
} from '../lib/store.js';

import { normalizeRoomCode } from '../lib/room.js';

export function createRoomContext({
  store = { getDefaultRoomCode, loadRoom },
  enabled = () => process.env.ROOMS_ENABLED === '1'
} = {}) {
  return (req, res, next) => {
    if (!enabled()) {
      req.roomCode = store.getDefaultRoomCode();
      return next();
    }

    const header = req.get('X-Room-Code');
    const code = normalizeRoomCode(header);

    if (code === null) {
      return res.status(400).json({
        code: header === undefined
          ? 'ROOM_REQUIRED'
          : 'ROOM_CODE_INVALID',
        error: '올바른 방 코드를 함께 보내 주세요.'
      });
    }

    if (!store.loadRoom(code)) {
      return res.status(404).json({
        code: 'ROOM_NOT_FOUND',
        error: '방을 찾을 수 없습니다.'
      });
    }

    req.roomCode = code;

    return next();
  };
}