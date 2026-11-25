import { Router } from 'express';
import { loadRoom } from '../lib/store.js';
import { progressPercent, doneShare, doneCounts } from '../lib/progress.js';

const router = Router();

router.get('/', (req, res) => {
  const { members, tasks } = loadRoom(req.roomCode);
  const shares = members.map((m) => ({ m, s: doneShare(m.id, tasks), c: doneCounts(m.id, tasks) }));
  // 담당자가 없는 완료 작업(삭제된 팀원이 끝낸 작업 등)도 전체 시간에 들어가므로 따로 보여 준다
  const unassigned = doneShare(null, tasks);
  const unassignedCounts = doneCounts(null, tasks);
  res.json({
    progress: progressPercent(tasks),
    doneHoursTotal: unassigned.totalHours,
    // doneCount · doneUnsized: 크기 미정으로 끝낸 작업은 비중에 안 들어가므로 건수를 함께 준다
    members: shares.map(({ m, s, c }) => ({ memberId: m.id, name: m.name, doneShare: s.percent, doneHours: s.hours, doneCount: c.count, doneUnsized: c.unsized })),
    unassigned: { doneShare: unassigned.percent, doneHours: unassigned.hours, doneCount: unassignedCounts.count, doneUnsized: unassignedCounts.unsized },
  });
});

export default router;
