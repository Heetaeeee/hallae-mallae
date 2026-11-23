// A 김권섭 — 입장 화면 (enter.html): 방 코드로 들어가기 · 새 방 만들기 · 체험 방 → 처음 참여 / 기존 팀원
// 방 API 는 B 의 /api/rooms (team/README "방 API"). 서버에서 온 글자는 전부 textContent 로만 넣는다.
import { api, ROOM_KEY } from './api.js';

const root = document.querySelector('#enter');

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}
const field = (label, input) => el('label', { className: 'field' }, label, input);
// 네트워크 오류(서버에 닿지 못함)는 브라우저 영어 문장이라 바꿔 보여 준다. 서버 오류는 서버 문장 그대로
const messageOf = (error) => (error instanceof TypeError ? '서버에 연결하지 못했습니다.' : error.message);

// 폼 하나: 버튼을 잠근 채 요청 → 실패하면 서버 문장을 폼 아래에, 입력값은 그대로
function form(fields, label, onSubmit, { primary = true } = {}) {
  const button = el('button', { className: primary ? 'btn btn--primary' : 'btn', type: 'submit' }, label);
  const error = el('p', { className: 'msg-error', role: 'alert' });
  const node = el('form', { className: 'stack', noValidate: true },
    el('div', { className: 'row' }, ...fields, button), error);
  node.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    error.textContent = '';
    try { await onSubmit(); } catch (err) { error.textContent = messageOf(err); } finally { button.disabled = false; }
  });
  return node;
}

// 방에 들어가면 기억하고 홈으로
function enterAs(room, member) {
  try {
    localStorage.setItem(ROOM_KEY, JSON.stringify({ code: room.code, roomName: room.name, memberId: member.id, memberName: member.name }));
  } catch {
    // 저장이 막힌 브라우저 — 다른 화면이 방을 알 수 없으므로 들어가지 않는다
    throw new Error('이 브라우저는 방 정보를 저장할 수 없습니다. 개인정보 보호 모드를 끄고 다시 시도해 주세요.');
  }
  location.href = 'home.html';
}

// ---------- ① 시작: 코드로 들어가기 · 새 방 만들기 · 체험 방 ----------

function startView() {
  const code = el('input', { maxLength: 6, autocomplete: 'off', placeholder: '예: K7M2QX', inputMode: 'text' });
  const joinForm = form([field('방 코드', code)], '들어가기', async () => {
    showRoom(await api(`/api/rooms/${encodeURIComponent(code.value.trim().toUpperCase())}`));
  });

  const name = el('input', { maxLength: 50, placeholder: '예: 3조 할래말래' });
  const size = el('input', { type: 'number', min: '1', step: '1', inputMode: 'numeric', placeholder: '예: 3' });
  const createForm = form([field('팀 이름', name), el('label', { className: 'field field--s' }, '팀원 수(정원)', size)], '방 만들기', async () => {
    const room = await api('/api/rooms', { method: 'POST', body: { name: name.value, size: size.valueAsNumber } });
    showRoom({ ...room, memberCount: 0 }, { created: true });
  }, { primary: false });

  const demoError = el('p', { className: 'msg-error', role: 'alert' });
  // shortcut: 체험 방 API(POST /api/rooms/demo, A 2주차)가 아직 없어 잠가 둔다. 그 API 를 만들면 DEMO_READY 를 true 로
  const DEMO_READY = false;
  const demoButton = el('button', { className: 'btn', type: 'button', disabled: !DEMO_READY },
    DEMO_READY ? '체험 방으로 들어가기' : '체험 방으로 들어가기 (준비 중)');
  demoButton.addEventListener('click', async () => {
    demoButton.disabled = true;
    demoError.textContent = '';
    try {
      const demo = await api('/api/rooms/demo', { method: 'POST' });
      showRoom({ ...demo, memberCount: demo.members?.length ?? 0 }, { demoMembers: demo.members });
    } catch (err) {
      demoError.textContent = messageOf(err);
    } finally {
      demoButton.disabled = false;
    }
  });

  root.replaceChildren(
    el('section', { className: 'panel stack' }, el('h2', {}, '팀 방으로 들어가기'),
      el('p', { className: 'sub' }, '팀원에게 받은 방 코드 6자리를 넣어 주세요.'), joinForm),
    el('section', { className: 'panel stack' }, el('h2', {}, '새 방 만들기'),
      el('p', { className: 'sub' }, '팀 이름과 팀원 수를 정하면 방 코드가 나옵니다. 정원이 차고 등록된 전원이 제출하면 추정이 공개됩니다.'), createForm),
    el('section', { className: 'panel stack' }, el('h2', {}, '먼저 둘러보기'),
      el('p', { className: 'sub' }, '예시 팀이 들어 있는 체험 방을 새로 만들어 들어갑니다. 다른 사람과 섞이지 않습니다.'),
      el('div', {}, demoButton), demoError));
  code.focus();
}

// ---------- ② 방 확인: 코드 크게 · 복사 → 처음 참여 / 기존 팀원 ----------

function codeBlock(room) {
  const copy = el('button', { className: 'btn btn--quiet btn--s', type: 'button' }, '코드 복사');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(room.code); copy.textContent = '복사했습니다'; } catch { copy.textContent = '직접 적어 주세요'; }
  });
  return el('div', { className: 'between' },
    el('strong', { className: 'room-code', ariaLabel: `방 코드 ${room.code.split('').join(' ')}` }, room.code), copy);
}

function showRoom(room, { created = false, demoMembers = null } = {}) {
  const full = room.memberCount >= room.size;
  const back = el('button', { className: 'btn btn--quiet', type: 'button' }, '다른 방으로');
  back.addEventListener('click', startView);

  // 처음 참여 — 이름만 받는다. 가능한 시간은 0 으로 시작하고 들어간 뒤 등록 · 진행 화면에서 넣는다
  const name = el('input', { maxLength: 20, autocomplete: 'off' });
  const firstTime = full
    ? el('p', { className: 'sub' }, '팀원 수가 다 찼습니다. 이미 등록된 팀원이면 아래 "기존 팀원" 에서 이름을 골라 주세요.')
    : form([field('내 이름', name)], '처음 참여', async () => {
      enterAs(room, await api(`/api/rooms/${room.code}/join`, { method: 'POST', body: { name: name.value } }));
    });

  // 기존 팀원 — 이름을 골라 다시 들어간다. 신원은 확인하지 않는다 (정한 것 2)
  const pickBox = el('div', { className: 'stack' });
  const pickError = el('p', { className: 'msg-error', role: 'alert' });
  async function loadMembers() {
    if (room.memberCount === 0 && !demoMembers) {
      pickBox.replaceChildren(el('p', { className: 'sub' }, '아직 들어온 팀원이 없습니다.'));
      return;
    }
    try {
      const members = demoMembers ?? await api('/api/members', { headers: { 'Content-Type': 'application/json', 'X-Room-Code': room.code } });
      if (!members.length) {
        pickBox.replaceChildren(el('p', { className: 'sub' }, '아직 들어온 팀원이 없습니다.'));
        return;
      }
      pickBox.replaceChildren(el('div', { className: 'row' }, ...members.map((m) => {
        const b = el('button', { className: 'btn', type: 'button' }, m.name);
        b.addEventListener('click', () => {
          try { enterAs(room, m); } catch (err) { pickError.textContent = err.message; }
        });
        return b;
      })));
    } catch (err) {
      pickError.textContent = messageOf(err);
    }
  }

  root.replaceChildren(
    el('section', { className: 'panel stack' },
      el('div', { className: 'between' }, el('h2', {}, room.name), el('span', { className: 'badge' }, `${room.memberCount} / ${room.size}명 입장`)),
      created ? el('p', { className: 'sub' }, '방을 만들었습니다. 이 코드를 팀원에게 알려 주세요.') : null,
      codeBlock(room),
      el('div', {}, back)),
    demoMembers ? null : el('section', { className: 'panel stack' }, el('h2', {}, '처음 참여'),
      el('p', { className: 'sub' }, '이름만 받습니다. 학번 · 연락처는 적지 마세요.'), firstTime),
    el('section', { className: 'panel stack' }, el('h2', {}, demoMembers ? '누구로 둘러볼까요' : '기존 팀원'),
      el('p', { className: 'sub' }, demoMembers ? '예시 팀원 중 한 명을 골라 들어갑니다.' : '이미 들어온 적이 있으면 내 이름을 골라 주세요.'),
      demoMembers ? null : el('p', { className: 'sub' }, '이름만 고르면 들어갑니다. 본인 확인은 하지 않습니다.'),
      pickBox, pickError));
  loadMembers();
  if (!full && !demoMembers) name.focus();
}

// ---------- 시작: 입장 코드가 꺼져 있으면 안내만 ----------

// 입장 코드 스위치는 공개 설정(GET /api/config 의 roomsEnabled)으로 본다 — 리뷰 #60 합의
function checkConfig() {
  api('/api/config').then(({ roomsEnabled }) => {
    if (roomsEnabled) return startView();
    root.replaceChildren(el('section', { className: 'panel stack' }, el('h2', {}, '입장 코드가 아직 꺼져 있습니다'),
      el('p', { className: 'sub' }, '지금은 팀 하나로 동작합니다. 바로 시작하면 됩니다.'),
      el('div', {}, el('a', { className: 'btn btn--primary', href: 'home.html' }, '바로 시작하기'))));
  }).catch((err) => {
    // 켜졌는지 모르는 채로 입장 폼을 보여 주지 않는다
    const retry = el('button', { className: 'btn btn--primary', type: 'button' }, '다시 시도');
    retry.addEventListener('click', checkConfig);
    root.replaceChildren(el('section', { className: 'panel stack' }, el('h2', {}, '설정을 불러오지 못했습니다'),
      el('p', { className: 'msg-error', role: 'alert' }, messageOf(err)), el('div', {}, retry)));
  });
}

if (root) checkConfig();
