// 화면 흐름: 처음 화면 → 기본 정보 → 설문 → 짝 찾기
//   짝 찾기 5분 안에 궁합 80% 이상인 사람이 오면 자동으로 이어지고, 서로 승낙/넘기기를 고른다
//     둘 다 승낙: 이름 공개 + 대화 시작 / 한 명이라도 넘기기: 다시 5분 찾기
//   5분이 지나도 없으면 궁합 높은 3명을 보여 주고 한 명에게 신청한다
//     상대가 수락: 바로 성사 (이름 공개 + 대화) / 거절·무응답: 다시 5분 찾기
//   한 번 만난 사람, 거절한 사람은 다시 나오지 않는다
import { CONFIG } from './config.js';
import {
  surveySteps, surveyComplete, matchReasons, rankCandidates, maskBadWords, hasBadWords,
} from './common.js';
import * as store from './store.js';

const $ = id => document.getElementById(id);
const PROFILE_KEY = 'match-profile';
const ANSWERS_KEY = 'match-answers';
const BLOCKED_KEY = 'match-blocked';
const HISTORY_KEY = 'match-history';
const MIN_SEND_GAP = 400;
const SEARCH_MS = CONFIG.searchMinutes * 60000;
const RESULT_REASONS = 8;
const STEPS = surveySteps();
// 로컬 모드는 탭 하나가 한 사람이라 탭마다 따로 저장한다
const storage = store.mode === 'local' ? sessionStorage : localStorage;

const state = {
  profile: loadJson(PROFILE_KEY, null),
  answers: loadJson(ANSWERS_KEY, {}),
  blocked: loadJson(BLOCKED_KEY, {}),
  history: loadJson(HISTORY_KEY, {}),   // 이미 만난 사람·거절한 사람. 다시 이어지지 않는다
  step: 0,

  search: null,      // store.search가 돌려준 controller
  queue: {},         // 지금 기다리는 사람들
  incoming: [],      // 나에게 온 신청들
  shownIncoming: null,
  pending: null,     // 내가 보낸 신청 { nick, until }
  candKey: '',
  waitTimer: null,

  room: null,        // store.openRoom이 돌려준 핸들
  lastRoom: null,    // 대화가 끝난 뒤에도 신고할 수 있게 남겨 둔다
  decision: null,
  phase: 'over',     // propose(승낙/넘기기 고르는 중) → accepted(성사, 대화) / over(끝)
  proposeTimer: null,
  lastSentAt: 0,
};

function loadJson(key, fallback) {
  try {
    return JSON.parse(storage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {}
}

function show(name) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== `screen-${name}`;
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function profileValid(p) {
  return !!p && !!p.nick && !!p.name && Number.isInteger(p.age) && (p.gender === 'm' || p.gender === 'f');
}

function fmt(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// ---------- 처음 화면 ----------

function showIntro() {
  const ready = profileValid(state.profile) && surveyComplete(state.answers);
  $('start-btn').hidden = ready;
  $('resume-btn').hidden = !ready;
  $('redo-btn').hidden = !ready;
  show('intro');
}

$('start-btn').addEventListener('click', showProfile);
$('redo-btn').addEventListener('click', showProfile);
$('resume-btn').addEventListener('click', startSearch);

// ---------- 기본 정보 ----------

function showProfile() {
  const p = state.profile || {};
  $('nick-input').value = p.nick || '';
  $('name-input').value = p.name || '';
  $('age-input').value = p.age || '';
  for (const radio of document.querySelectorAll('input[name="gender"]')) radio.checked = radio.value === p.gender;
  show('profile');
}

$('nick-input').maxLength = CONFIG.nickMaxLength;
$('name-input').maxLength = CONFIG.nameMaxLength;
$('age-input').min = CONFIG.minAge;
$('age-input').max = CONFIG.maxAge;

$('profile-form').addEventListener('submit', e => {
  e.preventDefault();
  const nick = $('nick-input').value.trim().slice(0, CONFIG.nickMaxLength);
  const name = $('name-input').value.trim().slice(0, CONFIG.nameMaxLength);
  const age = Number($('age-input').value);
  const gender = new FormData(e.target).get('gender');
  if (!nick) return toast('닉네임을 적어 주세요.');
  if (hasBadWords(nick)) return toast('닉네임에 쓸 수 없는 말이 있어요.');
  if (!name) return toast('이름을 적어 주세요.');
  if (!Number.isInteger(age) || age < CONFIG.minAge || age > CONFIG.maxAge) return toast('나이를 확인해 주세요.');
  if (!gender) return toast('성별을 골라 주세요.');
  state.profile = { nick, name, age, gender };
  saveJson(PROFILE_KEY, state.profile);
  state.step = 0;
  showStep();
});

// ---------- 설문 ----------

function showStep() {
  const step = STEPS[state.step];
  $('survey-bar').style.width = `${(state.step / STEPS.length) * 100}%`;
  $('survey-count').textContent = `${state.step + 1} / ${STEPS.length}` + (step.group ? ` · ${step.group}` : '');
  $('survey-title').textContent = step.title;
  $('survey-options').replaceChildren(...step.options.map(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option'
      + (state.answers[step.key] === option ? ' on' : '')
      + (option === CONFIG.anyLabel ? ' any' : '');
    button.textContent = option;
    button.addEventListener('click', () => choose(option));
    return button;
  }));
  show('survey');
}

function choose(option) {
  const step = STEPS[state.step];
  state.answers = { ...state.answers, [step.key]: option };
  saveJson(ANSWERS_KEY, state.answers);
  if (state.step < STEPS.length - 1) {
    state.step++;
    showStep();
  } else {
    $('survey-bar').style.width = '100%';
    startSearch();
  }
}

$('survey-back').addEventListener('click', () => {
  if (state.step === 0) return showProfile();
  state.step--;
  showStep();
});

// ---------- 짝 찾기 ----------

function myProfile(uid) {
  const { nick, age, gender } = state.profile;
  return { uid, nick, age, gender, answers: state.answers, blocked: state.blocked, history: state.history };
}

function startSearch() {
  if (!profileValid(state.profile) || !surveyComplete(state.answers)) return showIntro();
  stopSearch();
  state.queue = {};
  state.candKey = '';
  show('wait');
  state.search = store.search(myProfile(), {
    onQueue: queue => {
      state.queue = queue;
      renderWait();
    },
    onIncoming: list => {
      state.incoming = list;
      renderIncoming();
    },
    onMatched: roomId => {
      endSearchUi();
      enterRoom(roomId);
    },
    onError: err => {
      endSearchUi();
      toast(err.message);
      showIntro();
    },
  });
  state.waitTimer = setInterval(renderWait, 500);
  renderWait();
}

function endSearchUi() {
  clearInterval(state.waitTimer);
  state.search = null;
  state.pending = null;
  state.incoming = [];
  renderIncoming();
}

function stopSearch() {
  state.search?.stop();
  endSearchUi();
}

$('cancel-search').addEventListener('click', () => {
  stopSearch();
  showIntro();
});

function showWaitPart(name) {
  for (const part of ['search', 'pick', 'pending']) $(`wait-${part}`).hidden = part !== name;
}

function renderWait() {
  const ctl = state.search;
  if (!ctl) return;
  updateIncomingCountdown();

  if (state.pending) {
    showWaitPart('pending');
    $('pending-nick').textContent = maskBadWords(state.pending.nick);
    $('pending-left').textContent = fmt(state.pending.until - Date.now());
    return;
  }
  const left = ctl.startAt() + SEARCH_MS - ctl.now();
  if (left > 0) {
    showWaitPart('search');
    $('wait-left').textContent = fmt(left);
    return;
  }
  showWaitPart('pick');
  const list = rankCandidates(state.queue, myProfile(ctl.uid)).slice(0, CONFIG.candidateCount);
  const key = list.map(c => `${c.uid}:${c.score}`).join(',');
  if (key === state.candKey) return;
  state.candKey = key;
  $('cand-empty').hidden = list.length > 0;
  $('cand-list').replaceChildren(...list.map((c, i) => candidateCard(c, i)));
}

function candidateCard(c, index) {
  const card = document.createElement('div');
  card.className = 'cand';
  const rank = document.createElement('span');
  rank.className = 'rank';
  rank.textContent = index + 1;
  const info = document.createElement('div');
  info.className = 'info';
  const nick = document.createElement('strong');
  nick.textContent = maskBadWords(c.entry.nick);
  const sub = document.createElement('span');
  const reason = matchReasons(state.answers, c.entry.answers)[0];
  sub.textContent = `${c.entry.age}살` + (reason ? ` · ${reason}` : '');
  info.append(nick, sub);
  const pct = document.createElement('span');
  pct.className = 'pct';
  pct.textContent = `${c.score}%`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn primary';
  button.textContent = '신청';
  button.addEventListener('click', () => requestTo(c));
  card.append(rank, info, pct, button);
  return card;
}

async function requestTo(c) {
  const ctl = state.search;
  if (!ctl || state.pending) return;
  state.pending = { nick: c.entry.nick, until: Date.now() + CONFIG.requestSeconds * 1000 };
  renderWait();
  let result;
  try {
    result = await ctl.request(c.uid, c.score);
  } catch (err) {
    console.error(err);
    result = 'error';
  }
  if (state.search !== ctl) return;   // 그사이 매칭됐다
  state.pending = null;
  state.candKey = '';
  if (result === 'declined' || result === 'timeout') {
    // 거절한 사람은 후보에 다시 안 나온다
    state.history = { ...state.history, [c.uid]: true };
    saveJson(HISTORY_KEY, state.history);
    toast(result === 'declined'
      ? `상대가 거절했어요. 다시 ${CONFIG.searchMinutes}분 동안 찾을게요.`
      : `응답이 없어요. 다시 ${CONFIG.searchMinutes}분 동안 찾을게요.`);
  } else if (result === 'error') {
    toast('신청하지 못했어요. 다시 시도해 주세요.');
  }
  renderWait();
}

$('cancel-request').addEventListener('click', () => state.search?.cancelRequest());

// ---------- 받은 신청 ----------

function renderIncoming() {
  const req = state.search ? state.incoming[0] : null;
  if (!req) {
    $('incoming').hidden = true;
    state.shownIncoming = null;
    return;
  }
  if (state.shownIncoming === req.from) return;
  state.shownIncoming = req.from;
  $('incoming-nick').textContent = maskBadWords(req.nick || '익명');
  $('incoming-age').textContent = req.age;
  $('incoming-score').textContent = req.score ?? 0;
  $('incoming-reasons').replaceChildren(...matchReasons(state.answers, req.answers || {}).slice(0, 5).map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  $('approve-btn').disabled = false;
  $('decline-btn').disabled = false;
  $('incoming').hidden = false;
  updateIncomingCountdown();
}

function updateIncomingCountdown() {
  const req = state.incoming[0];
  if (!req || $('incoming').hidden || !state.search) return;
  $('incoming-left').textContent = fmt((req.at ?? 0) + CONFIG.requestSeconds * 1000 - state.search.now());
}

async function answerIncoming(accept) {
  const ctl = state.search;
  const req = state.incoming[0];
  if (!ctl || !req) return;
  $('approve-btn').disabled = true;
  $('decline-btn').disabled = true;
  try {
    await ctl.respond(req.from, accept);
  } catch (err) {
    toast(err.message || '응답하지 못했어요.');
    state.shownIncoming = null;
    renderIncoming();
  }
}

$('approve-btn').addEventListener('click', () => answerIncoming(true));
$('decline-btn').addEventListener('click', () => answerIncoming(false));

// ---------- 매칭 · 대화 ----------

const messagesEl = $('messages');

function nearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
}

function append(el, forceScroll = false) {
  const stick = forceScroll || nearBottom();
  messagesEl.append(el);
  if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addSystem(text, big = false) {
  const el = document.createElement('div');
  el.className = 'system' + (big ? ' big' : '');
  el.textContent = text;
  append(el, true);
}

function addMessage({ text, mine }) {
  const el = document.createElement('div');
  el.className = 'msg ' + (mine ? 'mine' : 'theirs');
  el.textContent = mine ? text : maskBadWords(text);
  append(el, mine);
}

function resultCard(room) {
  const card = document.createElement('div');
  card.className = 'result';
  const score = document.createElement('div');
  score.className = 'score';
  score.append(String(room.score));
  const pct = document.createElement('small');
  pct.textContent = '%';
  score.append(pct);
  const who = document.createElement('p');
  who.className = 'who';
  who.textContent = room.mode === 'request'
    ? `${maskBadWords(room.partner.nick)}님과 매칭됐어요!`
    : `${maskBadWords(room.partner.nick)}님과 궁합이 잘 맞아요!`;
  // 잘 맞는 점이 많으면 몇 개만 보여 주고 나머지는 개수로
  const reasons = matchReasons(room.me.answers, room.partner.answers);
  const shown = reasons.slice(0, RESULT_REASONS);
  if (reasons.length > shown.length) shown.push(`+${reasons.length - shown.length}개 더 잘 맞아요`);
  const list = document.createElement('ul');
  list.append(...shown.map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  card.append(score, who, list);
  return card;
}

// 아래쪽에 무엇을 보여 줄지: decide(승낙/넘기기), chat(입력창), ended(다음 상대 찾기), none
function setFooter(which) {
  $('decide-bar').hidden = which !== 'decide';
  $('send-form').hidden = which !== 'chat';
  $('ended-bar').hidden = which !== 'ended';
  if (which !== 'chat') $('typing').hidden = true;
}

async function enterRoom(roomId) {
  state.lastRoom = null;
  state.decision = null;
  messagesEl.replaceChildren();
  $('partner-nick').textContent = '연결 중…';
  $('partner-sub').textContent = '';
  $('timer').hidden = true;
  setFooter('none');
  show('chat');
  state.phase = 'propose';

  let room = null;
  try {
    room = await store.openRoom(roomId, {
      onMessage: addMessage,
      onTyping: on => {
        if (state.phase !== 'accepted') return;
        const stick = nearBottom();
        $('typing').hidden = !on;
        if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
      },
      onPartnerLeft: () => {
        if (state.phase === 'over') return;
        if (state.phase === 'propose') {
          addSystem('상대가 나갔어요. 다시 찾을게요.');
          finishChat();
          searchAgainSoon();
        } else {
          addSystem('상대가 대화를 나갔어요.');
          finishChat();
        }
      },
      onDecision: decision => {
        state.decision = decision;
        applyDecision();
      },
      onPartnerName: name => {
        addSystem(`상대의 이름은 "${name}"이에요 💕`, true);
        $('partner-sub').textContent = `${name} · ${$('partner-sub').textContent}`;
      },
    });
  } catch (err) {
    console.error(err);
    toast('방에 들어가지 못했어요.');
  }
  if (!room) {
    if (state.phase !== 'over') {
      finishChat();
      searchAgainSoon();
    }
    return;
  }
  state.lastRoom = room;
  state.history = { ...state.history, [room.partnerUid]: true };
  saveJson(HISTORY_KEY, state.history);

  // 상대가 이미 나간 뒤에 핸들을 받았을 수도 있다
  if (state.phase === 'over') {
    await room.leave();
    return;
  }
  state.room = room;

  $('partner-nick').textContent = maskBadWords(room.partner.nick);
  $('partner-sub').textContent = `${room.partner.age}살 · 궁합 ${room.score}%`;
  messagesEl.prepend(resultCard(room));
  messagesEl.scrollTop = 0;

  if (room.mode === 'auto') {
    showDecideBar(false);
    startProposeTimer();
  }
  applyDecision();
}

function showDecideBar(waiting) {
  setFooter('decide');
  $('decide-text').textContent = waiting
    ? '승낙했어요! 상대의 선택을 기다리는 중…'
    : `궁합 ${CONFIG.autoMatchScore}% 이상인 상대를 찾았어요! 둘 다 승낙하면 대화가 시작돼요.`;
  $('accept-btn').hidden = waiting;
  $('pass-btn').textContent = waiting ? '넘기기로 바꾸기' : '넘기기';
  $('pass-btn').disabled = false;
  $('accept-btn').disabled = false;
}

// 정해진 시간 안에 고르지 않으면 넘기기로 처리한다
function startProposeTimer() {
  clearInterval(state.proposeTimer);
  const deadline = Date.now() + CONFIG.proposeSeconds * 1000;
  const el = $('timer');
  el.hidden = false;
  const tick = () => {
    if (state.phase !== 'propose') {
      clearInterval(state.proposeTimer);
      el.hidden = true;
      return;
    }
    const left = deadline - Date.now();
    el.textContent = fmt(left);
    el.className = 'timer' + (left <= 15000 ? ' low' : '');
    if (left <= 0 && !state.decision?.mine) decide('pass');
  };
  tick();
  state.proposeTimer = setInterval(tick, 500);
}

function applyDecision() {
  const { mine, theirs } = state.decision || {};
  if (!state.room || state.phase !== 'propose') return;
  if (mine === 'pass') {
    addSystem(`넘겼어요. 다시 ${CONFIG.searchMinutes}분 동안 찾을게요.`);
    finishChat();
    searchAgainSoon();
  } else if (theirs === 'pass') {
    addSystem(`아쉽게도 상대가 넘겼어요. 다시 ${CONFIG.searchMinutes}분 동안 찾을게요.`);
    finishChat();
    searchAgainSoon();
  } else if (mine === 'accept' && theirs === 'accept') {
    state.phase = 'accepted';
    clearInterval(state.proposeTimer);
    $('timer').hidden = true;
    setFooter('chat');
    addSystem('🎉 매칭 성사! 이제 대화해 보세요', true);
    state.room.revealName(state.profile.name).catch(err => console.error(err));
    $('msg-input').focus();
  } else if (mine === 'accept') {
    showDecideBar(true);
  }
}

async function decide(choice) {
  if (!state.room) return;
  $('pass-btn').disabled = true;
  $('accept-btn').disabled = true;
  try {
    await state.room.decide(choice);
  } catch (err) {
    console.error(err);
    toast('선택을 보내지 못했어요.');
    $('pass-btn').disabled = false;
    $('accept-btn').disabled = false;
  }
}

$('accept-btn').addEventListener('click', () => decide('accept'));
$('pass-btn').addEventListener('click', () => decide('pass'));

function searchAgainSoon() {
  setTimeout(() => {
    if (state.phase === 'over' && !$('screen-chat').hidden) startSearch();
  }, 1800);
}

// 대화가 끝났을 때 (넘기기, 나가기, 상대가 나감)
function finishChat() {
  state.phase = 'over';
  clearInterval(state.proposeTimer);
  $('timer').hidden = true;
  stopTyping();
  setFooter('ended');
  if (state.room) {
    const room = state.room;
    state.room = null;
    room.leave().catch(err => console.error(err));
  }
}

let typingOn = false;
let typingTimer = null;

function stopTyping() {
  clearTimeout(typingTimer);
  if (typingOn) {
    typingOn = false;
    state.room?.typing(false);
  }
}

$('msg-input').maxLength = CONFIG.maxMessageLength;
$('msg-input').addEventListener('input', () => {
  if (!state.room || state.phase !== 'accepted') return;
  if (!$('msg-input').value) return stopTyping();
  if (!typingOn) {
    typingOn = true;
    state.room.typing(true);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 2500);
});

$('send-form').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('msg-input');
  const text = input.value.trim().slice(0, CONFIG.maxMessageLength);
  if (!text || !state.room || state.phase !== 'accepted') return;
  const now = Date.now();
  if (now - state.lastSentAt < MIN_SEND_GAP) return toast('천천히 보내 주세요.');
  state.lastSentAt = now;
  input.value = '';
  stopTyping();
  try {
    await state.room.send(text);
  } catch (err) {
    toast(err.message);
    if (!input.value) input.value = text;
  }
  input.focus();
});

$('leave-btn').addEventListener('click', () => {
  if (state.phase === 'over') return showIntro();
  $('dlg-leave').returnValue = '';
  $('dlg-leave').showModal();
});

$('dlg-leave').addEventListener('close', () => {
  if ($('dlg-leave').returnValue !== 'leave' || state.phase === 'over') return;
  addSystem('대화를 끝냈어요.');
  finishChat();
});

$('report-btn').addEventListener('click', () => {
  if (!state.lastRoom) return;
  $('dlg-report').returnValue = '';
  $('dlg-report').showModal();
});

$('dlg-report').addEventListener('close', async () => {
  const action = $('dlg-report').returnValue;
  if (action !== 'report' && action !== 'block') return;
  const room = state.lastRoom;
  if (!room) return;
  if (action === 'report') {
    const reason = new FormData($('dlg-report').querySelector('form')).get('reason') || '기타';
    try {
      await room.report(reason);
    } catch (err) {
      console.error(err);
      toast('신고를 보내지 못했어요. 차단은 됐어요.');
    }
  }
  state.blocked = { ...state.blocked, [room.partnerUid]: true };
  saveJson(BLOCKED_KEY, state.blocked);
  if (state.phase !== 'over') {
    addSystem(action === 'report' ? '신고하고 차단했어요.' : '차단했어요.');
    finishChat();
  }
  toast('이 사람과는 다시 이어지지 않아요.');
});

$('next-btn').addEventListener('click', startSearch);
$('home-btn').addEventListener('click', showIntro);

// ---------- 입장 ----------

function afterEnter() {
  store.watchWaiting(({ m, f }) => {
    $('wait-m').textContent = m;
    $('wait-f').textContent = f;
  });
  showIntro();
}

async function main() {
  document.title = CONFIG.siteTitle || '💘';
  const fill = (attr, value) => {
    for (const el of document.querySelectorAll(`[${attr}]`)) el.textContent = value;
  };
  fill('data-title', CONFIG.siteTitle);
  for (const el of document.querySelectorAll('[data-title]')) el.hidden = !CONFIG.siteTitle;
  fill('data-subtitle', CONFIG.subtitle);
  fill('data-minutes', CONFIG.searchMinutes);
  fill('data-score', CONFIG.autoMatchScore);
  fill('data-count', CONFIG.candidateCount);

  try {
    await store.init();
    afterEnter();
  } catch (err) {
    console.error(err);
    $('screen-loading').querySelector('p').textContent = '연결하지 못했어요. 새로고침해 주세요.';
  }
}

main();
