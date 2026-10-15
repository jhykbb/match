// 로컬 모드 저장소: Firebase 없이 테스트할 때 쓴다.
// localStorage를 공용 DB처럼 써서 같은 브라우저의 탭끼리 매칭·채팅된다. 탭 하나 = 사람 하나.
// 탭끼리 같은 키를 동시에 고쳐 쓰면 한쪽 변경이 사라지므로, 값마다 키를 따로 두고
// 되도록 한 키는 한 사람만 쓰게 나눴다 (예: 메시지는 보낸 사람별로 따로 저장).
// 구조는 store.firebase.js와 같다.
import { CONFIG } from './config.js';
import { pickPartner } from './common.js';

export const mode = 'local';

const PREFIX = 'randomchat-local/';
const ALIVE_MS = 6000;
const PARTNER_JOIN_TIMEOUT = 15000;
const RETRY_MS = 1500;

let uid = sessionStorage.getItem('randomchat-local-uid');
if (!uid) {
  uid = 'u' + Math.random().toString(36).slice(2, 10);
  sessionStorage.setItem('randomchat-local-uid', uid);
}

let searching = null;
let currentRoom = null;
const listeners = new Set();

function get(path) {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + path));
  } catch {
    return null;
  }
}

function set(path, value) {
  localStorage.setItem(PREFIX + path, JSON.stringify(value));
  queueMicrotask(notify);   // 다른 탭은 storage 이벤트로 알게 된다
}

function remove(path) {
  localStorage.removeItem(PREFIX + path);
  queueMicrotask(notify);
}

// path 아래의 값들을 { 다음 이름: 값 }으로 모은다. 예: list('queue') → { uid: entry }
function list(path) {
  const start = PREFIX + path + '/';
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(start)) continue;
    const rest = key.slice(start.length);
    if (rest.includes('/')) continue;
    out[rest] = get(path + '/' + rest);
  }
  return out;
}

function removeTree(path) {
  const start = PREFIX + path + '/';
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(start)) keys.push(key);
  }
  keys.forEach(key => localStorage.removeItem(key));
  queueMicrotask(notify);
}

function notify() {
  for (const fn of [...listeners]) fn();
}

function watch(fn) {
  listeners.add(fn);
  fn();
  return () => listeners.delete(fn);
}

window.addEventListener('storage', e => {
  if (e.key === null || e.key.startsWith(PREFIX)) notify();
});

function isAlive(id) {
  return Date.now() - (get(`online/${id}`) || 0) < ALIVE_MS;
}

export async function init() {
  startSession();
  return { uid };
}

function startSession() {
  const beat = () => set(`online/${uid}`, Date.now());
  beat();
  setInterval(beat, 2000);

  // 창을 닫으면 Firebase의 onDisconnect처럼 대기열에서 빠지고 방에서 나간다
  window.addEventListener('pagehide', () => {
    remove(`online/${uid}`);
    remove(`queue/${uid}`);
    removeIncoming();
    if (currentRoom) set(`rooms/${currentRoom}/left/${uid}`, true);
  });

  watch(() => {
    const roomId = get(`match/${uid}`);
    if (!roomId) return;
    remove(`match/${uid}`);
    if (searching) {
      const { onMatched, stop } = searching;
      searching = null;
      stop();
      onMatched(roomId);
    } else {
      set(`rooms/${roomId}/left/${uid}`, true);
    }
  });
}

export function watchWaiting(callback) {
  let last = '';
  return watch(() => {
    const count = { m: 0, f: 0 };
    for (const [id, entry] of Object.entries(list('queue'))) {
      if (isAlive(id) && entry?.gender in count) count[entry.gender]++;
    }
    const key = JSON.stringify(count);
    if (key !== last) {
      last = key;
      callback(count);
    }
  });
}

function publicProfile(p) {
  return { nick: p.nick, age: p.age, gender: p.gender, answers: p.answers };
}

function removeIncoming() {
  for (const from of Object.keys(list(`requests/${uid}`))) remove(`requests/${uid}/${from}`);
}

function newRoomId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// store.firebase.js의 search와 같은 모양. 설명은 그쪽에 있다
export function search(profile, handlers) {
  const me = { uid, ...profile };
  let timer = null;
  let offs = [];
  let outgoing = null;
  const entry = { ...publicProfile(profile), blocked: profile.blocked || {}, history: profile.history || {} };

  const clearOutgoing = () => {
    if (!outgoing) return;
    const { path, off, timer: t } = outgoing;
    outgoing = null;
    off();
    clearTimeout(t);
    remove(path);
  };

  const stop = () => {
    offs.forEach(off => off());
    offs = [];
    clearInterval(timer);
    clearOutgoing();
    remove(`queue/${uid}`);
    removeIncoming();
  };
  const token = { onMatched: handlers.onMatched, stop };
  searching = token;

  set(`queue/${uid}`, { ...entry, at: Date.now() });
  const restart = () => set(`queue/${uid}`, { ...entry, at: Date.now() });

  const tryMatch = () => {
    if (searching !== token || outgoing) return;
    const queue = list('queue');
    if (!queue[uid] || queue[uid].busy) return;
    const partner = pickPartner(queue, me, CONFIG.autoMatchScore, isAlive);
    // 탭 둘이 동시에 서로를 데려가지 않게, uid가 작은 쪽만 방을 만든다 (Firebase는 트랜잭션이 막아 준다)
    if (!partner || partner.uid < uid) return;
    searching = null;
    stop();
    remove(`queue/${partner.uid}`);
    const roomId = newRoomId();
    set(`rooms/${roomId}/meta`, {
      a: uid,
      b: partner.uid,
      at: Date.now(),
      score: partner.score,
      mode: 'auto',
      profiles: {
        [uid]: publicProfile(me),
        [partner.uid]: publicProfile(partner.entry),
      },
    });
    set(`match/${partner.uid}`, roomId);
    setTimeout(() => handlers.onMatched(roomId));
  };

  offs.push(watch(() => {
    if (searching !== token) return;
    const queue = Object.fromEntries(Object.entries(list('queue')).filter(([id]) => isAlive(id) || id === uid));
    handlers.onQueue(queue);
    const incoming = Object.entries(list(`requests/${uid}`))
      .filter(([from]) => isAlive(from))
      .map(([from, req]) => ({ from, ...req }))
      .sort((x, y) => x.at - y.at);
    handlers.onIncoming(incoming);
    tryMatch();
  }));
  timer = setInterval(tryMatch, RETRY_MS);

  return {
    uid,
    now: () => Date.now(),
    startAt: () => get(`queue/${uid}`)?.at ?? Date.now(),

    stop() {
      if (searching !== token) return;
      searching = null;
      stop();
    },

    async request(to, score) {
      if (outgoing || searching !== token) return 'cancel';
      set(`queue/${uid}`, { ...get(`queue/${uid}`), busy: true });
      const path = `requests/${to}/${uid}`;
      set(path, { ...publicProfile(profile), score, at: Date.now() });
      return new Promise(resolve => {
        const finish = result => {
          if (outgoing?.path !== path) return;
          clearOutgoing();
          if (searching === token) {
            if (result === 'cancel') set(`queue/${uid}`, { ...get(`queue/${uid}`), busy: false });
            else restart();
          }
          resolve(result);
        };
        outgoing = {
          path,
          finish,
          off: watch(() => {
            if (!get(path)) setTimeout(() => finish('declined'), 1500);
          }),
          timer: setTimeout(() => finish('timeout'), CONFIG.requestSeconds * 1000),
        };
      });
    },

    cancelRequest() {
      outgoing?.finish('cancel');
    },

    async respond(from, accept) {
      const path = `requests/${uid}/${from}`;
      if (!accept) {
        remove(path);
        return;
      }
      const req = get(path);
      if (!req || searching !== token) throw new Error('신청이 취소됐어요.');
      clearOutgoing();
      const roomId = newRoomId();
      set(`rooms/${roomId}/meta`, {
        a: uid,
        b: from,
        at: Date.now(),
        score: req.score ?? 0,
        mode: 'request',
        profiles: {
          [uid]: publicProfile(me),
          [from]: publicProfile(req),
        },
      });
      set(`rooms/${roomId}/decide/${uid}`, 'accept');
      set(`rooms/${roomId}/decide/${from}`, 'accept');
      set(`match/${from}`, roomId);
      searching = null;
      stop();
      setTimeout(() => handlers.onMatched(roomId));
    },
  };
}

export async function openRoom(roomId, handlers) {
  const base = `rooms/${roomId}`;
  const room = get(`${base}/meta`);
  if (!room) {
    handlers.onPartnerLeft();
    return null;
  }
  currentRoom = roomId;
  const partnerUid = room.a === uid ? room.b : room.a;
  set(`${base}/joined/${uid}`, true);

  const seen = { [uid]: 0, [partnerUid]: 0 };
  const log = [];
  let partnerTyping = false;
  let partnerJoined = false;
  let partnerName = null;
  let decision = '';
  let ended = false;
  let closed = false;
  let joinTimer = null;

  const end = () => {
    if (ended) return;
    ended = true;
    clearTimeout(joinTimer);
    handlers.onPartnerLeft();
  };

  const off = watch(() => {
    if (!get(`${base}/meta`)) return end();
    const fresh = [];
    for (const who of [uid, partnerUid]) {
      const msgs = get(`${base}/msgs/${who}`) || [];
      for (; seen[who] < msgs.length; seen[who]++) fresh.push({ ...msgs[seen[who]], uid: who });
    }
    fresh.sort((x, y) => x.at - y.at);
    for (const msg of fresh) {
      log.push(msg);
      handlers.onMessage({ text: msg.text, at: msg.at, mine: msg.uid === uid });
    }
    const typing = !!get(`${base}/typing/${partnerUid}`);
    if (typing !== partnerTyping) handlers.onTyping(partnerTyping = typing);

    const dec = { mine: get(`${base}/decide/${uid}`), theirs: get(`${base}/decide/${partnerUid}`) };
    if (JSON.stringify(dec) !== decision) {
      decision = JSON.stringify(dec);
      handlers.onDecision(dec);
    }
    const name = get(`${base}/names/${partnerUid}`);
    if (name && name !== partnerName) handlers.onPartnerName(partnerName = name);

    if (get(`${base}/joined/${partnerUid}`)) partnerJoined = true;
    if (get(`${base}/left/${partnerUid}`) || (partnerJoined && !isAlive(partnerUid))) end();
  });
  joinTimer = setTimeout(() => { if (!partnerJoined) end(); }, PARTNER_JOIN_TIMEOUT);

  return {
    partnerUid,
    partner: room.profiles?.[partnerUid] || { nick: '익명', answers: {} },
    me: room.profiles?.[uid] || { answers: {} },
    score: room.score ?? 0,
    mode: room.mode || 'auto',

    async send(text) {
      const now = Date.now();
      if (now - (get(`rate/${uid}`) || 0) < 300) throw new Error('너무 빨리 보내고 있어요. 천천히 보내 주세요.');
      set(`rate/${uid}`, now);
      const mine = get(`${base}/msgs/${uid}`) || [];
      set(`${base}/msgs/${uid}`, [...mine, { text, at: now }]);
    },

    typing(on) {
      if (!closed) set(`${base}/typing/${uid}`, on);
    },

    async decide(choice) {
      set(`${base}/decide/${uid}`, choice);
    },

    async revealName(name) {
      if (get(`${base}/decide/${uid}`) === 'accept' && get(`${base}/decide/${partnerUid}`) === 'accept') {
        set(`${base}/names/${uid}`, name);
      }
    },

    async report(reason) {
      const report = {
        by: uid, target: partnerUid, room: roomId, reason, at: Date.now(),
        log: log.slice(-30).map(m => ({ from: m.uid === uid ? 'reporter' : 'target', text: m.text })),
      };
      set(`reports/${Date.now().toString(36)}`, report);
      console.info('[로컬 모드] 신고 저장됨', report);
    },

    async leave() {
      if (closed) return;
      closed = true;
      clearTimeout(joinTimer);
      off();
      currentRoom = null;
      // 둘 다 나갔거나 누가 넘겼으면 방을 지운다 = 대화 기록 삭제
      const passed = get(`${base}/decide/${uid}`) === 'pass' || get(`${base}/decide/${partnerUid}`) === 'pass';
      if (ended || passed || get(`${base}/left/${partnerUid}`)) removeTree(base);
      else set(`${base}/left/${uid}`, true);
    },
  };
}
