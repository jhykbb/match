// 저장소(로컬/Firebase)와 화면이 같이 쓰는 함수들
import { CONFIG } from './config.js';

const ANY = CONFIG.anyLabel;

// 설문 화면 순서. same 문항을 차례로 깔고, pair 문항의 "좋아하는"/"나는" 두 장은
// prefStep/selfStep 번째 자리에 끼워 넣는다
export function surveySteps() {
  const steps = [];
  const placed = [];
  for (const q of CONFIG.questions) {
    if (q.type === 'pair') {
      placed.push({ at: q.prefStep, step: { key: `${q.id}_pref`, group: q.group, title: q.pref, options: [...q.options, ANY] } });
      placed.push({ at: q.selfStep, step: { key: q.id, group: q.group, title: q.self, options: q.options } });
    } else {
      steps.push({ key: q.id, group: q.group, title: q.q, options: q.options });
    }
  }
  placed.sort((x, y) => (x.at ?? Infinity) - (y.at ?? Infinity));
  for (const { at, step } of placed) {
    if (at) steps.splice(Math.min(at - 1, steps.length), 0, step);
    else steps.push(step);
  }
  return steps;
}

export function surveyComplete(answers) {
  return !!answers && surveySteps().every(step => step.options.includes(answers[step.key]));
}

// 궁합 점수 0~100. 누가 먼저든 같은 값이 나온다
export function compatibility(a = {}, b = {}) {
  let score = 0;
  let max = 0;
  for (const q of CONFIG.questions) {
    if (q.type === 'pair') {
      for (const [x, y] of [[a, b], [b, a]]) {
        max += 1;
        const pref = x[`${q.id}_pref`];
        if (pref === y[q.id]) score += 1;
        else if (pref === ANY) score += 0.6;
      }
    } else {
      max += 1;
      if (a[q.id] === b[q.id]) score += 1;
    }
  }
  return max ? Math.round((score / max) * 100) : 0;
}

// 내 쪽에서 본 "잘 맞는 점" 목록
export function matchReasons(mine = {}, theirs = {}) {
  const out = [];
  for (const q of CONFIG.questions) {
    if (q.type === 'pair') {
      if (mine[`${q.id}_pref`] === theirs[q.id]) out.push(`내가 좋아하는 ${theirs[q.id]}`);
      if (theirs[`${q.id}_pref`] === mine[q.id]) out.push(`상대가 좋아하는 ${mine[q.id]}이 바로 나`);
    } else if (mine[q.id] && mine[q.id] === theirs[q.id]) {
      out.push(`둘 다 ${mine[q.id]}`);
    }
  }
  return out;
}

// 둘이 이어질 수 있는지: 이성, 나이 규칙, 차단, 이미 만난 사람
export function canMatch(me, other) {
  if (!me.gender || !other.gender || me.gender === other.gender) return false;
  const meMinor = me.age < CONFIG.adultAge;
  const otherMinor = other.age < CONFIG.adultAge;
  if (meMinor !== otherMinor) return false;
  if (!meMinor && Math.abs(me.age - other.age) > CONFIG.adultMaxAgeGap) return false;
  if (me.blocked?.[other.uid] || other.blocked?.[me.uid]) return false;
  if (me.history?.[other.uid] || other.history?.[me.uid]) return false;
  return true;
}

// 이어 줄 수 있는 후보들을 궁합 높은 순으로. 신청 중인 사람(busy)은 뺀다
export function rankCandidates(queue, me, isAlive = () => true) {
  const list = [];
  for (const [uid, entry] of Object.entries(queue || {})) {
    if (uid === me.uid || !entry || entry.busy || !isAlive(uid)) continue;
    if (!canMatch(me, { ...entry, uid })) continue;
    list.push({ uid, entry, score: compatibility(me.answers, entry.answers) });
  }
  return list.sort((x, y) => y.score - x.score || (x.entry.at ?? 0) - (y.entry.at ?? 0));
}

// 바로 이어 줄 상대: 궁합이 minScore 이상인 사람 중 가장 높은 사람 (같으면 오래 기다린 사람)
export function pickPartner(queue, me, minScore, isAlive) {
  const best = rankCandidates(queue, me, isAlive)[0];
  return best && best.score >= minScore ? best : null;
}

// 금지어를 ***로 가린다. "시 발", "시.발" 처럼 사이에 끼운 공백·기호·숫자도 같이 잡는다
const GAP = '[\\s.,_\\-~!?*^·ㆍ0-9]*';
const bannedPattern = new RegExp(
  CONFIG.bannedWords
    .map(word => [...word].map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(GAP))
    .join('|'),
  'gi',
);

export function maskBadWords(text) {
  return text.replace(bannedPattern, match => '*'.repeat([...match.replace(/\s/g, '')].length));
}

export function hasBadWords(text) {
  bannedPattern.lastIndex = 0;
  const found = bannedPattern.test(text);
  bannedPattern.lastIndex = 0;
  return found;
}
