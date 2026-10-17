// 사이트 설정. 이름·설문 문항·매칭 규칙은 여기서 바꾸면 된다.
export const CONFIG = {
  siteTitle: '',   // 비워 두면 제목 없이 나온다
  subtitle: '설문하고 취향이 딱 맞는 짝을 찾아요',
  nickMaxLength: 12,
  nameMaxLength: 10,
  maxMessageLength: 500,

  // 매칭 방식
  //   설문이 끝나면 searchMinutes분 동안 궁합 autoMatchScore% 이상인 상대를 찾는다.
  //   찾으면 서로 문자해보기/넘기기를 고르고, 둘 다 문자해보기면 이름 공개 + 대화 시작.
  //   대기 중에 사이트를 닫아도 대기열에 남는다("자리 비움"). 다시 들어오면 이어서 기다린다.
  //   못 찾으면 지금 기다리는 사람 중 궁합이 높은 candidateCount명을 보여 주고, 한 명에게 신청한다.
  //   신청받은 사람이 수락하면 바로 성사. 거절·무응답이면 다시 searchMinutes분 찾는다.
  searchMinutes: 5,
  autoMatchScore: 90,
  candidateCount: 3,
  requestSeconds: 600,  // 신청에 응답을 기다리는 시간 (사이트를 닫아 둔 사람도 문자 보고 들어올 수 있게)
  proposeSeconds: 600,  // 짝이 정해진 뒤 문자해보기/넘기기를 고르는 시간 (지나면 넘기기).
                        // 사이트를 닫아 둔 사람에게 운영진이 문자할 시간을 주려고 넉넉히 잡았다

  // 나이 규칙: adultAge 미만은 미만끼리만(나이 차이 상관없음),
  // adultAge 이상은 이상끼리 adultMaxAgeGap살 차이까지만 매칭
  minAge: 8,
  maxAge: 99,
  adultAge: 20,
  adultMaxAgeGap: 4,

  // 설문 문항 (pair 1개 = 2장, same 23개 → 모두 25장)
  //   pair: "나는?"과 "좋아하는 상대는?"을 따로 묻는다. 내가 좋아하는 것 = 상대 자신이면 점수.
  //         prefStep/selfStep으로 각각 몇 번째 장에 넣을지 정한다 (없으면 맨 뒤)
  //   same: 한 번만 묻는다. 둘의 답이 같으면 점수 ("둘 다 ○○"로 보여 주니 보기만 읽어도 뜻이 통하게 쓴다)
  //   group: 설문 화면 위에 작게 나오는 분류
  anyLabel: '상관없어',
  questions: [
    // prefStep/selfStep: 몇 번째 장에서 물을지 (붙여서 물으면 눈치채니까 떨어뜨려 놓았다)
    { id: 'face', type: 'pair', group: '첫인상', pref: '어떤 상을 좋아해요?', prefStep: 3, self: '당신은 어떤 상이에요?', selfStep: 21, options: ['강아지상', '고양이상'] },

    { id: 'chat', type: 'same', group: '연애 취향', q: '연락은?', options: ['연락 자주 하는 게 좋아', '연락은 가끔이면 충분'] },
    { id: 'date', type: 'same', group: '연애 취향', q: '데이트한다면?', options: ['카페·영화', '놀이공원·액티비티'] },
    { id: 'couple', type: 'same', group: '연애 취향', q: '커플템은?', options: ['커플템 좋아', '커플템은 부끄러워'] },
    { id: 'anniv', type: 'same', group: '연애 취향', q: '기념일은?', options: ['기념일은 꼭 챙기기', '기념일은 소소하게'] },
    { id: 'fight', type: 'same', group: '연애 취향', q: '다퉜을 때 나는?', options: ['바로 풀어야 하는 편', '시간이 좀 필요한 편'] },
    { id: 'public', type: 'same', group: '연애 취향', q: '연애하면?', options: ['주변에 다 알리고 싶어', '조용히 하고 싶어'] },

    { id: 'tangsu', type: 'same', group: '사소한 취향', q: '탕수육은?', options: ['부먹', '찍먹'] },
    { id: 'mint', type: 'same', group: '사소한 취향', q: '민트초코는?', options: ['민트초코 최고', '민트초코는 치약 맛'] },
    { id: 'snack', type: 'same', group: '사소한 취향', q: '야식 하나만 고른다면?', options: ['치킨', '떡볶이'] },
    { id: 'cafe', type: 'same', group: '사소한 취향', q: '카페에 가면?', options: ['아이스 아메리카노', '달달한 음료'] },
    { id: 'season', type: 'same', group: '사소한 취향', q: '더 좋은 계절은?', options: ['여름파', '겨울파'] },

    { id: 'weekend', type: 'same', group: '취미', q: '주말에 나는…', options: ['집에서 쉬는 게 좋아', '밖에 나가는 게 좋아'] },
    { id: 'hobby', type: 'same', group: '취미', q: '쉴 때 주로 하는 건?', options: ['게임', '유튜브·영상 보기'] },
    { id: 'music', type: 'same', group: '취미', q: '자주 듣는 노래는?', options: ['K팝·아이돌', '힙합·밴드·인디'] },
    { id: 'sport', type: 'same', group: '취미', q: '운동은?', options: ['운동 좋아함', '운동은 별로'] },
    { id: 'movie', type: 'same', group: '취미', q: '영화 볼 때는?', options: ['로맨스·코미디', '액션·공포'] },
    { id: 'travel', type: 'same', group: '취미', q: '여행 간다면?', options: ['바다 여행', '도시 여행'] },

    { id: 'time', type: 'same', group: '성향', q: '나는?', options: ['아침형 인간', '밤형 인간'] },
    { id: 'social', type: 'same', group: '성향', q: '놀 때는?', options: ['여럿이 시끌벅적', '소수랑 조용히'] },
    { id: 'plan', type: 'same', group: '성향', q: '놀러 갈 때 나는?', options: ['계획 세우는 편', '즉흥적인 편'] },
    { id: 'empathy', type: 'same', group: '성향', q: '친구가 고민을 말하면?', options: ['공감부터 해 주는 편', '해결책부터 찾는 편'] },
    { id: 'punctual', type: 'same', group: '성향', q: '약속 시간에는?', options: ['미리 도착하는 편', '딱 맞춰 가는 편'] },
    { id: 'reply', type: 'same', group: '성향', q: '카톡 답장은?', options: ['바로바로 하는 편', '몰아서 하는 편'] },
  ],

  // 이 단어들은 받는 쪽 화면에서 ***로 가려진다. 띄어쓰기·기호를 끼워 넣어도 잡는다
  bannedWords: [
    '시발', '씨발', '씨바', '씌발', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '븅신',
    '개새끼', '개새기', '개색기', '개색히', '좆', 'ㅈ같', '미친놈', '미친년',
    '니애미', '느금마', '엠창', '지랄', 'ㅈㄹ', '썅', '꺼져',
    'fuck', 'shit', 'bitch',
  ],

  // Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정의 firebaseConfig 값을 붙여넣는다.
  // databaseURL이 꼭 있어야 한다. null이면 로컬 모드(같은 브라우저의 탭끼리만 연결)로 돈다.
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
