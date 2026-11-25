// 공용 호출 함수 (C 작성). 각자 화면 JS 는 이 두 함수만 가져다 씁니다.

// 입장 화면(enter.html)에서 들어간 방 — { code, roomName, memberId, memberName }
export const ROOM_KEY = 'hallae:room';
export function savedRoom() {
  try { return JSON.parse(localStorage.getItem(ROOM_KEY)); } catch { return null; }
}

// 방 코드가 없거나 그 방이 없다는 응답이면 입장 화면으로 보낸다 (입장 코드를 켰을 때만 이 응답이 온다 — B 의 room-context)
// shortcut: 서버 오류 문장으로 판별한다. 문장을 바꾸면 여기도 같이 바꾸고, 필요해지면 오류 코드를 따로 받는다
const NEEDS_ROOM = ['올바른 방 코드를 함께 보내 주세요.', '방을 찾을 수 없습니다.'];

export async function api(path, options) {
  const room = savedRoom();
  const res = await fetch(path, {
    ...options,
    // 들어간 방이 있으면 모든 요청에 방 코드를 붙인다. 입장 코드가 꺼져 있으면 서버가 이 헤더를 무시한다
    headers: { 'Content-Type': 'application/json', ...(room?.code ? { 'X-Room-Code': room.code } : {}), ...options?.headers },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 방 API(/api/rooms) 자체의 "방을 찾을 수 없습니다" 는 입장 화면에서 코드를 잘못 넣은 경우라 그대로 보여 준다
    if (NEEDS_ROOM.includes(data.error) && !path.startsWith('/api/rooms') && !location.pathname.endsWith('enter.html')) {
      try { localStorage.removeItem(ROOM_KEY); } catch { /* 지우지 못해도 입장 화면에서 다시 고르면 된다 */ }
      location.href = 'enter.html';
    }
    throw new Error(data.error ?? '요청을 처리하지 못했습니다.');
  }
  return data;
}

let latest = 0;

// members · tasks 를 받아 'data' 이벤트를 냅니다. 데이터를 바꾼 뒤에는 항상 부릅니다.
export async function refresh() {
  const mine = ++latest;
  const [members, tasks] = await Promise.all([api('/api/members'), api('/api/tasks')]);
  // 늦게 도착한 이전 응답이 최신 화면을 덮지 않게, 마지막으로 부른 것만 그린다
  if (mine !== latest) return;
  document.querySelector('#app-error').textContent = '';
  document.dispatchEvent(new CustomEvent('data', { detail: { members, tasks } }));
}

// 입장 코드 스위치(GET /api/config). 한 페이지에서 한 번만 묻는다
// 못 물어보면 꺼진 것으로 치지 않고 실패로 돌려주고, 다음에 부를 때 다시 묻는다 (#61 리뷰 · #60 합의)
let config;
export function roomsEnabled() {
  config ??= api('/api/config').then((c) => c.roomsEnabled === true, (error) => { config = undefined; throw error; });
  return config;
}

// 머리말 메뉴 아래에 "팀명 · 내 이름 · 정원 · 나가기" (입장 코드가 켜져 있고 들어간 방이 있을 때만)
const make = (tag, props, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };

// 정원 — 실제 인원과 다르면 추정이 공개되지 않거나(크게) 마지막 사람이 못 들어온다(작게). 그래서 누구나 바꿀 수 있게 둔다 (#71)
let roomSize = null;
let memberCount = null;
function drawSize() {
  const box = document.querySelector('#room-size');
  if (!box || roomSize === null) return;
  const count = memberCount ?? 0;
  box.textContent = `${count} / ${roomSize}명 입장` + (count < roomSize ? ' — 정원이 다 차야 추정이 공개됩니다' : '');
}

function sizeEditor(code) {
  const show = make('button', { type: 'button', className: 'btn btn--quiet btn--s', textContent: '정원 바꾸기' });
  const input = make('input', { type: 'number', min: '1', step: '1', inputMode: 'numeric' });
  const save = make('button', { type: 'submit', className: 'btn btn--primary btn--s', textContent: '저장' });
  const cancel = make('button', { type: 'button', className: 'btn btn--quiet btn--s', textContent: '취소' });
  const error = make('p', { className: 'msg-error', role: 'alert' });
  const form = make('form', { className: 'row', noValidate: true, hidden: true },
    make('label', { className: 'field field--s' }, '정원(명)', input), save, cancel);
  const toggle = (open) => {
    form.hidden = !open;
    show.hidden = open;
    error.textContent = '';
    if (open) { input.value = roomSize ?? ''; input.min = String(Math.max(memberCount ?? 1, 1)); input.focus(); } else show.focus();
  };
  show.addEventListener('click', () => toggle(true));
  cancel.addEventListener('click', () => toggle(false));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    save.disabled = true;
    error.textContent = '';
    try {
      // 서버가 인원보다 작은 정원을 거절하고, 인원과 같아지면 공개 조건을 다시 본다 — 그래서 저장 뒤 다시 불러온다
      roomSize = (await api(`/api/rooms/${encodeURIComponent(code)}`, { method: 'PATCH', body: { size: input.valueAsNumber } })).size;
      drawSize();
      toggle(false);
      await refresh();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      save.disabled = false;
    }
  });
  return [show, form, error];
}

function showRoomBar(room) {
  const leave = make('button', { type: 'button', className: 'btn btn--quiet btn--s', textContent: '나가기' });
  leave.addEventListener('click', () => {
    try { localStorage.removeItem(ROOM_KEY); } catch { /* 지우지 못해도 입장 화면에서 다시 고르면 된다 */ }
    location.href = 'enter.html';
  });
  const text = make('span', { id: 'room-who', textContent: `${room.roomName} · ${room.memberName}` });
  const [show, form, error] = sizeEditor(room.code);
  const bar = make('div', { className: 'stack sub' },
    make('div', { className: 'between' }, text, leave),
    make('div', { className: 'row', style: 'align-items: center' }, make('span', { id: 'room-size' }), show, form),
    error);
  document.querySelector('header .nav')?.after(bar);
  api(`/api/rooms/${encodeURIComponent(room.code)}`).then((r) => {
    roomSize = r.size;
    memberCount ??= r.memberCount;
    drawSize();
  }, () => { show.hidden = true; }); // 방 정보를 못 받으면 정원 칸만 비운다 — 데이터 오류는 #app-error 가 알린다
}

// 설정을 못 불러오면 꺼짐으로 넘기지 않고 알린 뒤 새로고침으로 다시 묻게 한다
function showConfigError(error) {
  const retry = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn--s', textContent: '다시 시도' });
  retry.addEventListener('click', () => location.reload());
  // #app-error 는 데이터를 새로 받으면 지워지므로 따로 둔다
  const box = Object.assign(document.createElement('p'), { className: 'msg-error', role: 'alert' });
  box.append(`설정을 불러오지 못했습니다. ${error.message} `, retry);
  document.querySelector('#app-error')?.after(box);
}

// 페이지를 열 때 한 번. 각 화면 JS 가 'data' 를 듣기 시작한 뒤에 불러야 해서 HTML 맨 끝에서 부릅니다.
export function start() {
  const room = savedRoom();
  roomsEnabled().then((on) => { if (on && room) showRoomBar(room); }, showConfigError);
  document.addEventListener('data', async ({ detail }) => {
    if (!room?.memberId) return;
    const on = await roomsEnabled().catch(() => false); // 실패는 위 안내가 맡는다. 확인 못 한 채로 입장 화면에 보내지 않는다
    if (!on) return;
    memberCount = detail.members.length;
    drawSize();
    const me = detail.members.find((m) => m.id === room.memberId);
    if (me) {
      // 이름을 고쳤으면 머리말과 저장값도 따라간다
      if (me.name === room.memberName) return;
      room.memberName = me.name;
      try { localStorage.setItem(ROOM_KEY, JSON.stringify(room)); } catch { /* 머리말만 바꾼다 */ }
      const who = document.querySelector('#room-who');
      if (who) who.textContent = `${room.roomName} · ${room.memberName}`;
      return;
    }
    // 저장된 내가 팀원 목록에서 지워졌으면 그 방의 입장 화면으로 보내 다시 고르게 한다
    try { localStorage.removeItem(ROOM_KEY); } catch { /* 위와 같음 */ }
    location.href = `enter.html?code=${encodeURIComponent(room.code)}`;
  });
  const load = () => refresh().catch((error) => {
    document.querySelector('#app-error').textContent = `데이터를 불러오지 못했습니다. ${error.message}`;
  });
  load();
  // P5: 다른 탭에 있다 돌아오면 다시 불러와 다른 팀원이 바꾼 것을 보여 준다
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
}
