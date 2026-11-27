// A 김권섭 — 체험 방: POST /api/rooms/demo
// 누를 때마다 seed/demo.json 으로 새 방을 만든다. 날짜는 만든 날 기준(demoRoom, #67), 하루 지난 체험 방은 이때 지운다
import { Router } from 'express';
import { readFileSync } from 'node:fs';

import { createDemoRoom } from '../lib/store.js';
import { demoRoom } from '../lib/demo.js';

const seedFile = new URL('../../seed/demo.json', import.meta.url);

// 테스트에서 임시 저장소 · 스위치 · 시각을 주입할 수 있다
export function createDemoRouter({
  store = { createDemoRoom },
  enabled = () => process.env.ROOMS_ENABLED === '1',
  now = () => new Date()
} = {}) {
  const seed = JSON.parse(readFileSync(seedFile, 'utf8'));
  const router = Router();

  router.post('/', (req, res) => {
    // 다른 방 API 와 같이, 입장 코드가 꺼져 있으면 없는 경로로 답한다
    if (!enabled()) {
      return res.status(404).json({ error: '요청한 경로를 찾을 수 없습니다.' });
    }

    const at = now();
    const room = store.createDemoRoom(demoRoom(seed, at), at);

    // 입장 화면이 방 코드를 보여 주고 예시 팀원 중 한 명을 고르게 한다
    return res.status(201).json({
      code: room.code,
      name: room.name,
      size: room.size,
      members: room.members
    });
  });

  return router;
}

export default createDemoRouter();
