// config.js에 firebase 값이 있으면 Firebase 모드, 없으면 로컬 모드(테스트용)로 돈다.
// 두 모드는 같은 함수들을 내보낸다: init, watchWaiting, search, openRoom
import { CONFIG } from './config.js';

export const { mode, init, watchWaiting, search, openRoom } = CONFIG.firebase
  ? await import('./store.firebase.js')
  : await import('./store.local.js');
