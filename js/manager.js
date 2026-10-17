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
import { compatibility, maskBadWords, matchReasons, surveySteps, pickPartner } from './common.js';

const $ = id => document.getElementById(id);
const app = initializeApp(CONFIG.firebase);
const auth = getAuth(app);
const db = getDatabase(app);

const SEARCH_MS = CONFIG.searchMinutes * 60000;
const GENDER = { m: '남', f: '여' };
const STEPS = surveySteps();
const DEFAULT_AVATAR = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="25" r="11" fill="var(--avatar-fg)"/><path d="M11 56c2-11 10.5-17 21-17s19 6 21 17" fill="var(--avatar-fg)"/></svg>';

function isPhoto(src) {
  return typeof src === 'string' && src.startsWith('data:image/');
}

function setAvatar(node, src) {
  if (isPhoto(src)) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = src;
    node.replaceChildren(img);
  } else {
    node.innerHTML = DEFAULT_AVATAR;
  }
}

let uid = null;
let serverOffset = 0;
const now = () => Date.now() + serverOffset;

const state = {
  queue: {},
  private: {},       // 대기 중인 사람의 실명·사진
  rooms: {},
  couples: {},
  reports: {},
  selected: [],      // 강제 매칭하려고 고른 uid (최대 2명). 첫 번째가 기준
  editing: null,     // 수정 중인 uid
  viewing: null,     // 프로필 자세히 보는 uid
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

// 전화번호를 누르면 폰 문자 앱이 그 번호로 열린다
function phoneLink(phone) {
  const a = el('a', 'm-phone', `💬 ${phone}`);
  a.href = `sms:${String(phone).replace(/\D/g, '')}`;
  a.addEventListener('click', ev => ev.stopPropagation());
  return a;
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
  return waited < SEARCH_MS ? `💗 ${CONFIG.autoMatchScore}% 찾는 중` : '📋 후보 고르는 중';
}

// 한 명을 고르면(기준) 그 사람은 맨 위, 나머지는 기준과의 궁합 높은 순. 이성이 먼저 온다
function sortedQueue() {
  const entries = Object.entries(state.queue).filter(([, e]) => e && !e.kicked);
  const anchorId = state.selected[0];
  const anchor = anchorId && state.queue[anchorId];
  if (!anchor) {
    return entries
      .sort(([, x], [, y]) => (x.at || 0) - (y.at || 0))
      .map(([id, e]) => ({ id, e, score: null }));
  }
  const rest = entries
    .filter(([id]) => id !== anchorId)
    .map(([id, e]) => ({ id, e, score: compatibility(anchor.answers, e.answers), other: e.gender !== anchor.gender }))
    .sort((x, y) => (y.other - x.other) || (y.score - x.score) || ((x.e.at || 0) - (y.e.at || 0)));
  return [{ id: anchorId, e: anchor, score: null, anchor: true }, ...rest];
}

function avatarButton(id, e) {
  const face = el('button', `avatar md m-face ${e.gender || ''}`);
  face.type = 'button';
  face.setAttribute('aria-label', `${e.nick} 프로필 자세히`);
  setAvatar(face, state.private[id]?.photo);
  face.addEventListener('click', ev => {
    ev.stopPropagation();
    openPerson(id);
  });
  return face;
}

function renderQueue() {
  state.selected = state.selected.filter(id => state.queue[id] && !state.queue[id].kicked);
  const entries = Object.entries(state.queue).filter(([, e]) => e && !e.kicked);

  $('cnt-m').textContent = entries.filter(([, e]) => e.gender === 'm').length;
  $('cnt-f').textContent = entries.filter(([, e]) => e.gender === 'f').length;
  $('queue-empty').hidden = entries.length > 0;

  $('queue-list').replaceChildren(...sortedQueue().map(({ id, e, score, anchor }) => {
    const row = el('div', 'm-row' + (state.selected.includes(id) ? ' on' : '') + (anchor ? ' anchor' : ''));
    const pick = el('input');
    pick.type = 'checkbox';
    pick.checked = state.selected.includes(id);
    pick.setAttribute('aria-label', `${e.nick} 고르기`);
    pick.addEventListener('change', () => toggleSelect(id));

    const g = avatarButton(id, e);
    const info = el('div', 'm-info');
    info.append(el('strong', '', `${maskBadWords(e.nick || '익명')} · ${GENDER[e.gender] || '?'} ${e.age}살`));
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
    const pct = anchor ? el('span', 'm-pct base', '기준')
      : score === null ? null
      : el('span', 'm-pct' + (score >= CONFIG.autoMatchScore ? ' high' : ''), `${score}%`);
    row.append(pick, g, info);
    if (pct) row.append(pct);
    row.append(actions);
    row.addEventListener('click', e2 => {
      if (e2.target === row || e2.target === info || info.contains(e2.target)) toggleSelect(id);
    });
    return row;
  }));
  renderPair();
}

function toggleSelect(id) {
  if (state.selected.includes(id)) state.selected = state.selected.filter(x => x !== id);
  else if (state.selected.length < 2) state.selected = [...state.selected, id];
  else state.selected = [state.selected[0], id];   // 기준(첫 번째)은 두고 상대만 바꾼다
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
async function forceMatch(a, b, mode = 'admin') {
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
    mode,
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

// ---------- 프로필 자세히 ----------

function openPerson(id) {
  if (!state.queue[id]) return;
  state.viewing = id;
  fillPerson(id);
  $('dlg-person').showModal();
}

function fillPerson(id) {
  const e = state.queue[id];
  if (!e) {
    $('dlg-person').close();
    toast('그사이 대기열에서 나갔어요.');
    return;
  }
  const info = state.private[id] || {};
  setAvatar($('person-avatar'), info.photo);
  $('person-avatar').className = `avatar xl-static m-face ${e.gender || ''}`;
  $('person-name').textContent = info.name ? `${info.name} (${maskBadWords(e.nick || '익명')})` : maskBadWords(e.nick || '익명');
  $('person-sub').textContent = `${GENDER[e.gender] || '?'} · ${e.age}살`;
  if (info.phone) $('person-sub').append(' · ', phoneLink(info.phone));
  $('person-status').textContent = `${waitStatus(e)} · 대기 ${fmtWait(now() - (e.at || now()))}`;

  // 기준으로 고른 사람이 따로 있으면 그 사람과의 궁합
  const anchorId = state.selected[0];
  const anchor = anchorId && anchorId !== id ? state.queue[anchorId] : null;
  $('person-match').hidden = !anchor;
  if (anchor) {
    const reasons = matchReasons(anchor.answers, e.answers);
    $('person-match').replaceChildren(
      el('strong', '', `${maskBadWords(anchor.nick)}님과 궁합 ${compatibility(anchor.answers, e.answers)}%`),
      el('p', 'muted', reasons.length ? reasons.join(' · ') : '겹치는 취향이 없어요.'),
    );
  }

  // 설문 답 (분류별로)
  const groups = [];
  for (const step of STEPS) {
    let group = groups.find(g => g.name === step.group);
    if (!group) groups.push(group = { name: step.group, items: [] });
    group.items.push(step);
  }
  $('person-answers').replaceChildren(...groups.map(group => {
    const box = el('div', 'person-group');
    box.append(el('p', 'person-group-name', group.name || '기타'));
    for (const step of group.items) {
      const line = el('div', 'person-line');
      line.append(el('span', 'muted', step.title), el('strong', '', e.answers?.[step.key] || '—'));
      box.append(line);
    }
    return box;
  }));

  $('person-pick').textContent = state.selected.includes(id) ? '고르기 취소' : '고르기';
}

$('person-pick').addEventListener('click', () => {
  const id = state.viewing;
  $('dlg-person').close();
  if (id) toggleSelect(id);
});
$('person-edit').addEventListener('click', () => {
  const id = state.viewing;
  $('dlg-person').close();
  if (id) openEdit(id);
});
$('dlg-person').addEventListener('close', () => { state.viewing = null; });

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
  return { text: '문자해보기/넘기기 고르는 중', done: false };
}

const MODE = { auto: `자동 ${CONFIG.autoMatchScore}%`, request: '신청', admin: '운영자 매칭' };

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
      const info = state.private[id] || {};
      const line = el('div', 'm-person');
      line.append(el('span', `m-gender ${p?.gender}`, GENDER[p?.gender] || '?'));
      line.append(el('strong', '', `${maskBadWords(p?.nick || '익명')} · ${p?.age ?? '?'}살` + (names[id] || info.name ? ` (${names[id] || info.name})` : '')));
      if (!s.chatting) {
        if (d === 'accept') line.append(el('span', 'm-ok', '💬 문자해보기'));
        else if (!r.joined?.[id]) line.append(el('span', 'm-away', '📵 아직 확인 전'));
        else line.append(el('span', 'muted', '고르는 중…'));
      }
      if (info.phone) line.append(phoneLink(info.phone));
      return line;
    };
    const left = (r.at || now()) + CONFIG.proposeSeconds * 1000 - now();
    const status = s.chatting ? s.text : `${s.text} · ${fmtWait(left)} 남음`;
    row.append(top, person(r.a), person(r.b), el('p', 'm-status', status));
    if (!s.chatting && (!r.joined?.[r.a] || !r.joined?.[r.b])) {
      row.append(el('p', 'muted m-hint', '📵 표시된 사람에게 "짝을 찾았어요! 링크로 다시 들어와서 문자해보기를 눌러 주세요"라고 문자해 주세요.'));
    }
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
        p.phone ? phoneLink(p.phone) : el('span'),
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

// ---------- 자동 매칭 ----------
// 참가자 폰은 사이트를 켜 둔 동안에만 스스로 짝을 찾는다. 둘 다 닫아 둔 경우엔 이 화면이 대신 이어 준다.
let autoBusy = false;
async function autoMatch() {
  if (!state.started || autoBusy || !$('auto-match').checked) return;
  const entries = Object.entries(state.queue)
    .filter(([, e]) => e && !e.kicked && !e.busy)
    .sort(([, x], [, y]) => (x.at || 0) - (y.at || 0));
  for (const [id, e] of entries) {
    const partner = pickPartner(state.queue, { ...e, uid: id }, CONFIG.autoMatchScore);
    if (!partner) continue;
    autoBusy = true;
    try {
      await forceMatch(id, partner.uid, 'auto');
      toast(`자동 매칭: ${maskBadWords(e.nick)} 💘 ${maskBadWords(partner.entry.nick)} (${partner.score}%)`);
    } catch (err) {
      console.warn('자동 매칭 건너뜀', err);
    } finally {
      autoBusy = false;
    }
    return;   // 한 번에 한 쌍씩
  }
}
setInterval(() => autoMatch().catch(err => console.warn(err)), 4000);

// 남은 시간 표시를 위해 진행 중 매칭도 10초마다 다시 그린다
setInterval(() => { if (state.started) renderRooms(); }, 10000);

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
  onValue(ref(db, 'private'), snap => {
    state.private = snap.val() || {};
    renderQueue();
    if (state.viewing) fillPerson(state.viewing);
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
