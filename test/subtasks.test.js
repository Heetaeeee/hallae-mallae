import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subtaskSummary, withDescendants } from '../public/js/subtasks.js';

const t = (id, parentId = null, status = 'TODO') => ({ id, parentId, status });

test('세부 작업이 없으면 요약이 없다', () => {
  assert.equal(subtaskSummary('a', [t('a'), t('b')]), null);
  // 부모가 목록에 없는 작업도 혼자인 작업
  assert.equal(subtaskSummary('a', [t('a', 'gone')]), null);
});

test('세부 작업 수와 완료 수를 센다 - 다른 큰 작업은 빼고, 큰 작업 자신의 상태는 보지 않는다', () => {
  const tasks = [t('p', null, 'DONE'), t('a', 'p', 'DONE'), t('b', 'p', 'DOING'), t('c', 'p'), t('q'), t('x', 'q', 'DONE')];
  assert.deepEqual(subtaskSummary('p', tasks), { total: 3, done: 1 });
  assert.deepEqual(subtaskSummary('q', tasks), { total: 1, done: 1 });
});

test('다시 나눈 세부 작업은 빼고 맨 아래 작업만 센다 (전체 진행률과 같은 기준)', () => {
  const tasks = [t('p'), t('mid', 'p', 'DONE'), t('a', 'mid'), t('b', 'mid', 'DONE'), t('c', 'p')];
  assert.deepEqual(subtaskSummary('p', tasks), { total: 3, done: 1 });
  assert.deepEqual(subtaskSummary('mid', tasks), { total: 2, done: 1 });
});

test('withDescendants 는 자기 자신과 아래 작업 전부', () => {
  const tasks = [t('a', 'mid'), t('mid', 'p'), t('p'), t('q')];
  assert.deepEqual([...withDescendants('p', tasks)].sort(), ['a', 'mid', 'p']);
});
