import { Router } from 'express';

import { loadRoom } from '../lib/store.js';
import { currentHours, loadPercent } from '../lib/load.js';

export function createLoadsRouter(loadDb = loadRoom) {
  const router = Router();

  router.get('/', (req, res) => {
    const db = loadDb(req.roomCode);

    if (!db) {
      return res.status(404).json({
        error: '방을 찾을 수 없습니다.'
      });
    }

    const members = db.members.map((member) => {
      const hours = currentHours(member.id, db.tasks);
      const percent = loadPercent(hours, member.availableHours);

      return {
        memberId: member.id,
        name: member.name,
        currentHours: hours,
        availableHours: member.availableHours,
        load: percent,
        overloaded: percent !== null && percent > 100
      };
    });

    return res.json({ members });
  });

  return router;
}

export default createLoadsRouter();