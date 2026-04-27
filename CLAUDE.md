# selenoid-bridge

E2E cross-browser testing bridge between agent-browser and Selenoid.

## Project Structure

- `src/recorder/` — agent-browser wrapper + selector extraction (CDP)
- `src/scenario/` — test scenario types and validation
- `src/runner/` — WebDriver client + scenario execution engine
- `src/index.ts` — CLI entry point (commander)
- `tests/` — vitest unit tests
- `.claude/skills/e2e-test/` — Claude Code skill for E2E test orchestration

## Related Projects

- **selenoid** (`../selenoid`) — Browser container management server (Go)
- **images** (`../images`) — Browser Docker image builder (Go)

## Commands

```bash
npm run build     # TypeScript compile
npm test          # Run unit tests (vitest)
node dist/index.js run <scenario.json> --selenoid http://localhost:4444
node dist/index.js run <scenario.json> --enable-video   # + Selenoid 세션 비디오 녹화
node dist/index.js validate <scenario.json>
node dist/index.js create <name> --url <baseUrl>
node dist/index.js render <path-or-url>             # HTML → animated WebP via renderer
node dist/index.js render-sprites --test            # 스프라이트 합성 테스트
```

### render-sprites

스프라이트 레이어를 투명 애니메이션 WebP로 합성합니다. 렌더러 서버(`packages/renderer`)가 실행 중이어야 합니다.

```bash
# 기본 — 4개 레이어(배경 + 3 도형)를 하나의 animated WebP로 합성
node dist/index.js render-sprites --test

# 레이어별 개별 WebP + HTML 컴포지터 생성
node dist/index.js render-sprites --test --split ./output

# 옵션
node dist/index.js render-sprites --test \
  --format webp      \  # 출력 포맷 (webp | mp4 | gif)
  --transparent      \  # 배경 투명 (animated WebP용)
  --fps 30           \
  --duration 3       \  # 초
  --width 800        \
  --height 600       \
  --quality 80
```

**`--split <dir>`**: 각 비-배경 레이어를 투명 animated WebP로 별도 렌더링(병렬)하고,
레이어들을 CSS `mix-blend-mode` 없이 단순 스택 오버레이하는 HTML 컴포지터 파일을 생성합니다.
macOS에서는 결과 HTML을 Chrome으로 자동 오픈합니다.

### render (HTML → video)

`window.__hf` 인터페이스를 구현한 HTML 파일 또는 URL을 렌더러로 전송해 animated WebP/MP4를 만듭니다.

```bash
node dist/index.js render ./page.html --format webp
node dist/index.js render https://example.com/animation --format mp4 --fps 60
```

- 파일 경로: HTML과 같은 디렉토리의 에셋을 자동 포함 (`.png`, `.jpg`, `.webp`, `.css`, `.js` 등)
- URL: 원격 HTML을 fetch한 뒤 `html` 문자열로 전송 (자기 완결형 페이지 전용, 외부 에셋 미포함)
- 에셋 사이드카: `sprite.png.meta.json` → `{ frameWidth, frameHeight, rows }` 로 스프라이트 메타 지정
- 20MB 초과 파일은 자동 SKIP (서버 한도)

## Recording & Timing (record / measure steps)

시나리오에서 `record`와 `measure` 스텝으로 페이지 뷰포트를 캡처하고 타이밍을 측정할 수 있다.

```json
{ "action": "record", "mode": "start", "id": "my-anim" }
{ "action": "measure", "selector": { "css": ".box" }, "event": "animationend" }
{ "action": "record", "mode": "stop",  "id": "my-anim" }
```

- **record** — `goog/cdp/execute` + `Page.captureScreenshot` 폴링(100ms)으로 뷰포트 JPEG 프레임 수집
- **measure** — JS `Date.now()` + DOM 이벤트 리스너로 애니메이션 시작/종료 시각 기록
- `--enable-video` — Selenoid가 VNC 전체화면을 H.264로 별도 녹화 (`selenoid/video-recorder` 컨테이너)

**capture vs record 차이**

| | capture (기존) | record (신규) |
|---|---|---|
| 대상 | 스텝별 스크린샷 1장 | 구간 내 연속 프레임 |
| 경로 | Selenoid WebDriver `/screenshot` | CDP `Page.captureScreenshot` |
| 출력 | PNG | JPEG 시퀀스 |

**산출물 위치** (`--artifacts-dir ./artifacts` 기준)

```
artifacts/chrome-128-0/
├── cdp-frames-{id}/          # record 구간 JPEG 프레임 (뷰포트만)
│   ├── 0001-1234567ms.jpg
│   └── ...
└── timing_report in report.json → results[].timingReports[]
```

`timingReports[]` 구조:
```json
{
  "id": "my-anim",
  "js":  { "startMs": ..., "endMs": ..., "durationMs": ... },
  "cdp": { "firstFrameMs": ..., "lastFrameMs": ..., "frameCount": ... },
  "lag": { "renderMs": ..., "renderEndMs": ... }
}
```

- `lag.renderMs` — JS start → 첫 CDP 프레임 사이 지연(ms)

**Selenoid 로컬 실행** (`packages/selenoid/docker-compose.local.yml`)

```bash
cd packages/selenoid
SELENOID_VIDEO_DIR=$(pwd)/video docker compose -f docker-compose.local.yml up -d
# 비디오: packages/selenoid/video/*.mp4
```

## Environment Variables

- `SELENOID_DIR` — Path to selenoid source (default: `../selenoid`)
- `SELENOID_IMAGES_DIR` — Path to images source (default: `../images`)
- `SELENOID_PORT` — Selenoid listen port (default: `4444`)
- `SELENOID_CONFIG` — browsers.json path (default: `/tmp/browsers-test.json`)
