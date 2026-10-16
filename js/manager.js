// 매니저 페이지: 대기 중인 사람 보기·강제 매칭·수정·내보내기, 진행 중인 매칭, 성사된 커플, 신고.
// 들어오려면 운영자 비밀번호가 필요하다. 비밀번호는 Firebase 콘솔 > Realtime Database > 데이터의
// adminKey에만 있고(아무도 읽을 수 없다), 맞히면 admins/{내 uid}에 기록돼 보안 규칙이 매니저로 인정한다.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref, get, set, update, remove, push, onValue, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { CONFIG } from './config.js';
import { compatibility, maskBadWords } from './common.js';

const $ = id => document.getElementById(id);
const app = initializeApp(CONFIG.firebase);
const auth = getAuth(app);
const db = getDatabase(app);

const SEARCH_MS = CONFIG.searchMinutes * 60000;
const GENDER = { m: '남', f: '여' };

let uid = null;
let serverOffset = 0;
const now = () => Date.now() + serverOffset;

const state = {
  queue: {},
  rooms: {},
  couples: {},
  reports: {},
  selected: [],      // 강제 매칭하려고 고른 uid (최대 2명)
  editing: null,     // 수정 중인 uid
  started: false,
};

function show(name) {
  for (const id of ['m-loading', 'm-login', 'm-main']) $(id).hidden = id !== name;
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const b = el('button', `btn ${className}`, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// 실수로 누르지 않게 두 번 눌러야 실행되는 버튼
function confirmButton(text, confirmText, className, onConfirm) {
  let armed = null;
  const b = button(text, className, () => {
    if (armed) {
      clearTimeout(armed);
      armed = null;
      b.textContent = text;
      onConfirm();
      return;
    }
    b.textContent = confirmText;
    armed = setTimeout(() => {
      armed = null;
      b.textContent = text;
    }, 3000);
  });
  return b;
}

function fmtWait(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function fmtTime(at) {
  if (!at) return '';
  return new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function who(p) {
  if (!p) return '알 수 없음';
  return `${maskBadWords(p.nick || '익명')} (${GENDER[p.gender] || '?'}·${p.age ?? '?'}살)`;
}

// uid → 닉네임 찾기 (신고 목록에서 쓴다)
function lookup(id) {
  if (state.queue[id]) return state.queue[id];
  for (const room of Object.values(state.rooms)) {
    if (room?.profiles?.[id]) return room.profiles[id];
  }
  for (const couple of Object.values(state.couples)) {
    if (couple?.[id]) return couple[id];
  }
  return null;
}

// ---------- 대기 중 ----------

function waitStatus(entry) {
  if (entry.busy) return '💌 신청 보내는 중';
  const waited = now() - (entry.at || now());
  return waited < SEARCH_MS ? '💗 80% 찾는 중' : '📋 후보 고르는 중';
}

function renderQueue() {
  const entries = Object.entries(state.queue)
    .filter(([, e]) => e && !e.kicked)
    .sort(([, x], [, y]) => (x.at || 0) - (y.at || 0));
  state.selected = state.selected.filter(id => state.queue[id] && !state.queue[id].kicked);

  $('cnt-m').textContent = entries.filter(([, e]) => e.gender === 'm').length;
  $('cnt-f').textContent = entries.filter(([, e]) => e.gender === 'f').length;
  $('queue-empty').hidden = entries.length > 0;

  $('queue-list').replaceChildren(...entries.map(([id, e]) => {
    const row = el('div', 'm-row' + (state.selected.includes(id) ? ' on' : ''));
    const pick = el('input');
    pick.type = 'checkbox';
    pick.checked = state.selected.includes(id);
    pick.setAttribute('aria-label', `${e.nick} 고르기`);
    pick.addEventListener('change', () => toggleSelect(id));

    const g = el('span', `m-gender ${e.gender}`, GENDER[e.gender] || '?');
    const info = el('div', 'm-info');
    info.append(el('strong', '', `${maskBadWords(e.nick || '익명')} · ${e.age}살`));
    const sub = el('span', 'muted');
    sub.dataset.since = e.at || 0;
    sub.dataset.status = waitStatus(e);
    sub.textContent = `${waitStatus(e)} · 대기 ${fmtWait(now() - (e.at || now()))}`;
    info.append(sub);

    const actions = el('div', 'm-actions');
    actions.append(
      button('수정', 'ghost small-btn', () => openEdit(id)),
      confirmButton('내보내기', '정말?', 'ghost small-btn danger-text', () => kick(id)),
    );
    row.append(pick, g, info, actions);
    row.addEventListener('click', e2 => {
      if (e2.target === row || e2.target === info || info.contains(e2.target)) toggleSelect(id);
    });
    return row;
  }));
  renderPair();
}

function toggleSelect(id) {
  if (state.selected.includes(id)) state.selected = state.selected.filter(x => x !== id);
  else state.selected = [...state.selected, id].slice(-2);
  renderQueue();
}

function pairProblems(a, b) {
  const blocks = [];
  const warns = [];
  if (a.gender === b.gender) blocks.push('같은 성별이에요.');
  const aMinor = a.age < CONFIG.adultAge;
  const bMinor = b.age < CONFIG.adultAge;
  if (aMinor !== bMinor) blocks.push(`${CONFIG.adultAge}살 미만과 성인은 이을 수 없어요.`);
  else if (!aMinor && Math.abs(a.age - b.age) > CONFIG.adultMaxAgeGap) warns.push(`나이 차이가 ${Math.abs(a.age - b.age)}살이에요.`);
  if (a.blocked?.[b.uid] || b.blocked?.[a.uid]) blocks.push('한쪽이 상대를 차단했어요.');
  if (a.history?.[b.uid] || b.history?.[a.uid]) warns.push('이미 한 번 만난 사이예요.');
  if (a.busy || b.busy) blocks.push('신청을 보내는 중인 사람이 있어요. 잠시 뒤에 해 주세요.');
  return { blocks, warns };
}

function renderPair() {
  const bar = $('pair-bar');
  if (state.selected.length !== 2) {
    bar.hidden = true;
    return;
  }
  const [a, b] = state.selected.map(id => ({ ...state.queue[id], uid: id }));
  const score = compatibility(a.answers, b.answers);
  $('pair-text').textContent = `${who(a)}  💘  ${who(b)}  ·  궁합 ${score}%`;
  const { blocks, warns } = pairProblems(a, b);
  const lines = [...blocks, ...warns];
  $('pair-warn').hidden = lines.length === 0;
  $('pair-warn').textContent = lines.join(' ');
  $('pair-warn').classList.toggle('block', blocks.length > 0);
  $('pair-go').disabled = blocks.length > 0;
  bar.hidden = false;
}

$('pair-clear').addEventListener('click', () => {
  state.selected = [];
  renderQueue();
});

$('pair-go').addEventListener('click', async () => {
  if (state.selected.length !== 2) return;
  const [a, b] = state.selected;
  $('pair-go').disabled = true;
  try {
    await forceMatch(a, b);
    state.selected = [];
    toast('강제 매칭했어요. 두 사람에게 승낙/넘기기 화면이 떠요.');
  } catch (err) {
    console.error(err);
    toast(err.message || '매칭하지 못했어요.');
  } finally {
    renderQueue();
  }
});

// 두 사람을 대기열에서 한 번에 빼고(트랜잭션) 방을 만든 뒤 둘 다에게 알린다.
// 승낙/넘기기 단계부터 시작하니, 둘 다 승낙해야 이름·사진이 공개된다.
async function forceMatch(a, b) {
  let ea = null;
  let eb = null;
  const result = await runTransaction(ref(db, 'queue'), q => {
    if (!q || !q[a] || !q[b] || q[a].busy || q[b].busy || q[a].kicked || q[b].kicked) return undefined;
    ea = q[a];
    eb = q[b];
    delete q[a];
    delete q[b];
    return q;
  });
  if (!result.committed || !ea || !eb) throw new Error('그사이 다른 사람과 매칭됐거나 대기열에서 나갔어요.');

  const pub = e => ({ nick: e.nick, age: e.age, gender: e.gender, answers: e.answers });
  const roomRef = push(ref(db, 'rooms'));
  await set(roomRef, {
    a,
    b,
    at: serverTimestamp(),
    score: compatibility(ea.answers, eb.answers),
    mode: 'admin',
    profiles: { [a]: pub(ea), [b]: pub(eb) },
  });
  await set(ref(db, `match/${a}`), roomRef.key);
  await set(ref(db, `match/${b}`), roomRef.key);
}

async function kick(id) {
  try {
    await update(ref(db, `queue/${id}`), { kicked: true });
    toast('대기열에서 내보냈어요.');
  } catch (err) {
    console.error(err);
    toast('내보내지 못했어요. 이미 나갔을 수 있어요.');
  }
}

// ---------- 정보 수정 ----------

function openEdit(id) {
  const e = state.queue[id];
  if (!e) return;
  state.editing = id;
  $('edit-nick').value = e.nick || '';
  $('edit-age').value = e.age ?? '';
  $('edit-age').min = CONFIG.minAge;
  $('edit-age').max = CONFIG.maxAge;
  for (const r of document.querySelectorAll('input[name="edit-gender"]')) r.checked = r.value === e.gender;
  $('dlg-edit').returnValue = '';
  $('dlg-edit').showModal();
}

$('dlg-edit').addEventListener('close', async () => {
  const id = state.editing;
  state.editing = null;
  if ($('dlg-edit').returnValue !== 'save' || !id) return;
  const nick = $('edit-nick').value.trim().slice(0, CONFIG.nickMaxLength);
  const age = Number($('edit-age').value);
  const gender = document.querySelector('input[name="edit-gender"]:checked')?.value;
  if (!nick || !Number.isInteger(age) || age < CONFIG.minAge || age > CONFIG.maxAge || !gender) {
    toast('닉네임·나이·성별을 확인해 주세요.');
    return;
  }
  if (!state.queue[id]) {
    toast('그사이 대기열에서 나갔어요.');
    return;
  }
  try {
    await update(ref(db, `queue/${id}`), { nick, age, gender });
    toast('고쳤어요.');
  } catch (err) {
    console.error(err);
    toast('고치지 못했어요. 그사이 매칭됐을 수 있어요.');
  }
});

// ---------- 매칭 진행 ----------

function roomStatus(room) {
  const d = room.decide || {};
  const left = room.left || {};
  if (d[room.a] === 'pass' || d[room.b] === 'pass') return { text: '넘김', done: true };
  if (left[room.a] || left[room.b]) return { text: '나감', done: true };
  if (d[room.a] === 'accept' && d[room.b] === 'accept') return { text: '💬 성사 · 대화 중', done: false, chatting: true };
  return { text: '승낙/넘기기 고르는 중', done: false };
}

const MODE = { auto: '자동 80%', request: '신청', admin: '운영자 매칭' };

function renderRooms() {
  const list = Object.entries(state.rooms)
    .filter(([, r]) => r && r.a && r.b)
    .map(([id, r]) => ({ id, r, s: roomStatus(r) }))
    .filter(x => !x.s.done)
    .sort((x, y) => (y.r.at || 0) - (x.r.at || 0));
  $('cnt-rooms').textContent = list.length;
  $('rooms-empty').hidden = list.length > 0;

  $('rooms-list').replaceChildren(...list.map(({ r, s }) => {
    const row = el('div', 'm-card');
    const top = el('div', 'm-card-top');
    top.append(
      el('span', `m-chip ${r.mode || 'auto'}`, MODE[r.mode] || '자동'),
      el('span', 'muted', `궁합 ${r.score ?? 0}% · ${fmtTime(r.at)}`),
    );
    const names = r.names || {};
    const person = id => {
      const p = r.profiles?.[id];
      const d = r.decide?.[id];
      const line = el('div', 'm-person');
      line.append(el('span', `m-gender ${p?.gender}`, GENDER[p?.gender] || '?'));
      line.append(el('strong', '', `${maskBadWords(p?.nick || '익명')} · ${p?.age ?? '?'}살` + (names[id] ? ` (${names[id]})` : '')));
      if (!s.chatting) line.append(el('span', d === 'accept' ? 'm-ok' : 'muted', d === 'accept' ? '✅ 승낙' : '고르는 중…'));
      return line;
    };
    row.append(top, person(r.a), person(r.b), el('p', 'm-status', s.text));
    return row;
  }));
}

// ---------- 매칭 성사 ----------

function renderCouples() {
  const list = Object.entries(state.couples)
    .map(([id, c]) => ({ id, people: Object.values(c || {}) }))
    .filter(x => x.people.length > 0)
    .sort((x, y) => Math.max(...y.people.map(p => p.at || 0)) - Math.max(...x.people.map(p => p.at || 0)));
  $('cnt-couples').textContent = list.length;
  $('couples-empty').hidden = list.length > 0;

  $('couples-list').replaceChildren(...list.map(({ id, people }) => {
    const row = el('div', 'm-card couple');
    const at = Math.max(...people.map(p => p.at || 0));
    row.append(el('div', 'm-card-top muted', `궁합 ${people[0].score ?? 0}% · ${fmtTime(at)}`));
    for (const p of people) {
      const line = el('div', 'm-person');
      line.append(
        el('span', `m-gender ${p.gender}`, GENDER[p.gender] || '?'),
        el('strong', '', p.name || '이름 없음'),
        el('span', 'muted', `${maskBadWords(p.nick || '')} · ${p.age}살`),
      );
      row.append(line);
    }
    if (people.length < 2) row.append(el('p', 'muted', '상대 기록이 아직 안 올라왔어요.'));
    row.append(confirmButton('기록 지우기', '정말 지울까요?', 'ghost small-btn', async () => {
      try {
        await remove(ref(db, `couples/${id}`));
      } catch (err) {
        console.error(err);
        toast('지우지 못했어요.');
      }
    }));
    return row;
  }));
}

// ---------- 신고 ----------

function renderReports() {
  const list = Object.entries(state.reports).sort(([, x], [, y]) => (y.at || 0) - (x.at || 0));
  $('reports-empty').hidden = list.length > 0;
  $('cnt-reports').hidden = list.length === 0;
  $('cnt-reports').textContent = list.length;

  $('reports-list').replaceChildren(...list.map(([id, r]) => {
    const row = el('div', 'm-card report');
    row.append(el('div', 'm-card-top', `🚨 ${r.reason || '기타'} · ${fmtTime(r.at)}`));
    row.append(el('p', '', `신고한 사람: ${who(lookup(r.by))}`));
    row.append(el('p', '', `신고당한 사람: ${who(lookup(r.target))}`));
    if (Array.isArray(r.log) && r.log.length) {
      const details = el('details');
      details.append(el('summary', '', `대화 ${r.log.length}줄 보기`));
      const log = el('div', 'm-log');
      for (const m of r.log) {
        log.append(el('p', m.from === 'target' ? 'target' : '', `${m.from === 'target' ? '신고당한 사람' : '신고한 사람'}: ${m.text}`));
      }
      details.append(log);
      row.append(details);
    }
    row.append(confirmButton('처리 완료 (지우기)', '정말 지울까요?', 'ghost small-btn', async () => {
      try {
        await remove(ref(db, `reports/${id}`));
      } catch (err) {
        console.error(err);
        toast('지우지 못했어요.');
      }
    }));
    return row;
  }));
}

// ---------- 탭 ----------

for (const tab of document.querySelectorAll('.m-tab')) {
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll('.m-tab')) t.classList.toggle('on', t === tab);
    for (const p of document.querySelectorAll('.m-panel')) p.hidden = p.id !== `tab-${tab.dataset.tab}`;
    $('pair-bar').hidden = tab.dataset.tab !== 'queue' || state.selected.length !== 2;
  });
}

// 대기 시간은 1초마다 글자만 바꾼다 (목록을 다시 그리면 체크가 풀리니까)
setInterval(() => {
  for (const sub of document.querySelectorAll('#queue-list [data-since]')) {
    const since = Number(sub.dataset.since) || now();
    sub.textContent = `${sub.dataset.status} · 대기 ${fmtWait(now() - since)}`;
  }
}, 1000);

// ---------- 로그인 ----------

function lostAccess(err) {
  console.error(err);
  state.started = false;
  show('m-login');
  toast('매니저 권한이 없어요. 비밀번호를 다시 넣어 주세요.');
}

function start() {
  if (state.started) return;
  state.started = true;
  show('m-main');
  onValue(ref(db, 'queue'), snap => {
    state.queue = snap.val() || {};
    renderQueue();
  }, lostAccess);
  onValue(ref(db, 'rooms'), snap => {
    state.rooms = snap.val() || {};
    renderRooms();
  }, lostAccess);
  onValue(ref(db, 'couples'), snap => {
    state.couples = snap.val() || {};
    renderCouples();
  }, lostAccess);
  onValue(ref(db, 'reports'), snap => {
    state.reports = snap.val() || {};
    renderReports();
  }, lostAccess);
}

async function isManager() {
  try {
    await get(ref(db, 'couples'));
    return true;
  } catch {
    return false;
  }
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  const typed = $('login-input').value.trim();
  // 콘솔에서 숫자만 넣으면 adminKey가 숫자로 저장된다. 글자로 먼저 해 보고, 숫자면 숫자로도 해 본다
  const tries = /^\d+$/.test(typed) ? [typed, Number(typed)] : [typed];
  try {
    let ok = false;
    for (const value of tries) {
      try {
        await set(ref(db, `admins/${uid}`), value);
        ok = true;
        break;
      } catch (err) {
        console.warn(err);
      }
    }
    if (!ok) throw new Error('wrong password');
    $('login-input').value = '';
    start();
  } catch (err) {
    console.error(err);
    toast('비밀번호가 틀렸어요.');
  } finally {
    button.disabled = false;
  }
});

async function main() {
  const user = await new Promise(resolve => {
    const off = onAuthStateChanged(auth, u => {
      if (u) {
        off();
        resolve(u);
        return;
      }
      signInAnonymously(auth).catch(err => console.error('익명 로그인 실패', err));
    });
  });
  uid = user.uid;
  onValue(ref(db, '.info/serverTimeOffset'), snap => { serverOffset = snap.val() || 0; });
  if (await isManager()) start();
  else {
    show('m-login');
    $('login-input').focus();
  }
}

main();
