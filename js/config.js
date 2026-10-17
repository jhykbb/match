// 사이트 설정. 설문 문항과 매칭 규칙은 여기서 바꾼다.
export const CONFIG = {
  siteTitle: '',
  subtitle: '설문하고 취향이 딱 맞는 짝을 찾아요',
  nickMaxLength: 12,
  nameMaxLength: 10,
  maxMessageLength: 500,

  searchMinutes: 15,
  autoMatchScore: 90,
  candidateCount: 3,
  requestSeconds: 600,
  proposeSeconds: 600,

  minAge: 8,
  maxAge: 99,
  adultAge: 20,
  adultMaxAgeGap: 4,

  // pair 문항은 선호( prefStep )와 본인 특성( selfStep )을 따로 물어 서로 연결한다.
  // 총 20문항: 키(3·7번), 강아지상/고양이상(16·20번) 연동.
  anyLabel: '상관없어',
  questions: [
    { id: 'fashion', type: 'same', group: '첫인상', q: '어떤 패션 스타일을 좋아하나요?', options: ['개성 있는 스타일', '깔끔한 스타일'] },
    { id: 'fight', type: 'same', group: '연애 성향', q: '상대방에게 화가 났다면 어떻게 풀어가나요?', options: ['싸운 즉시 화해하는 것이 편하다', '천천히 화해하는 것이 편하다'] },
    { id: 'height', type: 'pair', group: '첫인상', pref: '어떤 키를 좋아하나요?', prefStep: 7, self: '자신의 키는?', selfStep: 3, options: ['149 이하', '150 ~ 159', '160 ~ 169', '170 ~ 179', '180 이상'] },
    { id: 'mbti', type: 'same', group: '성격', q: 'MBTI는?', options: ['ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP', 'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ', '몰라요'] },
    { id: 'firstLook', type: 'same', group: '첫인상', q: '이성을 볼 때 무엇을 먼저 보나요?', options: ['성격', '외모', '취향', '스타일', '키'] },
    { id: 'type', type: 'same', group: '연애 취향', q: '어떤 사람을 좋아하나요?', options: ['재밌는 사람', '털털한 사람', '섬세한 사람', '착한 사람'] },
    { id: 'season', type: 'same', group: '취향', q: '좋아하는 계절은?', options: ['봄', '여름', '겨울', '가을'] },
    { id: 'movie', type: 'same', group: '취향', q: '좋아하는 영화 장르는?', options: ['호러 / 스릴러', '로맨스', '코미디 / 가족', '철학 / 추리', '판타지 / SF / 액션'] },
    { id: 'contact', type: 'same', group: '연애 성향', q: '연인과 연락은 어느 정도 하는 게 좋나요?', options: ['시간 날 때 가볍게 연락', '하루에 여러 번 자연스럽게 연락', '일상을 수시로 공유', '가능하면 거의 계속 연락'] },
    { id: 'music', type: 'same', group: '취향 및 라이프스타일', q: '자주 듣는 음악은?', options: ['발라드', '힙합 / 랩', '케이팝 / 댄스', '해외 음악', '두루두루 듣는다'] },
    { id: 'weekend', type: 'same', group: '취향 및 라이프스타일', q: '주말엔 보통?', options: ['집에서 쉰다', '밖에 나간다'] },
    { id: 'friendship', type: 'same', group: '성격 및 가치관', q: '남녀 사이에 친구가 있을 수 있다고 생각하나요?', options: ['있을 수 있다', '없다고 생각한다'] },
    { id: 'affection', type: 'same', group: '연애 성향', q: '애정 표현은 어떤 편인가요?', options: ['보통 말로 표현한다', '스킨십을 많이 하는 편이다'] },
    { id: 'expenses', type: 'same', group: '연애 성향', q: '연인과 데이트 비용은?', options: ['내가 사주는 편', '더치페이하는 편'] },
    { id: 'face', type: 'pair', group: '첫인상', pref: '어떤 상을 좋아하나요?', prefStep: 16, self: '당신은 어떤 상인가요?', selfStep: 20, options: ['강아지상', '고양이상'] },
    { id: 'datePlace', type: 'same', group: '취향 및 라이프스타일', q: '데이트 장소로 가장 좋은 곳은?', options: ['놀이공원', '영화관', '만화 / 보드게임 카페', '카페'] },
    { id: 'relationship', type: 'same', group: '연애 성향', q: '연애할 때 더 중요한 것은?', options: ['설렘과 두근거림', '편안함과 안정감'] },
    { id: 'approach', type: 'same', group: '연애 성향', q: '호감 있는 사람에게 다가가는 방식은?', options: ['적극적으로 먼저 다가간다', '상대가 먼저 다가오길 기다린다', '상대가 적극적으로 다가오는 게 좋다', '내가 먼저 다가가는 편이다'] },
  ],

  bannedWords: [
    '시발', '씨발', '씨바', '씌발', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '븅신',
    '개새끼', '개새기', '개색기', '개색히', '좆', 'ㅈ같', '미친놈', '미친년',
    '니애미', '느금마', '엠창', '지랄', 'ㅈㄹ', '썅', '꺼져',
    'fuck', 'shit', 'bitch',
  ],

  firebase: {
    apiKey: 'AIzaSyCfgecUfxJWt-sLk6bKvQGvo3wuc3h4KC0',
    authDomain: 'match-64748.firebaseapp.com',
    databaseURL: 'https://match-64748-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'match-64748',
    storageBucket: 'match-64748.firebasestorage.app',
    messagingSenderId: '207782055265',
    appId: '1:207782055265:web:6cc33e65d02eee482a8920',
  },
};
