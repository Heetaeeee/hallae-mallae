import { Router } from 'express';
import { loadRoom } from '../lib/store.js';
import { weeklyRates } from '../lib/progress.js';

const router = Router();

router.get('/', (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE'); // 서버 기준 로컬 날짜 'YYYY-MM-DD'
  res.json({ weeks: weeklyRates(loadRoom(req.roomCode).tasks, today) });
});

export default router;
