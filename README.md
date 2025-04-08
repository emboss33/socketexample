# socketexample

# 📡 socketHandler.js 설명

이 모듈은 Node.js 서버에 `Socket.IO`를 통해 실시간 양방향 통신을 구현하는 핵심 파일입니다.  
사용자 인증, 룸 관리, 메시지 송수신, Redis를 통한 상태 저장 등 다양한 실시간 기능을 담당합니다.

---

## 📁 위치




---

## ⚙️ 주요 기능 요약

| 기능 | 설명 |
|------|------|
| IP 차단 | 허위 요청 혹은 인증 실패 시 클라이언트 IP 차단 |
| 토큰 검증 | Access / Refresh Token 검증 및 자동 갱신 처리 |
| Redis 연동 | 사용자-룸 정보, 메시지 요청 수, 접속 이력 저장 |
| 룸 동기화 | 사용자가 속한 모든 방의 메시지를 불러오는 기능 제공 |
| 메시지 핸들링 | 메시지 전송, 수정, 불러오기, 삭제 지원 |
| 보안 처리 | 비정상 요청 시 소켓 해제 및 IP 블록 |

---

## 🔐 인증 흐름

1. 소켓 연결 시 `accessToken`, `refreshToken`, `userAgent`, `username` 요구
2. `accessToken` 유효성 확인 → 실패 시 `refreshToken`으로 재발급 시도
3. 검증 실패 또는 위조된 요청 시 IP 차단 후 연결 종료

---

## 🔁 주요 이벤트 목록

| 이벤트명 | 설명 |
|----------|------|
| `refreshToken` | 새로운 액세스 토큰을 요청 |
| `syncRooms` | 모든 참여 중인 룸의 메시지 최신화 |
| `join` | 특정 룸에 입장하고 이전 메시지를 수신 |
| `message` | 메시지를 전송 (GPT 응답 포함 가능) |
| `editMessage` | 기존 메시지 수정 |
| `loadMoreMessages_for_room` | 특정 방의 과거 메시지 로딩 |
| `deleteroom` | 방 삭제 및 관련 Redis 정리 |
| `leave` | 방을 나가고 Redis에서 사용자 정보 제거 |
| `disconnect` | 소켓 연결 종료 처리 및 Redis 정리 |

---

## 🧠 Redis 키 구조

| 키 | 설명 |
|----|------|
| `userRooms:{platformid}` | 사용자가 속한 모든 방 목록 |
| `roomUsers:{roomId}` | 특정 방에 접속 중인 소켓 ID 목록 |
| `joinedRoomUsers:{roomId}` | 실제 메시지를 수신하는 유저 리스트 |
| `tokenRequests:{ip}` | 특정 IP의 토큰 요청 횟수 저장 (Rate Limiting) |

---

## 🧪 의존 모듈

- `socket.io`: 실시간 양방향 통신
- `axios`: HTTP 요청 처리
- `dotenv`: 환경변수 관리
- `redis`: 사용자 상태 저장
- 커스텀 모듈들:
  - `gptQueue`: GPT 메시지 처리 큐
  - `ipBlocker`: IP 차단 로직
  - `axiosfunction`: 사용자 방 조회/삭제
  - `messageHandler`: 메시지 처리 전용 핸들러

---

## 📌 기타 주의사항

- `userAgent`가 특정 문자열(환경변수 `VISION_APP_INFO`)을 포함하지 않으면 차단됩니다.
- 토큰 인증 실패 시 즉시 소켓을 해제하고 IP를 블록합니다.
- 메시지 동기화는 병렬/일괄 방식으로 나뉘며, 방 개수에 따라 자동 결정됩니다.

---

## 💡 개선 아이디어 (TODO)

- `join` 이벤트에 대해 토큰 기반 재검증 로직 강화
- 비정상 요청 시 알림 메시지 송신
- `messageHandler` 내부에서 GPT 메시지 이력 관리 강화

---

## 📞 예시 클라이언트 인증 정보 구조

```js
const socket = io(SERVER_URL, {
  auth: {
    accessToken: '...',
    refreshToken: '...',
    userAgent: navigator.userAgent,
    username: '사용자이름'
  }
});




