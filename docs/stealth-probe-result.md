# Stealth Probe 결과

`docs/stealth.md`의 대응책이 실제로 동작하는지 측정한 기록.

- 측정 환경: macOS, Selenoid 로컬 (`http://localhost:4444`), Chrome 128.0
- Probe: `scripts/stealth-probe.mjs` — 같은 `WebDriverClient`로 stealth on/off 두 세션을 띄워 같은 fingerprint를 비교
- 검증 시나리오: `scenarios/record-test.json` — google.com에서 "selenoid browser testing" 검색

## 1) Fingerprint 비교

```
$ node scripts/stealth-probe.mjs
```

| signal                     | stealth=off          | stealth=on                       |
|----------------------------|----------------------|----------------------------------|
| `navigator.webdriver`      | `true`               | `undefined` ✓                    |
| `navigator.languages`      | `["en-US","en"]`     | `["ko-KR","ko","en-US","en"]` ✓ |
| `navigator.plugins.length` | `5`                  | `5` (이미 정상)                  |
| `window.chrome.runtime`    | 없음                 | 있음 ✓                           |
| `navigator.platform`       | `Linux x86_64`       | `MacIntel` ✓                     |
| UA에 `HeadlessChrome` 포함  | `false`              | `false` (이미 정상)              |

User-Agent 전체:

- off: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36`
- on : `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36`

### 메모

- `HeadlessChrome` 토큰은 stealth off에서도 안 잡힘 → Selenoid가 Xvfb로 full Chrome을 띄우기 때문 (headless가 아님). headless 환경이라면 추가 조치 필요.
- `navigator.plugins.length`도 stealth off에서 5 → Selenoid의 Chrome 이미지에 PDF Viewer 등 기본 plugin이 그대로 있음.
- 컨테이너가 Linux인데 stealth on에선 `MacIntel`로 전송되는 platform 불일치는 Google에선 문제되지 않음(`navigator.userAgentData`까지 안 봐주는 페이지가 다수). 정밀 fingerprint를 보는 사이트(예: `bot.sannysoft.com`)에선 UA·platform·oscpu를 한 OS 계열로 통일해야 함.

## 2) Google 검색 end-to-end

```
$ node dist/index.js run scenarios/record-test.json \
    --selenoid http://localhost:4444 \
    --artifacts-dir ./artifacts/stealth-test
```

결과:

```
✓ [chrome:128.0] record-test (30297ms)
  ✓ open google · /                                   Title: Google
  ✓ start recording
  ✓ type search query · "selenoid browser testing"
  ✓ submit search                                     Title: selenoid browser testing - Google 검색
  ✓ wait for results                                  Title: selenoid browser testing - Google 검색
  ✓ stop recording
  ✓ verify results page · => selenoid

1/1 browsers passed
```

- 캡차/`unusual traffic` 페이지로 우회 안 됨
- 검색 결과 페이지 title `"selenoid browser testing - Google 검색"` 정상 노출
- `assert title contains "selenoid"` 통과

리포트: `artifacts/stealth-test/report.html`

## 3) 재현 명령

```bash
cd packages/bridge
npm run build
node scripts/stealth-probe.mjs                   # fingerprint 비교
node dist/index.js run scenarios/record-test.json \
  --selenoid http://localhost:4444 \
  --artifacts-dir ./artifacts/stealth-test       # google e2e
```

## 4) 한계 — 이번 통과가 보장하지 않는 것

- 측정한 IP는 가정용(공유기) IP였음 — 데이터센터에서 같은 코드로 재현하면 캡차 확률 급상승.
- 짧은 시간 내 같은 IP에서 검색을 반복하면 Google은 점수를 깎음. 이번 측정은 단발 실행.
- reCAPTCHA v3 점수 기반 사이트(검색 외)는 별도 휴리스틱이 추가됨 — `docs/stealth.md` "남은 한계" 표 참고.
