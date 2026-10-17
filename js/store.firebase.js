// Firebase 모드 저장소: Realtime Database로 실시간 매칭과 채팅을 한다.
// 모두 익명 로그인하고, 누가 무엇을 읽고 쓸 수 있는지는 database.rules.json이 서버에서 막는다.
//
// 데이터 구조
//   queue/{uid}            짝을 기다리는 사람 (닉네임, 나이, 성별, 설문 답, at=이번 10분 시작, busy=신청 보내는 중)
//   requests/{받는}/{보낸}  매칭 신청
//   match/{uid}            짝이 정해지면 상대가 여기에 방 id를 넣어 준다
//   rooms/{id}             a, b, at, score, mode(auto|request), profiles, decide, names, photos, msgs, typing, joined, left
//   rate/{uid}             마지막으로 보낸 시각 (도배 방지)
//   reports/{id}           신고 (매니저 페이지에서 본다)
//   couples/{방}/{uid}      성사된 커플 기록 (매니저만 읽는다)
//   admins/{uid}, adminKey  매니저 비밀번호. adminKey는 콘솔에서만 넣는다
//   private/{uid}          대기 중인 사람의 실명·프로필 사진. 매니저만 읽고, 대기열에서 나가면 지운다
// 실명과 프로필 사진은 둘 다 승낙한 뒤에야 rooms/{id}/names, photos에 올라간다. 그 전에는 내 기기에만 있다.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onChildAdded,
  onDisconnect, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { CONFIG } from './config.js';
import { pickPartner } from './common.js';

export const mode = 'firebase';

const app = initializeApp(CONFIG.firebase);
const auth = getAuth(app);
const db = getDatabase(app);

const RETRY_MS = 3000;

let uid = null;
let serverOffset = 0;
let searching = null;   // 지금 짝을 찾는 중이면 { onMatched, stop }
let pendingMatch = null; // 자리를 비운 사이 잡힌 매칭. 다시 찾기를 시작하면 바로 그 방으로 간다

const serverNow = () => Date.now() + serverOffset;

function isDenied(err) {
  return /permission/i.test(err?.code || '') || /permission/i.test(err?.message || '');
}

function publicProfile(p) {
  return { nick: p.nick, age: p.age, gender: p.gender, answers: p.answers };
}

export async function init() {
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
  startSession();
  return { uid };
}

function startSession() {
  // 누가 나와 방을 만들면 match/{나}에 방 id가 들어온다
  onValue(ref(db, `match/${uid}`), snap => {
    const roomId = snap.val();
    if (!roomId) return;
    remove(snap.ref);
    if (searching) {
      const { onMatched, stop } = searching;
      searching = null;
      stop();
      onMatched(roomId);
    } else {
      // 사이트를 닫아 둔 사이 잡혔다: 다시 찾기를 시작하면 그 방으로 보낸다
      pendingMatch = roomId;
    }
  });
}

// 지금 기다리는 사람 수 (남/여)
export function watchWaiting(callback) {
  return onValue(ref(db, 'queue'), snap => {
    const count = { m: 0, f: 0 };
    snap.forEach(child => { const g = child.child('gender').val(); if (g in count) count[g]++; });
    callback(count);
  }, () => callback({ m: 0, f: 0 }));
}

function requestList(value) {
  return Object.entries(value || {})
    .map(([from, req]) => ({ from, ...req }))
    .sort((x, y) => (x.at ?? 0) - (y.at ?? 0));
}

// 짝 찾기를 시작한다. 돌려주는 controller로 신청·응답을 한다.
// handlers: onQueue(queue), onIncoming(requests), onMatched(roomId), onError(err)
//
// 궁합 autoMatchScore 이상인 사람이 있으면 대기열 전체를 트랜잭션으로 잡고 둘 다 빼낸다.
// 내가 이미 빠져 있거나(누가 데려감) 신청 중이면 그만둔다. 그래서 한 사람이 두 방에 들어가는 일이 없다.
export function search(profile, handlers) {
  const me = { uid, ...profile };
  const queueMeRef = ref(db, `queue/${uid}`);
  const incomingRef = ref(db, `requests/${uid}`);
  const privateRef = ref(db, `private/${uid}`);
  let queue = {};
  let offs = [];
  let timer = null;
  let busy = false;
  let outgoing = null;   // { ref, off, timer, finish }
  let localStart = serverNow();

  const clearOutgoing = () => {
    if (!outgoing) return;
    const { ref: reqRef, off, timer: t } = outgoing;
    outgoing = null;
    off();
    clearTimeout(t);
    remove(reqRef).catch(() => {});
    onDisconnect(reqRef).cancel();
  };

  // 대기열에서 빠진다. 매칭돼서 빠질 때는 실명·번호(private)를 남겨 둔다 (운영진이 문자할 때 쓴다)
  const stop = ({ forget = false } = {}) => {
    offs.forEach(off => off());
    offs = [];
    clearInterval(timer);
    clearOutgoing();
    remove(queueMeRef).catch(() => {});
    remove(incomingRef).catch(() => {});   // 받은 신청은 모두 거절로 처리된다
    if (forget) remove(privateRef).catch(() => {});
    onDisconnect(queueMeRef).cancel();
    onDisconnect(incomingRef).cancel();
  };

  const token = { onMatched: handlers.onMatched, stop };
  searching = token;

  const tryMatch = async () => {
    if (busy || searching !== token || outgoing || !queue[uid] || queue[uid].busy) return;
    if (!pickPartner(queue, me, CONFIG.autoMatchScore)) return;
    busy = true;
    try {
      let picked = null;
      const result = await runTransaction(ref(db, 'queue'), q => {
        picked = null;
        if (!q || !q[uid] || q[uid].busy || searching !== token || outgoing) return undefined;
        const partner = pickPartner(q, me, CONFIG.autoMatchScore);
        if (!partner) return undefined;
        picked = partner;
        delete q[partner.uid];
        delete q[uid];
        return q;
      });
      if (!result.committed || !picked) return;

      if (searching !== token) {
        // 데려오는 사이에 그만뒀다: 데려온 사람을 대기열에 되돌려 놓는다
        await set(ref(db, `queue/${picked.uid}`), picked.entry);
        return;
      }
      searching = null;
      stop();

      const roomRef = push(ref(db, 'rooms'));
      await set(roomRef, {
        a: uid,
        b: picked.uid,
        at: serverTimestamp(),
        score: picked.score,
        mode: 'auto',
        profiles: {
          [uid]: publicProfile(me),
          [picked.uid]: publicProfile(picked.entry),
        },
      });
      await set(ref(db, `match/${picked.uid}`), roomRef.key);
      handlers.onMatched(roomRef.key);
    } finally {
      busy = false;
    }
  };

  function fail(err) {
    console.error(err);
    if (searching !== token) return;
    searching = null;
    stop();
    handlers.onError?.(new Error('연결이 불안정해요. 잠시 후 다시 시도해 주세요.'));
  }

  // 새로 10분을 시작한다 (거절당했을 때, 응답이 없을 때)
  const restart = () => {
    localStart = serverNow();
    return update(queueMeRef, { at: serverTimestamp(), busy: null });
  };

  (async () => {
    // 자리를 비운 사이 이미 짝이 정해졌으면 그 방으로 바로 간다
    if (pendingMatch) {
      const roomId = pendingMatch;
      pendingMatch = null;
      searching = null;
      setTimeout(() => handlers.onMatched(roomId));
      return;
    }
    // 사이트를 닫아도 아무것도 바뀌지 않는다. 대기열 자리·보낸 신청·받은 신청이 그대로 남고,
    // 켜 둔 사람과 똑같이 매칭된다. 대기열에서 빠지는 건 "매칭 그만두기"를 눌렀을 때뿐이다
    const before = (await get(queueMeRef).catch(() => null))?.val();
    if (before?.kicked) {
      searching = null;
      stop({ forget: true });
      handlers.onKicked?.();
      return;
    }
    await set(privateRef, {
      name: profile.name || '',
      phone: profile.phone || '',
      ...(typeof profile.photo === 'string' && profile.photo.startsWith('data:image/') ? { photo: profile.photo } : {}),
    }).catch(err => console.warn('매니저용 정보 저장 실패', err));
    await set(queueMeRef, {
      ...publicProfile(me),
      blocked: profile.blocked || {},
      history: profile.history || {},
      at: before?.at ?? serverTimestamp(),   // 나갔다 와도 10분은 이어서 흐른다
      ...(before?.busy ? { busy: true } : {}),   // 보내 둔 신청도 그대로
    });
    if (searching !== token) {
      remove(queueMeRef);
      return;
    }
    offs.push(onValue(ref(db, 'queue'), snap => {
      queue = snap.val() || {};
      const mine = queue[uid];
      // 매니저가 대기열에서 내보냈다
      if (mine?.kicked) {
        searching = null;
        stop({ forget: true });
        handlers.onKicked?.();
        return;
      }
      // 매니저가 닉네임·나이·성별을 고쳤다
      if (mine && (mine.nick !== me.nick || mine.age !== me.age || mine.gender !== me.gender)) {
        me.nick = mine.nick;
        me.age = mine.age;
        me.gender = mine.gender;
        handlers.onSelfEdited?.({ nick: me.nick, age: me.age, gender: me.gender });
      }
      handlers.onQueue(queue);
      tryMatch().catch(fail);
    }));
    offs.push(onValue(incomingRef, snap => handlers.onIncoming(requestList(snap.val()))));
    timer = setInterval(() => tryMatch().catch(fail), RETRY_MS + Math.random() * 1000);
  })().catch(fail);

  return {
    uid,
    now: serverNow,
    // 이번 10분이 시작된 시각 (서버 시간)
    startAt: () => queue[uid]?.at ?? localStart,

    // 사용자가 "그만 찾기"를 눌렀다
    stop() {
      if (searching !== token) return;
      searching = null;
      stop({ forget: true });
    },

    // 후보에게 신청한다. 'declined' | 'timeout' | 'cancel' 로 끝난다. 수락되면 onMatched가 불린다
    // 후보에게 신청한다. 응답 기한(서버 시각)을 돌려준다. 결과는 watchRequest로 기다린다
    async request(to, score) {
      if (outgoing || searching !== token) return null;
      await update(queueMeRef, { busy: true });
      await set(ref(db, `requests/${to}/${uid}`), { ...publicProfile(me), score, at: serverTimestamp() });
      return serverNow() + CONFIG.requestSeconds * 1000;
    },

    // 보낸 신청의 결과를 기다린다: 'declined' | 'timeout' | 'cancel'. 수락되면 onMatched가 불린다.
    // 사이트를 닫았다 다시 들어와도 같은 신청을 이어서 기다린다
    async watchRequest(to, deadline) {
      if (outgoing || searching !== token) return 'cancel';
      const reqRef = ref(db, `requests/${to}/${uid}`);
      const exists = (await get(reqRef).catch(() => null))?.exists();
      if (searching !== token) return 'cancel';
      if (!exists) {
        // 나가 있는 사이 거절됐다 (수락이었다면 방으로 먼저 갔다)
        await restart();
        return 'declined';
      }
      await update(queueMeRef, { busy: true });

      return new Promise(resolve => {
        let seen = false;
        const finish = async result => {
          if (outgoing?.ref !== reqRef) return;   // 그사이 매칭됐다
          clearOutgoing();
          if (searching === token) {
            if (result === 'cancel') await update(queueMeRef, { busy: null });
            else await restart();
          }
          resolve(result);
        };
        outgoing = {
          ref: reqRef,
          finish,
          off: onValue(reqRef, snap => {
            if (snap.exists()) {
              seen = true;
              return;
            }
            // 신청이 지워졌다 = 거절. 수락이면 match가 먼저 와서 outgoing이 이미 비어 있다
            if (seen) setTimeout(() => finish('declined'), 1500);
          }),
          timer: setTimeout(() => finish('timeout'), Math.max(0, deadline - serverNow())),
        };
      });
    },

    cancelRequest() {
      outgoing?.finish('cancel');
    },

    // 받은 신청에 답한다. 수락하면 방을 만들고 바로 성사
    async respond(from, accept) {
      const reqRef = ref(db, `requests/${uid}/${from}`);
      if (!accept) {
        await remove(reqRef);
        return;
      }
      const req = (await get(reqRef)).val();
      if (!req || searching !== token) throw new Error('신청이 취소됐어요.');
      clearOutgoing();
      const roomRef = push(ref(db, 'rooms'));
      await set(roomRef, {
        a: uid,
        b: from,
        at: serverTimestamp(),
        score: req.score ?? 0,
        mode: 'request',
        profiles: {
          [uid]: publicProfile(me),
          [from]: publicProfile(req),
        },
        decide: { [uid]: 'accept', [from]: 'accept' },
      });
      await set(ref(db, `match/${from}`), roomRef.key);
      searching = null;
      stop();
      handlers.onMatched(roomRef.key);
    },
  };
}

// 방에 들어간다.
// handlers: onMessage(msg), onTyping(bool), onPartnerLeft(), onDecision({ mine, theirs }),
//           onPartnerName(name), onPartnerPhoto(dataUrl)
export async function openRoom(roomId, handlers) {
  const base = `rooms/${roomId}`;
  const room = (await get(ref(db, base))).val();
  if (!room) {
    handlers.onPartnerLeft();
    return null;
  }
  const partnerUid = room.a === uid ? room.b : room.a;
  const leftRef = ref(db, `${base}/left/${uid}`);
  await set(ref(db, `${base}/joined/${uid}`), true);

  const log = [];
  const offs = [];
  let closed = false;
  let ended = false;
  let passed = false;

  const end = () => {
    if (ended) return;
    ended = true;
    handlers.onPartnerLeft();
  };

  offs.push(onChildAdded(ref(db, `${base}/msgs`), snap => {
    const msg = snap.val();
    log.push(msg);
    handlers.onMessage({ text: msg.text, at: msg.at, mine: msg.uid === uid });
  }));
  offs.push(onValue(ref(db, `${base}/typing/${partnerUid}`), snap => handlers.onTyping(!!snap.val())));
  offs.push(onValue(ref(db, `${base}/decide`), snap => {
    const v = snap.val() || {};
    if (v[uid] === 'pass' || v[partnerUid] === 'pass') passed = true;
    handlers.onDecision({ mine: v[uid] || null, theirs: v[partnerUid] || null });
  }));
  offs.push(onValue(ref(db, `${base}/names/${partnerUid}`), snap => {
    if (snap.val()) handlers.onPartnerName(snap.val());
  }));
  offs.push(onValue(ref(db, `${base}/photos/${partnerUid}`), snap => {
    if (snap.val()) handlers.onPartnerPhoto(snap.val());
  }));
  // 상대가 나갔거나 방이 지워졌다(읽을 수 없게 됨)
  offs.push(onValue(ref(db, `${base}/left/${partnerUid}`), snap => {
    if (snap.val()) end();
  }, () => end()));

  return {
    partnerUid,
    partner: room.profiles?.[partnerUid] || { nick: '익명', answers: {} },
    me: room.profiles?.[uid] || { answers: {} },
    score: room.score ?? 0,
    mode: room.mode || 'auto',
    startAt: room.at,
    now: serverNow,

    async send(text) {
      const id = push(ref(db, `${base}/msgs`)).key;
      try {
        await update(ref(db), {
          [`${base}/msgs/${id}`]: { uid, text, at: serverTimestamp() },
          [`rate/${uid}`]: serverTimestamp(),
        });
      } catch (err) {
        if (isDenied(err)) throw new Error('너무 빨리 보내고 있어요. 천천히 보내 주세요.');
        throw new Error('메시지를 보내지 못했어요.');
      }
    },

    typing(on) {
      if (!closed) set(ref(db, `${base}/typing/${uid}`), on).catch(() => {});
    },

    async decide(choice) {
      await set(ref(db, `${base}/decide/${uid}`), choice);
    },

    async revealName(name) {
      await set(ref(db, `${base}/names/${uid}`), name);
    },

    async revealPhoto(photo) {
      await set(ref(db, `${base}/photos/${uid}`), photo);
    },

    // 성사 기록 (매니저 페이지에서 본다). 대화방이 지워져도 남는다
    async recordCouple(info) {
      await set(ref(db, `couples/${roomId}/${uid}`), { ...info, score: room.score ?? 0, at: serverTimestamp() });
    },

    async report(reason) {
      await push(ref(db, 'reports'), {
        by: uid,
        target: partnerUid,
        room: roomId,
        reason,
        at: serverTimestamp(),
        log: log.slice(-30).map(m => ({ from: m.uid === uid ? 'reporter' : 'target', text: m.text })),
      });
    },

    async leave() {
      if (closed) return;
      closed = true;
      offs.forEach(off => off());
      await set(leftRef, true).catch(() => {});
      // 둘 다 나갔거나 누가 넘겼으면 방을 지운다 = 대화 기록 삭제
      const partnerLeft = ended || passed || (await get(ref(db, `${base}/left/${partnerUid}`)).catch(() => null))?.val();
      if (partnerLeft) await remove(ref(db, base)).catch(() => {});
    },
  };
}
