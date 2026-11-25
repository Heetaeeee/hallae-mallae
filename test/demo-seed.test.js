// 체험 방 처음 상태(seed/demo.json)가 세 화면 시연에 필요한 것을 다 갖췄는지, 실제 계산 함수로 확인한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { demoRoom } from '../src/lib/demo.js';
import { estimateSummary } from '../src/lib/estimate.js';
import { currentHours, loadPercent } from '../src/lib/load.js';
import { daysLeft, weeklyRates, withoutParents } from '../src/lib/progress.js';
import { validateMember } from '../src/lib/validate.js';

const seed = JSON.parse(readFileSync(new URL('../seed/demo.json', import.meta.url), 'utf8'));
const now = new Date('2026-11-26T03:00:00.000Z'); // 목요일 낮 (KST)
const today = '2026-11-26';
const room = demoRoom(seed, now);
const ids = room.members.map((m) => m.id);
const task = (id) => room.tasks.find((t) => t.id === id);

test('날짜는 만든 날 기준으로 바뀌고 상대 날짜 필드는 남지 않는다', () => {
  assert.equal(task('t7').dueDate, today);
  assert.equal(task('t6').dueDate, '2026-11-24');
  assert.equal(task('t10').dueDate, null);
  assert.equal(task('s1').completedAt, '2026-11-18T03:00:00.000Z');
  assert.equal(task('s2').estimateHistory[1].at, '2026-11-21T03:00:00.000Z');
  for (const t of room.tasks) {
    for (const k of ['_역할', 'dueInDays', 'createdDaysAgo', 'completedDaysAgo', 'history']) assert.equal(k in t, false, `${t.id}.${k}`);
  }
  assert.equal(room.demo, true);
});

test('원본 seed 는 바뀌지 않고, 두 번 만들면 서로 다른 객체다', () => {
  const again = demoRoom(seed, now);
  again.tasks[0].title = '바꿈';
  again.tasks[1].estimates.d1.hours = 99;
  assert.equal(task('p1').title, '기말 발표 준비');
  assert.equal(task('s1').estimates.d1.hours, 3);
  assert.equal('dueInDays' in seed.tasks[0], true);
});

test('팀원은 입력 검사를 통과하고, 작업이 가리키는 팀원 · 상위 작업은 모두 있다', () => {
  for (const m of room.members) assert.equal(validateMember({ name: m.name, availableHours: m.availableHours }).ok, true, m.name);
  assert.equal(room.members.length, room.size);
  const taskIds = new Set(room.tasks.map((t) => t.id));
  for (const t of room.tasks) {
    if (t.assigneeId !== null) assert.ok(ids.includes(t.assigneeId), t.id);
    if (t.parentId !== null) assert.ok(taskIds.has(t.parentId), t.id);
    for (const id of Object.keys(t.estimates)) assert.ok(ids.includes(id), t.id);
    assert.equal(t.status === 'DONE', t.completedAt !== null, t.id);
  }
});

test('공개 표시와 크기는 실제 공개 조건과 맞고, 공개된 작업의 마지막 버전은 지금 추정값이다', () => {
  for (const t of room.tasks) {
    const s = estimateSummary(t.estimates, ids, t.estimatesRevealed, room.size);
    assert.equal(s.revealed, t.estimatesRevealed, t.id);
    if (t.hours !== null) assert.equal(t.estimatesRevealed, true, `${t.id}: 공개 전에는 크기를 정하지 못한다`);
    const last = t.estimateHistory.at(-1);
    if (last) assert.deepEqual(last.values, s.values, t.id);
  }
});

test('A 시연: 두 명만 낸 블라인드 추정 · 의견 차이가 큰 작업의 조율 기록 · 아무도 안 낸 작업이 있다', () => {
  const blind = estimateSummary(task('s4').estimates, ids, false, room.size);
  assert.equal(blind.revealed, false);
  assert.equal(blind.submittedIds.length, 2);
  assert.equal(task('s2').estimateHistory.length, 2);
  const first = Object.fromEntries(Object.entries(task('s2').estimateHistory[0].values).map(([id, hours]) => [id, { hours }]));
  assert.equal(estimateSummary(first, ids).wideSpread, true); // ver 1 은 의견 차이 표시가 뜨는 값
  assert.deepEqual(task('t10').estimates, {});
  assert.ok(room.tasks.some((t) => t.parentId === 'p1'));
});

test('B 시연: 크기 확정 · 담당 미정 작업이 있고, 과부하인 팀원과 여유 있는 팀원이 있다', () => {
  const open = room.tasks.filter((t) => t.hours !== null && t.assigneeId === null && t.status !== 'DONE');
  assert.ok(open.length >= 2);
  const loads = room.members.map((m) => loadPercent(currentHours(m.id, room.tasks), m.availableHours));
  assert.ok(loads.some((l) => l > 100), `과부하 없음 ${loads}`);
  assert.ok(loads.some((l) => l < 50), `여유 없음 ${loads}`);
});

test('C 시연: 세 칸이 다 차 있고, 마감 지난 작업 · 이번 주 · 지난주 수행률이 나온다', () => {
  const counted = withoutParents(room.tasks);
  for (const s of ['TODO', 'DOING', 'DONE']) assert.ok(counted.some((t) => t.status === s), s);
  assert.ok(counted.some((t) => t.status !== 'DONE' && daysLeft(t.dueDate, today) < 0));
  const weeks = weeklyRates(room.tasks, today);
  assert.ok(weeks.length >= 2, JSON.stringify(weeks));
});

test('어느 요일에 만들어도 지난주 · 이번 주 수행률이 둘 다 나온다', () => {
  for (let d = 0; d < 7; d++) {
    const at = new Date(now.getTime() + d * 86400000);
    const r = demoRoom(seed, at);
    const day = at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    assert.ok(weeklyRates(r.tasks, day).length >= 2, day);
  }
});
