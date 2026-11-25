// 체험 방 처음 상태 — seed/demo.json 의 상대 날짜를 만든 날 기준 실제 날짜로 바꾼다.
// 체험 방 API(A)는 누를 때마다 이 결과로 새 방을 만든다. 원본 seed 는 바꾸지 않는다
const DAY = 24 * 60 * 60 * 1000;

// 마감일은 한국 날짜 'YYYY-MM-DD' (서버 TZ=Asia/Seoul, weekly.js 와 같은 기준)
const dateIn = (now, days) => new Date(now.getTime() + days * DAY).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const isoAgo = (now, days) => new Date(now.getTime() - days * DAY).toISOString();

export function demoRoom(seed, now = new Date()) {
  return {
    name: seed.name,
    size: seed.size,
    demo: true,
    createdAt: now.toISOString(),
    members: seed.members.map((m) => ({ ...m })),
    tasks: seed.tasks.map(({ _역할, dueInDays, createdDaysAgo, completedDaysAgo, history, ...task }) => ({
      ...structuredClone(task),
      dueDate: dueInDays === null ? null : dateIn(now, dueInDays),
      createdAt: isoAgo(now, createdDaysAgo),
      completedAt: completedDaysAgo === null ? null : isoAgo(now, completedDaysAgo),
      estimateHistory: history.map(({ atDaysAgo, ...v }) => ({ ...structuredClone(v), at: isoAgo(now, atDaysAgo) })),
    })),
  };
}
