# 취향 매칭

학교 행사용 1:1 취향 매칭 사이트. 정적 HTML/JS + Firebase(익명 로그인, Realtime Database).

## 흐름

1. QR을 찍고 들어온다 (입장 코드 없음. 주소를 아는 사람은 누구나 들어올 수 있다)
2. 프로필 사진(안 고르면 사람 모양 기본 이미지), 닉네임, 이름, 나이, 성별을 적는다 (사진과 이름은 매칭이 성사돼야만 공개)
3. 설문 25장: "나는 강아지상/고양이상" + "좋아하는 건 강아지상/고양이상/상관없어" (취향 대입) 2장과,
   연애 취향·사소한 취향·취미·성향 23문항 (답이 같으면 점수)
4. **5분 동안** 궁합 80% 이상인 이성을 찾는다
   - 찾으면 바로 이어진다 → 둘 다 💕 승낙 / 넘기기 (1분 안에 안 고르면 넘기기)
   - 둘 다 승낙: 이름 공개 + 대화 시작 / 한 명이라도 넘기기: 다시 5분 찾기
5. 5분 안에 80% 이상인 사람이 없으면 → 지금 기다리는 사람 중 **궁합 높은 3명**을 보여 준다
   - 한 명에게 신청 → 상대에게 💌 알림 → 상대가 수락하면 바로 성사 (이름 공개 + 대화)
   - 거절하거나 1분 동안 응답이 없으면 다시 5분 찾기
   - 후보를 보는 중에도 80% 이상인 사람이 오면 바로 이어 준다
6. 한 번 만난 사람, 내 신청을 거절한 사람은 다시 나오지 않는다

## 매칭 규칙 (`js/config.js`)

- 이성끼리만
- 나이: 20살 미만은 미만끼리만(나이 차이 상관없음), 20살 이상은 이상끼리 4살 차이까지
- 궁합 점수: 짝 문항은 "내가 좋아하는 것 = 상대 자신"이면 점수(양쪽 방향 각각, 상관없어는 0.6점),
  같은 답 문항은 답이 같으면 점수. 100점 만점으로 환산
- 차단한 사람, 이미 만난 사람은 제외

설문 문항, 시간(searchMinutes, requestSeconds, proposeSeconds), 기준 점수, 나이 규칙, 금지어는 모두 `js/config.js`에서 고친다.

## 로컬에서 테스트

`js/config.js`의 `firebase`가 `null`이면 로컬 모드다. 같은 브라우저에서 탭을 두 개 열면 서로 이어진다.

```
powershell -ExecutionPolicy Bypass -File server.ps1 -Port 5510
```

http://localhost:5510 을 탭 두 개로 연다. 테스트할 땐 `searchMinutes`를 0.25(15초)로 줄이면 편하다.
로컬 모드는 탭끼리 localStorage를 나눠 쓰는 흉내라, 뒤에 있는 탭이 느려지거나 세 명 이상이 동시에 몰리면
가끔 꼬인다. 실제 Firebase에서는 트랜잭션이 막아 준다.

## Firebase 연결

1. Firebase 콘솔에서 프로젝트 만들기 (Spark 무료 요금제)
2. Authentication > 로그인 방법 > **익명** 사용 설정
3. Realtime Database > 데이터베이스 만들기 (위치: 싱가포르 asia-southeast1, 잠금 모드)
4. Realtime Database > 규칙 탭에 `database.rules.json` 내용을 붙여넣고 게시 (// 주석 줄은 빼도 된다)
5. 프로젝트 설정 > 내 앱 > 웹 앱 추가 → 나오는 `firebaseConfig`를 `js/config.js`의 `firebase:`에 붙여넣기 (`databaseURL` 포함)
6. QR 코드는 배포 주소(https://jhykbb.github.io/match/)로 만든다

지금 연결된 프로젝트: Firebase `match-64748` (Realtime Database 싱가포르)

신고는 Realtime Database > 데이터의 `reports`에서 볼 수 있다.

## 파일

| 파일 | 내용 |
|---|---|
| `index.html`, `css/style.css` | 화면 |
| `js/app.js` | 화면 흐름 (설문, 찾기·후보·신청, 승낙/넘기기, 대화) |
| `js/config.js` | 사이트 이름, 설문 문항, 매칭 규칙, 금지어, Firebase 설정 |
| `js/common.js` | 궁합 계산, 상대 고르기, 욕설 가리기 |
| `js/store.firebase.js` | Firebase 매칭·채팅 |
| `js/store.local.js` | 테스트용 로컬 모드 |
| `database.rules.json` | 보안 규칙 (콘솔에 붙여넣기) |
