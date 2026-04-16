# BOJ Backup CLI

BOJ 제출/문제 백업용 CLI의 초기 골격입니다.

현재 포함된 기능:

- `.env` 로드
- BOJ 인증 검증
- 세션 쿠키 메모리 유지
- 로그인 검증용 CLI 커맨드
- 유저 프로필 정보 조회

## Quick Start

```bash
npm install
cp .env.example .env
```

`.env`에 인증 정보를 채운 뒤 아래 명령으로 로그인 검증:

```bash
npm run login
```

직접 실행:

```bash
npx tsx src/index.ts login
```

브라우저 대시보드 열기:

```bash
npx tsx src/index.ts serve --open
```

이 대시보드에서는 브라우저에서 작업을 둘로 나눠 실행합니다.

- `프로필 크롤링`
- `문제 + 제출코드 크롤링`

두 번째 작업은 `profile.json` 이 먼저 있어야 시작됩니다.
즉, 기본 흐름은 `프로필 크롤링 → 문제 + 제출코드 크롤링` 입니다.

중간에 끊기면 단계별 resume 이 됩니다.

대시보드에서 실행 중인 작업은 `중지 요청` 버튼으로 안전하게 멈출 수 있습니다.
현재 요청이 끝나면 정지하고, 남은 단계는 같은 화면에서 다시 이어받을 수 있습니다.
중간에 멈춘 작업이 있으면 대시보드에 `이어받기` 카드가 뜨고, 현재 몇 단계까지 진행됐는지와 퍼센트를 함께 보여줍니다.

- 전체 동기화 단계는 `submissions.sync-checkpoint.json` 으로 이어받기
- 제출 기록 수집 단계는 `submissions.checkpoint.json` 으로 이어받기
- 문제 백업 단계는 이미 저장된 문제 폴더를 건너뛰면서 이어받기

같은 화면에서 저장된 결과도 바로 열 수 있습니다.

- 프로필 페이지
- 언어 통계 페이지
- 제출 현황 페이지
- 백업된 문제 목록 / 문제 HTML

문제 + 제출코드 크롤링 단계에는 추가 설정도 넣을 수 있습니다.

- `최대 제출 수`: 최근 제출 기준 상위 N개 제출만 수집
- `최대 문제 수`: 수집된 제출 기준 상위 N개 문제만 백업

대시보드에서 저장 경로는 직접 입력하지 않습니다.
기본 저장 구조는 `data/{username}/profile.json`, `data/{username}/submissions.json`, `data/{username}/problems/` 입니다.

CLI 에서도 같은 흐름을 두 단계로 나눠 실행할 수 있습니다.

1. 프로필 크롤링:

```bash
npx tsx src/index.ts profile --output data/profile.json
```

2. 문제 + 제출코드 크롤링:

```bash
npx tsx src/index.ts archive --profile data/profile.json
```

기존처럼 한 번에 전체 흐름을 돌리고 싶으면:

```bash
npx tsx src/index.ts sync
```

문제 + 제출코드 크롤링 대상을 제한해서 실행:

```bash
npx tsx src/index.ts archive --profile data/profile.json --problem-limit 20
```

이 단계는 `profile.json` 안의 문제 번호 목록을 먼저 만들고, 그 목록의 앞에서부터 선택한 문제들만 대상으로 제출 기록과 코드를 수집합니다.

실행 중 `Ctrl+C` 를 누르면 현재 요청이 끝난 뒤 안전하게 정지하고,
체크포인트를 남겨 다음 실행에서 이어받습니다.

처음부터 다시 하려면:

```bash
npx tsx src/index.ts sync --no-resume
```

현재 로그인된 계정의 프로필 확인:

```bash
npx tsx src/index.ts profile
```

프로필, 언어 통계, 문제 번호 목록을 하나의 JSON으로 저장:

```bash
npx tsx src/index.ts profile --output data/profile.json
```

`profile`, `submissions`, `languages` 명령은 핸들을 생략하면 현재 로그인된 계정을 사용합니다.
다른 공개 유저 데이터를 볼 때만 `egod1537` 같은 핸들을 직접 넘기면 됩니다.

제출 기록은 별도 JSON으로 저장:

```bash
npx tsx src/index.ts submissions --output data/submissions.json
```

최근 제출 일부만 저장하고 싶으면:

```bash
npx tsx src/index.ts submissions --output data/submissions.json --submission-limit 200
```

`submissions.json` 은 표 렌더링과 후처리에 바로 쓰기 좋게 `columns` 메타데이터와 `rows` 배열로 저장됩니다.

`submissions` 명령은 공개 `status` 페이지를 여러 번 순회하므로 시간이 걸릴 수 있고,
크롤링 중에는 현재 페이지/수집한 행 수/마지막 제출 번호/현재 딜레이를 페이지별 누적 로그로 출력합니다.
중간에 종료되거나 `Ctrl+C` 로 중지하면 체크포인트 JSON을 남기고, 같은 명령을 다시 실행하면 자동으로 이어서 수집합니다.
기본 체크포인트 경로는 출력 파일 옆 `*.checkpoint.json` 이거나, 출력 파일이 없으면 현재 디렉터리의 `.boj-submissions.{handle}.checkpoint.json` 입니다.
BOJ 요청은 기본적으로 `3초 ± 0.5초` 간격으로 직렬 처리하고, `403/429` 응답이 오면 `10초 → 30초 → 60초` 백오프로 재시도합니다.

딜레이를 조절해서 실행:

```bash
npx tsx src/index.ts submissions --output data/submissions.json --delay 2
```

제출 JSON에 들어 있는 문제 번호를 기준으로 문제 지문을 문제별 폴더에 백업:

```bash
npx tsx src/index.ts backup-problems data/submissions.json --output-dir problems
```

문제 번호 필터나 개수 제한을 같이 줄 수도 있습니다:

```bash
npx tsx src/index.ts backup-problems data/submissions.json --output-dir problems --problem-filter 1000,1001-1010 --problem-limit 20
```

`backup-problems` 는 각 문제를 `problems/{problemId}/index.html`, `meta.json`, `submissions.json`, `sources/*` 로 저장합니다.
`meta.json` 에는 solved.ac 기준 티어, 티어 라벨, 알고리즘 분류 태그도 함께 들어갑니다.
`submissions.json` 에는 그 문제에 대한 내 제출 기록만 별도로 잘라낸 `columns + rows` 구조가 들어갑니다.
`sources/` 에는 실제 제출 코드가 `{submissionId}.{ext}` 형태로 저장됩니다.
저장되는 `index.html` 에서는 Google Ads/Analytics 스크립트를 제거해서 로컬에서 광고 없이 볼 수 있게 합니다.
문제 백업 단계 내부 순서는 `문제 페이지 → solved.ac 메타 → 해당 문제의 제출 코드들 → 파일 저장` 입니다.
문제 선택 순서는 기본적으로 `최근 제출한 문제 순` 이고, `--problem-limit` 은 그 순서를 기준으로 잘라냅니다.
이미 백업된 문제 폴더는 자동으로 건너뛰므로, 중간에 종료돼도 다시 실행하면 남은 문제만 이어서 처리합니다.
실행 중 `Ctrl+C` 를 누르면 현재 요청이 끝난 뒤 안전하게 정지합니다.
예전 형식의 `meta.json` 만 있거나 `submissions.json` 이 없는 폴더는 다시 실행하면 새 형식으로 보강됩니다.
크롤링 중에는 문제 다운로드, solved.ac 메타 다운로드, 제출 코드 다운로드, 폴더 저장 단계를 누적 로그로 출력하고,
문제 완료 시 `index.html / meta.json / submissions.json / sources/` 파일 트리를 함께 보여줍니다.

기존 문제 폴더를 무시하고 다시 받기:

```bash
npx tsx src/index.ts backup-problems data/submissions.json --output-dir problems --overwrite
```

기존 체크포인트를 무시하고 처음부터 다시 시작:

```bash
npx tsx src/index.ts submissions --output data/submissions.json --no-resume
```

체크포인트 경로를 직접 지정:

```bash
npx tsx src/index.ts submissions --output data/submissions.json --checkpoint data/submissions.checkpoint.json
```

같은 내용을 JSON으로 표준 출력:

```bash
npx tsx src/index.ts profile --json
```

특정 핸들의 프로필 확인:

```bash
npx tsx src/index.ts profile egod1537
```

특정 핸들의 제출 기록 저장:

```bash
npx tsx src/index.ts submissions egod1537 --output data/egod1537-submissions.json
```

저장한 프로필 JSON을 BOJ 유저 페이지와 비슷한 로컬 웹사이트로 보기:

```bash
npx tsx src/index.ts serve-profile data/profile.json --open
```

프로필과 제출 기록 프론트를 한 서버에서 같이 보기:

```bash
npx tsx src/index.ts serve-profile data/profile.json --submissions data/submissions.json --open
```

이 경우 프로필 페이지의 `제출` 링크와 상단 `채점 현황` 메뉴가 로컬 제출 현황 페이지로 연결됩니다.

저장한 제출 JSON을 BOJ 채점 현황 페이지와 비슷한 로컬 웹사이트로 보기:

```bash
npx tsx src/index.ts serve-submissions data/submissions.json --open
```

윈도우에서 특정 포트가 막혀 있으면 자동 포트를 명시:

```bash
npx tsx src/index.ts serve-profile data/profile.json --port 0 --open
```

기본 경로:

```text
/user/{handle}
/user/language/{handle}
/status?user_id={handle}
```

현재 로그인된 계정의 언어 통계 확인:

```bash
npx tsx src/index.ts languages
```

특정 핸들의 언어 통계 확인:

```bash
npx tsx src/index.ts languages egod1537
```

## Environment

```env
BOJ_COOKIE=OnlineJudge=your_session_cookie
BOJ_ID=your_handle
BOJ_PW=your_password
BOJ_DELAY_MS=3000
```

## Notes

- Windows에서는 `.env` 인증 정보가 없어도, 현재 사용자 계정의 Chrome/Edge/Brave 에 BOJ 로그인이 살아 있으면 `OnlineJudge` 쿠키를 자동으로 찾아 재사용합니다.
- 2026-04-16 기준 BOJ 로그인 페이지는 `reCAPTCHA` 를 포함하고 있어 `BOJ_ID/BOJ_PW` 만으로는 자동 로그인이 막힐 수 있습니다.
- 이 경우 브라우저에서 로그인한 뒤 `OnlineJudge=...` 쿠키 값을 `BOJ_COOKIE` 로 넣어 검증합니다.
- `BOJ_COOKIE` 가 없으면 먼저 Windows 브라우저 세션을 찾고, 그것도 없을 때만 `GET /login` 후 `POST /signin` 으로 로그인 시도를 합니다.
- 세션 쿠키는 메모리의 `CookieJar` 에만 유지합니다.
- 로그인 성공 후 홈 페이지의 현재 사용자 메타 태그로 세션을 검증합니다.
