// 매칭 알림. 휴대폰 알람처럼 눈치채게 만든다.
//   - "띠리리리링" 소리를 확인할 때까지(최대 1분) 반복, 진동도 반복 (진동은 안드로이드만)
//   - 화면 전체를 덮는 깜빡이는 알림 + [확인하기] 버튼
//   - 화면을 안 보고 있으면 탭 제목 깜빡임 + 시스템 알림(지울 때까지 남는다)
//   - 기다리는 동안 화면이 꺼지지 않게 잡아 둔다 (꺼지면 브라우저가 잠들어 알람을 못 울린다)
// 시스템 알림은 안드로이드·PC 크롬/엣지 등에서 된다. 아이폰 사파리는 홈 화면에 추가한 경우에만 된다.
// 무음 모드에서는 소리가 안 나고, 소리 크기는 폰 볼륨을 따른다.
// 브라우저는 사용자가 버튼을 누르지 않으면 소리·알림 권한을 막으니, 버튼을 누를 때 primeNotifications를 부른다.
const ALARM_MS = 60000;
const RING_EVERY_MS = 1600;
const VIBRATE = [600, 250, 600, 250, 600];

let audio = null;
let flashTimer = null;
let baseTitle = null;
let ringTimer = null;
let ringStop = null;
let overlay = null;
let wakeLock = null;
let wantAwake = false;

export function setupNotifications() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      stopFlash();
      if (wantAwake) requestWakeLock();   // 화면을 다시 켜면 잠금이 풀려 있으니 다시 잡는다
    }
  });
}

export function primeNotifications() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
  } catch {}
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

// ---------- 화면 꺼짐 막기 ----------

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || document.hidden) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {}
}

export function keepScreenOn(on) {
  wantAwake = on;
  if (on) requestWakeLock();
  else {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }
}

// ---------- 소리 ----------

// "띠리리리링": 높은 음 두 개를 빠르게 번갈아 울린다 (전화벨처럼)
function ring() {
  if (!audio) return;
  try {
    audio.resume?.();
    const t = audio.currentTime;
    for (let k = 0; k < 8; k++) {
      const start = t + k * 0.11;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = k % 2 ? 1568 : 1319;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.1);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.11);
    }
  } catch {}
}

// ---------- 탭 제목 ----------

function stopFlash() {
  clearInterval(flashTimer);
  flashTimer = null;
  if (baseTitle !== null) document.title = baseTitle;
  baseTitle = null;
}

function flashTitle(text) {
  if (!document.hidden) return;
  stopFlash();
  baseTitle = document.title;
  let on = false;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? text : baseTitle;
  }, 800);
}

// ---------- 시스템 알림 ----------

async function systemNotify(title, body) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body, tag: 'match', renotify: true, requireInteraction: true, vibrate: VIBRATE };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {}
  try {
    new Notification(title, options);
  } catch {}
}

async function clearSystemNotifications() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const list = await reg?.getNotifications({ tag: 'match' });
    list?.forEach(n => n.close());
  } catch {}
}

// ---------- 화면 덮는 알림 ----------

function showOverlay(title, body) {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'alarm';
    overlay.setAttribute('role', 'alertdialog');
    overlay.innerHTML = '<div class="alarm-card"><div class="alarm-icon" aria-hidden="true"></div>'
      + '<p class="alarm-title"></p><p class="alarm-body"></p>'
      + '<button class="btn primary big alarm-ok" type="button">확인하기</button></div>';
    overlay.querySelector('.alarm-ok').addEventListener('click', stopAlarm);
    document.body.append(overlay);
  }
  const icon = [...title][0] || '💘';
  overlay.querySelector('.alarm-icon').textContent = icon;
  overlay.querySelector('.alarm-title').textContent = title.replace(icon, '').trim();
  overlay.querySelector('.alarm-body').textContent = body;
  overlay.hidden = false;
}

// ---------- 알람 ----------

export function stopAlarm() {
  clearInterval(ringTimer);
  clearTimeout(ringStop);
  ringTimer = null;
  ringStop = null;
  try {
    navigator.vibrate?.(0);
  } catch {}
  if (overlay) overlay.hidden = true;
  stopFlash();
  clearSystemNotifications();
}

export function notify(title, body) {
  stopAlarm();
  showOverlay(title, body);
  flashTitle(title);
  systemNotify(title, body);
  const once = () => {
    ring();
    try {
      navigator.vibrate?.(VIBRATE);
    } catch {}
  };
  once();
  ringTimer = setInterval(once, RING_EVERY_MS);
  ringStop = setTimeout(() => {
    clearInterval(ringTimer);
    ringTimer = null;
  }, ALARM_MS);
}
