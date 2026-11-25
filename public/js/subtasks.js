// 큰 작업과 세부 작업의 관계 계산 — 화면 없이 순수 함수만 (테스트: test/subtasks.test.js)

// 자기 자신과 그 아래 세부 작업 전부의 id — 서버 progress.js 의 withDescendants 와 같은 범위
export function withDescendants(id, tasks) {
  const ids = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of tasks) if (ids.has(t.parentId) && !ids.has(t.id)) { ids.add(t.id); grew = true; }
  }
  return ids;
}

// 큰 작업 카드의 진행 요약. 세부 작업이 없으면 null
// 다시 나눈 세부 작업은 빼고 맨 아래 작업만 센다 — 전체 진행률과 같은 기준 (team/README "상위 작업은 세지 않습니다")
export function subtaskSummary(id, tasks) {
  const ids = withDescendants(id, tasks);
  const parentIds = new Set(tasks.map((t) => t.parentId));
  const list = tasks.filter((t) => t.id !== id && ids.has(t.id) && !parentIds.has(t.id));
  return list.length === 0 ? null : { total: list.length, done: list.filter((t) => t.status === 'DONE').length };
}
