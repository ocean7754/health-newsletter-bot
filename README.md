# 건강 콘텐츠 자동 생성 · 이메일 발송 봇

매일 오전 9시 / 오후 1시(KST)에 자동으로 실행되어,
Claude API로 콘텐츠를 생성하고 결과를 Gmail로 보내주는 GitHub Actions 자동화입니다.

## 폴더 구조
```
health-newsletter-bot/
├── .github/workflows/generate.yml   # 스케줄러 (cron)
└── scripts/
    ├── generate.js                  # 콘텐츠 생성 + 메일 발송 로직
    └── package.json
```

## 설정 방법

### 1. GitHub 저장소 만들기
이 폴더 전체를 새 GitHub 저장소(Public 또는 Private 모두 가능)에 업로드하세요.

### 2. Gmail 앱 비밀번호 발급
1. Google 계정 → 보안 → 2단계 인증 켜기
2. https://myaccount.google.com/apppasswords 접속
3. "앱 비밀번호" 생성 → 16자리 비밀번호 복사 (일반 로그인 비밀번호와 다릅니다)

### 3. Anthropic API 키 발급
https://console.anthropic.com 에서 API 키 발급

### 4. GitHub Secrets 등록
저장소 → Settings → Secrets and variables → Actions → New repository secret

| Secret 이름 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `GMAIL_USER` | 보내는 사람 Gmail 주소 (예: myaccount@gmail.com) |
| `GMAIL_APP_PASSWORD` | 위에서 발급받은 16자리 앱 비밀번호 |
| `MAIL_TO` | 받는 사람 이메일 주소 (콤마로 여러 명 가능) |

### 5. 동작 확인
- 저장소 → Actions 탭 → "Health Content Generator" 워크플로 선택
- 우측 "Run workflow" 버튼으로 수동 실행 → 정상적으로 메일이 오는지 테스트
- 이후에는 매일 오전 9시 / 오후 1시(KST)에 자동 실행됩니다.

## 프롬프트 교체하기
`scripts/generate.js` 상단의 `SYSTEM_PROMPT`, `USER_PROMPT` 부분을
원하는 내용으로 수정하면 됩니다.

⚠️ 주의: 이 스크립트는 실제 사람이 작성한 것처럼 콘텐츠를 위장하거나,
AI 생성 사실을 숨기고 실제 커뮤니티(카페 등)에 게시하는 용도로는
사용하지 않는 것을 권장합니다. 생성된 콘텐츠는 검토 후 사용하세요.

## 시간을 바꾸고 싶다면
`.github/workflows/generate.yml` 의 `cron` 값을 수정하세요.
GitHub Actions의 cron은 UTC 기준이며, KST는 UTC+9입니다.
예) 오전 8시 KST = `0 23 * * *` (전날 23:00 UTC)
