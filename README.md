# BOJ Backup CLI

BOJ 프로필, 제출 기록, 문제 본문, 제출 코드를 로컬에 백업하는 도구입니다.

기본 사용 흐름은 단순합니다.

1. BOJ 로그인 세션 준비
2. `profile` 로 프로필 JSON 저장
3. `archive` 로 제출 JSON + 문제/코드 백업
4. `serve` 로 대시보드/뷰어 열기

저장 경로는 기본적으로 사용자별로 관리됩니다.

```text
data/{username}/profile.json
data/{username}/submissions.json
data/{username}/problems/
```

## 설치

```bash
npm install
cp .env.example .env
```

## 1. BOJ 쿠키 넣는 방법

가장 먼저 `.env` 를 준비합니다.

```env
BOJ_COOKIE=OnlineJudge=...
BOJ_ID=
BOJ_PW=
BOJ_DELAY_MS=3000
BOJ_TIMEOUT_MS=15000
BOJ_TIMEOUT_MAX_MS=60000
```

### 가장 권장하는 방법

윈도우에서는 현재 사용자 브라우저의 BOJ 로그인 세션을 자동으로 재사용하려고 시도합니다.
그래서 이미 Chrome / Edge / Brave 에서 BOJ 로그인 상태면 `BOJ_COOKIE` 없이도 될 수 있습니다.

먼저 이걸로 확인하면 됩니다.

```bash
npx tsx src/index.ts login
```

### 자동 감지가 안 될 때

브라우저에서 직접 `OnlineJudge` 쿠키를 꺼내서 `.env` 에 넣으면 됩니다.

1. 브라우저에서 `https://www.acmicpc.net` 로그인
2. `F12` 개발자 도구 열기
3. `Application` 또는 `Storage` 탭으로 이동
4. `Cookies` 에서 `https://www.acmicpc.net` 선택
5. `OnlineJudge` 쿠키 값을 복사
6. `.env` 에 아래처럼 넣기

```env
BOJ_COOKIE=OnlineJudge=복사한_값
```

그 다음 다시 확인:

```bash
npx tsx src/index.ts login
```

### 왜 쿠키가 필요한가

2026-04-16 기준 BOJ 로그인 페이지는 `reCAPTCHA` 가 걸려 있어서 `BOJ_ID` / `BOJ_PW` 만으로는 자동 로그인이 막힐 수 있습니다.  
그래서 실제 사용은 `BOJ_COOKIE` 또는 브라우저 세션 자동 감지 기준으로 보는 게 맞습니다.

브라우저에 로그인돼 있는데도 감지가 안 되면:

- 브라우저가 켜져 있어서 쿠키 DB가 잠긴 상태일 수 있음
- 이 경우 브라우저를 완전히 종료한 뒤 다시 시도
- 또는 `.env` 에 `BOJ_COOKIE` 를 직접 넣기

## 2. 프론트 띄워서 사용하는 방법

브라우저 대시보드는 이 명령 하나면 됩니다.

```bash
npx tsx src/index.ts serve --open
```

열리면 대시보드에서:

- 프로필 수집
- 제출 JSON 수집
- 문제/코드 백업
- 중지 / 이어받기
- 저장된 프로필 / 제출 / 문제 페이지 보기

를 전부 브라우저에서 할 수 있습니다.

### 대시보드에서 보는 데이터

기본적으로 아래 경로를 사용합니다.

```text
data/{username}/profile.json
data/{username}/submissions.json
data/{username}/problems/
```

대시보드에서 백업을 진행하면:

- `profile.json` 이 먼저 만들어지고
- 그 다음 선택된 문제를 하나씩 돌면서
- 각 문제마다 제출 내역을 모으고 바로 `problems/` 아래 문제 HTML, 메타, 제출 기록, 코드 파일을 저장하고
- 그 과정에서 `submissions.json` 도 함께 갱신됩니다

순으로 채워집니다.

### 중간에 멈췄을 때

- 대시보드에서 `중지 요청` 가능
- 현재 요청이 끝나면 안전하게 멈춤
- 체크포인트가 남아 있으면 같은 화면에서 이어받기 가능

## 3. CLI 사용하는 방법

현재 기본 CLI는 다섯 개만 보면 됩니다.

- `login`
- `profile`
- `archive`
- `serve`
- `tui`

### 로그인 확인

```bash
npx tsx src/index.ts login
```

### 프로필 JSON 저장

```bash
npx tsx src/index.ts profile
```

기본 저장 위치:

```text
data/{username}/profile.json
```

### 문제 + 제출코드 백업

```bash
npx tsx src/index.ts archive
```

이 명령은:

1. 기존 `profile.json` 을 읽고
2. 프로필의 문제 목록을 먼저 확정한 뒤 문제 번호 오름차순으로 정렬하고, 이미 백업되지 않은 문제를 고른 다음
3. 각 문제마다 제출 내역을 수집한 뒤 바로 문제 페이지와 제출 코드를 백업합니다
4. 이 과정에서 전체 `submissions.json` 도 같이 갱신합니다

기본 저장 위치:

```text
data/{username}/submissions.json
data/{username}/problems/
```

자주 쓰는 옵션:

```bash
npx tsx src/index.ts archive --problem-limit 20
npx tsx src/index.ts archive --no-resume
npx tsx src/index.ts archive --overwrite
```

- `--problem-limit 20`: 이미 백업되지 않은 문제 기준으로 문제 번호 오름차순 20문제만 추가 백업
- `--no-resume`: 기존 체크포인트 무시
- `--overwrite`: 이미 저장된 문제도 다시 다운로드
- 네트워크 타임아웃이나 일시적인 연결 오류가 나면 현재 체크포인트에서 자동 resume 를 시도합니다.

### 대시보드 실행

```bash
npx tsx src/index.ts serve --open
```

### 도움말 보기

```bash
npx tsx src/index.ts --help
```

## 4. TUI 사용하는 방법

간단한 메뉴형 터미널 UI도 있습니다.

```bash
npx tsx src/index.ts tui
```

또는:

```bash
npm run tui
```

현재 TUI 메뉴에서는:

- 로그인 확인
- 프로필 수집
- 문제 + 제출코드 백업
- 대시보드 열기

를 바로 실행할 수 있습니다.

## 5. 자주 쓰는 명령 모음

```bash
npx tsx src/index.ts login
npx tsx src/index.ts profile
npx tsx src/index.ts archive
npx tsx src/index.ts serve --open
npx tsx src/index.ts tui
```

## 6. 참고

- BOJ 요청은 기본적으로 `3초 ± 0.5초` 간격으로 직렬 처리합니다.
- `403/429` 응답이 오면 백오프로 재시도합니다.
- 타임아웃은 기본 `15초` 에서 시작해 timeout 계열 실패가 나면 `30초 -> 60초` 식으로 2배씩 늘어나고, `BOJ_TIMEOUT_MAX_MS` 까지 유지합니다.
- `archive` 와 `sync` 는 체크포인트를 남기며, 일시적인 네트워크 오류가 나면 자동으로 체크포인트에서 resume 를 시도합니다.
- 고급 호환용 명령(`submissions`, `backup-problems`, `serve-profile`, `serve-submissions`, `languages`, `sync`)도 남아 있지만 기본 사용은 위 다섯 개 중심으로 보면 됩니다.
