# Stealth (봇 탐지 회피)

Selenoid 위에서 띄운 Chrome이 Google·Cloudflare 등의 봇 체크에 걸리는 신호와, `WebDriverClient.createSession`이 자동으로 적용하는 대응책을 정리한다.

대상 코드: `src/runner/webdriver.ts` `createSession` / `applyStealth`.

## 봇 탐지가 사용하는 주요 신호

| # | 신호 | 어디서 나오나 | 기본값(자동화) | 정상값(사람) |
|---|---|---|---|---|
| 1 | `navigator.webdriver` | W3C WebDriver 스펙이 강제로 `true`로 세팅 | `true` | `false` / `undefined` |
| 2 | `--enable-automation` 스위치 | ChromeDriver가 기본 부여 → 주소창 위 "자동화된 소프트웨어로 제어됨" 배너 노출, `window.cdc_*` 누수 | 켜짐 | 꺼짐 |
| 3 | `useAutomationExtension` | ChromeDriver가 자동화용 확장프로그램 설치 → fingerprint 노출 | `true` | 미설치 |
| 4 | `User-Agent`의 `HeadlessChrome` | `--headless`로 띄울 때 UA에 박힘 | `HeadlessChrome/...` | `Chrome/...` |
| 5 | `navigator.languages` 비어있음 / `en-US`만 | Headless 기본값 | `[]` 또는 `['en-US']` | `['ko-KR','ko','en-US','en']` 등 다국어 |
| 6 | `navigator.plugins.length === 0` | Headless는 PDF Viewer 등이 없음 | `0` | 보통 3~5개 |
| 7 | `window.chrome` 객체 누락 | Headless에선 `chrome.runtime` 등이 비어있음 | `undefined` | 채워짐 |
| 8 | Permissions API 모순 | `navigator.permissions.query({name:'notifications'})`가 `denied`인데 `Notification.permission`은 `default` | 모순 | 일치 |
| 9 | WebGL vendor / renderer | SwiftShader, Mesa 등 SW 렌더러 노출 | `Google Inc. (Google)` `ANGLE (...SwiftShader...)` | GPU 벤더명 |
| 10 | 데이터센터 IP / ASN | 컨테이너 호스트 IP가 AWS/GCP 등으로 식별 | DC IP | 거주용 IP |
| 11 | 비현실적 인터랙션 패턴 | 0ms 타이핑, 직선 마우스 이동, 즉시 클릭 | 너무 빠름 | 불규칙 |
| 12 | CDP 세션 흔적 | DevTools 프로토콜이 켜져 있으면 `Runtime.enable` 등 감지 가능 | 활성 | 없음 |

이 중 **1, 2, 3, 5, 6, 7, 8**은 코드만으로 가릴 수 있어서 `applyStealth()`가 처리한다. **4, 9, 10, 11, 12**는 환경/운영 이슈라 별도 조치가 필요하다 (아래 "남은 한계" 참고).

## `applyStealth()`가 적용하는 것

`createSession(browser, selenoidOptions, stealth=true)` 기본값으로 켜져 있다 (Chrome일 때만).

### 1) Chrome 실행 옵션 (`goog:chromeOptions`)

```ts
{
  args: [
    "--disable-blink-features=AutomationControlled", // (1)(2) 핵심 — webdriver 플래그 + 자동화 배너 동시 제거
    "--lang=ko-KR",                                   // (5) UI/Accept-Language
    "--window-size=1366,768",                         // 일반적 데스크톱 해상도
  ],
  excludeSwitches: ["enable-automation"],             // (2) 자동화 스위치 제거
  useAutomationExtension: false,                      // (3) 확장프로그램 미설치
  prefs: {
    "intl.accept_languages": "ko-KR,ko,en-US,en",     // (5)
    "credentials_enable_service": false,              // 비밀번호 저장 팝업 방지
    "profile.password_manager_enabled": false,
  },
}
```

### 2) CDP `Page.addScriptToEvaluateOnNewDocument`

매 navigate 직후 모든 frame이 로드되기 **이전에** 실행되므로, 첫 페이지부터 적용된다.

```js
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });    // (1)
Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR','ko','en-US','en'] }); // (5)
Object.defineProperty(navigator, 'plugins',   { get: () => [1,2,3,4,5] });  // (6) 길이만 위장
window.chrome = window.chrome || { runtime: {} };                            // (7)
// (8) Notification 권한 모순 해소
const _origQuery = navigator.permissions && navigator.permissions.query;
if (_origQuery) {
  navigator.permissions.query = (p) =>
    p && p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : _origQuery.call(navigator.permissions, p);
}
```

### 3) `Network.setUserAgentOverride`

```ts
{
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  acceptLanguage: "ko-KR,ko;q=0.9,en;q=0.8",
  platform: "MacIntel",
}
```

`HeadlessChrome` 토큰(4) 제거 + Accept-Language 헤더 정합.

## 끄는 법

stealth가 오히려 방해되는 경우 (검사 자체가 목적인 시나리오 등):

```ts
await client.createSession(browser, undefined, /* stealth */ false);
```

`createSession`의 세 번째 인자.

## 남은 한계

| 신호 | 왜 코드로 안 가리는가 | 대안 |
|---|---|---|
| (9) WebGL renderer | 컨테이너 GPU 가속이 없으면 SwiftShader가 강제로 잡힘 | 이미지 빌드 시 `--use-gl=angle` + 호스트 GPU passthrough, 또는 WebGL fingerprint를 JS로 spoof (구현 복잡, 깨지기 쉬움) |
| (10) 데이터센터 IP | Selenoid 호스트 IP 자체 | Chrome args에 `--proxy-server=http://user:pw@residential-proxy:port` 추가 |
| (11) 인터랙션 패턴 | 시나리오 작성 책임 | 검색은 `fill+press Enter` 대신 `goto https://www.google.com/search?q=...`로 우회 |
| (12) CDP 흔적 | bridge 자체가 CDP에 의존 (record/measure) | 봇 체크가 강한 페이지 navigate 전후로 CDP 세션을 닫고 다시 열기 |
| 쿠키/세션 누적 | Selenoid는 컨테이너마다 임시 프로필 | `--user-data-dir`로 영구 프로필 마운트 (Selenoid `selenoid:options.applicationContainers`로 별도 볼륨) |

## 검증

`docs/stealth-probe-result.md`에 실제 Selenoid에서 측정한 결과가 정리돼 있다.
