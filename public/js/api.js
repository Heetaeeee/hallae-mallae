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

// 페이지를 열 때 한 번. 각 화면 JS 가 'data' 를 듣기 시작한 뒤에 불러야 해서 HTML 맨 끝에서 부릅니다.
export function start() {
  refresh().catch((error) => {
    document.querySelector('#app-error').textContent = `데이터를 불러오지 못했습니다. ${error.message}`;
  });
}
