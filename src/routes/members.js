import { Router } from 'express';
import { loadRoom, saveRoom, newId } from '../lib/store.js';
import { validateMember } from '../lib/validate.js';
import { revealAfterMemberRemoved } from '../lib/estimate.js';

// 방 코드(req.roomCode)는 공용 미들웨어가 정한다. 테스트는 메모리 데이터를 넘긴다
export function createMembersRouter(loadDb = loadRoom, saveDb = saveRoom) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(loadDb(req.roomCode).members);
  });

  router.post('/', (req, res) => {
    // 입장 코드가 켜지면 팀원은 입장(POST /api/rooms/:code/join)으로만 생긴다 — 정원 검사도 그쪽에 있다
    if (process.env.ROOMS_ENABLED === '1') return res.status(400).json({ error: '팀원은 입장 화면에서 이름을 넣고 들어옵니다.' });
    const db = loadDb(req.roomCode);
    const v = validateMember(req.body, { takenNames: db.members.map((m) => m.name) });
    if (!v.ok) return res.status(400).json({ error: v.error });
    const member = { id: newId(), ...v.value };
    db.members.push(member);
    saveDb(req.roomCode, db);
    res.status(201).json(member);
  });

  router.patch('/:id', (req, res) => {
    const db = loadDb(req.roomCode);
    const member = db.members.find((m) => m.id === req.params.id);
    if (!member) return res.status(404).json({ error: '팀원을 찾을 수 없습니다.' });
    const takenNames = db.members.filter((m) => m.id !== member.id).map((m) => m.name);
    const v = validateMember(req.body, { partial: true, takenNames });
    if (!v.ok) return res.status(400).json({ error: v.error });
    Object.assign(member, v.value);
    saveDb(req.roomCode, db);
    res.json(member);
  });

  // 팀원 삭제 (STATUS 5장 "정한 것 5") — 맡은 작업은 담당 미정, 낸 추정은 남기되 계산에서 빠짐,
  // 삭제로 "남은 전원이 냄" 이 채워진 작업은 A 의 함수로 그 자리에서 공개 기록을 남긴다
  // 정원도 1 줄여서, 줄어든 정원으로 A 의 공개 조건을 본다
  router.delete('/:id', (req, res) => {
    const db = loadDb(req.roomCode);
    if (!db.members.some((m) => m.id === req.params.id)) return res.status(404).json({ error: '팀원을 찾을 수 없습니다.' });
    db.members = db.members.filter((m) => m.id !== req.params.id);
    db.size = Math.max(db.size - 1, 1);
    const ids = db.members.map((m) => m.id);
    const now = new Date().toISOString();
    const unassigned = [];
    for (const t of db.tasks) {
      if (t.assigneeId === req.params.id) { t.assigneeId = null; unassigned.push(t.id); }
      Object.assign(t, revealAfterMemberRemoved(t, ids, now, db.size));
    }
    saveDb(req.roomCode, db);
    res.json({ deleted: req.params.id, unassigned });
  });

  return router;
}

export default createMembersRouter();
