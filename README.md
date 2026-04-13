# selenoid-bridge

`selenoid-bridge` 는 사용자 여정을 시나리오 JSON 으로 정의하고, Selenoid 에서 실행한 뒤 단계별 캡처와 리포트를 남기는 CLI 입니다.

## Standard Scenario Shape

추천 작성 방식은 사용자 여정 중심입니다.

- `selectors`: 서비스별 실제 selector를 모아두는 사전
- `steps[].selectorKey`: step 에서 selector 사전 키만 참조
- `journey.phases`: 비즈니스 단계 목록
- `steps[].phase`: 어떤 단계에 속하는지
- `steps[].name`: 사람이 읽는 체크포인트 이름
- `steps[].capture`: `always`, `failure`, `off`
- `steps[].note`: selector 교체나 검증 의도를 적는 메모

예시:

```json
{
  "name": "회원 가입 후 결제",
  "baseUrl": "https://shop.example.com",
  "selectors": {
    "auth.signup.form": {
      "css": "[data-testid='auth.signup.form']",
      "strategy": "data-testid"
    }
  },
  "journey": {
    "actor": "guest-to-buyer",
    "goal": "회원 가입 후 상품을 결제한다",
    "phases": ["회원 가입", "홈 이동", "상품 선택", "결제"]
  },
  "steps": [
    {
      "id": "signup-page",
      "phase": "회원 가입",
      "name": "회원 가입 페이지로 이동한다",
      "action": "goto",
      "url": "/signup",
      "capture": "failure"
    },
    {
      "id": "signup-form-visible",
      "phase": "회원 가입",
      "name": "회원 가입 폼이 보인다",
      "action": "assert",
      "type": "visible",
      "selectorKey": "auth.signup.form",
      "capture": "failure"
    }
  ]
}
```

## Recommended data-testid Convention

권장 규칙은 `domain.surface.element` 입니다.

- `auth.signup.form`
- `auth.signup.submit`
- `home.main`
- `catalog.product.first`
- `product.detail.summary`
- `checkout.summary`
- `checkout.submit`

핵심은 step 에 raw selector를 반복하지 않고, `selectors` 에서 한 번만 정의하는 것입니다.

## Supported Actions

| Action | Required fields | Behavior |
| --- | --- | --- |
| `goto` | `url` | Opens an absolute URL or a path relative to `baseUrl`. |
| `click` | `selector` or `selectorKey` | Finds the element and clicks it. |
| `fill` | `selector` or `selectorKey`, `value` | Clears the target input and types the value. |
| `select` | `selector` or `selectorKey`, `value` | Opens a select element and chooses `option[value='<value>']`. |
| `check` | `selector` or `selectorKey` | Checks selected state first and only clicks when the element is not selected. |
| `hover` | `selector` or `selectorKey` | Moves the mouse pointer to the element without clicking. |
| `scroll` | `selector`/`selectorKey` or `direction` | Scrolls the element into view and/or scrolls the page `up` or `down`; optional `amount` defaults to 600px. |
| `press` | `key` | Sends a keyboard key such as `Enter`, `Tab`, or `Escape`. |
| `wait` | `ms`, `selector`, or `selectorKey` | Waits for a duration or for an element to become visible. |
| `assert` | `type` plus required fields | Supports `visible`, `hidden`, `text`, `title`, `url`, and `value`. |

Examples:

```json
{ "action": "hover", "selectorKey": "nav.account" }
{ "action": "check", "selectorKey": "terms.accept" }
{ "action": "scroll", "selectorKey": "section.pricing" }
{ "action": "scroll", "direction": "down", "amount": 800 }
```

## Templates

빈 템플릿:

```bash
node dist/index.js create "smoke" --url https://example.com
```

커머스 체크아웃 템플릿:

```bash
node dist/index.js create "checkout-flow" \
  --url https://shop.example.com \
  --template commerce-checkout
```

저장소 안의 기준 예시는 `examples/commerce-checkout.json` 입니다.

## Run And Review

```bash
node dist/index.js run checkout-flow.json \
  --selenoid http://localhost:4444 \
  --browsers chrome:128.0 \
  --concurrency 5 \
  --request-timeout 30000 \
  --capture failure
```

실행이 끝나면 기본적으로 `artifacts/<scenario>-<timestamp>/` 아래에 다음이 생성됩니다.

- `report.json`
- `report.html`
- `<browser>/NN-step-name-passed.png`

`--capture failure` 가 기본값입니다. 모든 단계 스크린샷이 필요할 때만 `--capture all` 을 사용하세요. `--concurrency` 는 Selenoid `-limit` 이하로 맞추는 것을 권장합니다.

## Browser Version Selection

`--browsers` 는 쉼표로 구분한 `browser[:version]` 목록입니다.

```bash
node dist/index.js run smoke.json --browsers chrome
node dist/index.js run smoke.json --browsers chrome:128.0
node dist/index.js run smoke.json --browsers chrome:116.0,chrome:122.0,chrome:128.0
```

버전을 생략한 `chrome` 은 Selenoid `browsers.json` 의 `chrome.default` 를 사용합니다. `chrome:128` 처럼 prefix만 넘기면 Selenoid는 `versions` 안에서 `128` 로 시작하는 버전, 예를 들어 `128.0`, 을 찾습니다. 여러 버전을 선택하려면 Selenoid 쪽 `browsers.json` 에 각 버전이 등록되어 있고 해당 Docker image가 미리 pull되어 있어야 합니다.

```json
{
  "chrome": {
    "default": "128.0",
    "versions": {
      "116.0": { "image": "selenoid/chrome:116.0", "port": "4444", "path": "/" },
      "122.0": { "image": "selenoid/chrome:122.0", "port": "4444", "path": "/" },
      "128.0": { "image": "selenoid/chrome:128.0", "port": "4444", "path": "/" }
    }
  }
}
```

설정만 추가해도 이미지를 자동으로 받지는 않습니다. 실행 전에 필요한 이미지를 준비하세요.

```bash
docker pull selenoid/chrome:116.0
docker pull selenoid/chrome:122.0
docker pull selenoid/chrome:128.0
pkill -HUP -f selenoid-test
```

## Capture Control From The Runner

`--selenoid` 는 원격으로 실행 가능한 브라우저 엔진 주소입니다. 따라서 캡처 정책은 Selenoid 서버 설정에 고정하지 않고, 실행하는 쪽에서 `run` 옵션으로 켜고 끌 수 있어야 합니다.

새로 생성되는 템플릿은 기본적으로 `"capture": "failure"` 를 넣어 성공 단계의 스크린샷 IO를 줄입니다. 이전처럼 모든 단계 캡처가 필요하면 시나리오 파일을 고치지 않고 실행할 때 다음처럼 켭니다.

```bash
node dist/index.js run checkout-flow.json \
  --selenoid http://remote-selenoid:4444 \
  --browsers chrome:128.0 \
  --capture all
```

캡처를 완전히 끄려면 실행하는 쪽에서 `--capture off` 를 사용합니다.

```bash
node dist/index.js run checkout-flow.json \
  --selenoid http://remote-selenoid:4444 \
  --browsers chrome:128.0 \
  --capture off
```

시나리오 자체를 이전 동작으로 되돌리고 싶다면 각 step의 `"capture": "failure"` 를 `"capture": "always"` 로 바꾸면 됩니다. 다만 실행 옵션이 우선하므로, 시나리오가 `"always"` 여도 `--capture off` 로 끌 수 있고, 시나리오가 `"failure"` 여도 `--capture all` 로 전체 캡처를 켤 수 있습니다.

HTML 리포트에서는 브라우저별 성공 여부, 단계별 URL/title, 실패 메시지, 스크린샷을 바로 볼 수 있습니다.
