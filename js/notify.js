// 매칭 알림: 딩동 소리 + 진동 + 탭 제목 깜빡임. 화면을 안 보고 있으면 시스템 알림까지 띄운다.
// 시스템 알림은 안드로이드·PC 크롬/엣지 등에서 된다. 아이폰 사파리는 홈 화면에 추가한 경우에만 된다.
// 브라우저는 사용자가 버튼을 누르지 않으면 소리·알림 권한을 막으니, 버튼을 누를 때 primeNotifications를 부른다.
let audio = null;
let flashTimer = null;
let baseTitle = null;

export function setupNotifications() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) stopFlash();
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

function chime() {
  if (!audio) return;
  try {
    const t = audio.currentTime;
    for (const [freq, delay] of [[880, 0], [1320, 0.18]]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.3, t + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.5);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.55);
    }
  } catch {}
}

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
  }, 1000);
}

async function systemNotify(title, body) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body, tag: 'match', renotify: true, vibrate: [200, 100, 200] };
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

export function notify(title, body) {
  chime();
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {}
  flashTitle(title);
  systemNotify(title, body);
}
