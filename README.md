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
      "capture": "always"
    },
    {
      "id": "signup-form-visible",
      "phase": "회원 가입",
      "name": "회원 가입 폼이 보인다",
      "action": "assert",
      "type": "visible",
      "selectorKey": "auth.signup.form",
      "capture": "always"
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
  --capture all
```

실행이 끝나면 기본적으로 `artifacts/<scenario>-<timestamp>/` 아래에 다음이 생성됩니다.

- `report.json`
- `report.html`
- `<browser>/NN-step-name-passed.png`

HTML 리포트에서는 브라우저별 성공 여부, 단계별 URL/title, 실패 메시지, 스크린샷을 바로 볼 수 있습니다.
