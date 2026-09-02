# 경쟁 도구 조사와 제품 차별화 제안

- 조사일: 2026-09-02 (Asia/Seoul)
- 범위: 실제 Chrome/CDP 연결, 셸 UX, 에이전트 사용성, 로컬 웹앱 관찰·진단
- 조사 방식: 각 프로젝트의 공식 문서·공식 저장소를 우선 확인했다. 커뮤니티 CLI는 해당 프로젝트 저장소의 README를 1차 자료로 취급했다.
- 신선도: 아래 내용은 조사일에 각 링크의 기본 브랜치에서 확인한 스냅샷이다. 빠르게 변하는 프로젝트이므로 구현·출시 직전에 다시 확인해야 한다.

## 읽는 법

- **사실**: 링크된 1차 자료에 명시된 내용이다.
- **관찰**: 조사한 문서 표면에서 확인되거나 확인되지 않은 내용이다. 코드 전체에 기능이 없다는 단정은 아니다.
- **추론/제안**: 사실과 관찰을 바탕으로 이 프로젝트에 권고하는 선택이다.

## 결론

**추론/제안 — 포지셔닝:**

> 자동화 스크립트를 작성하지 않고도 Chrome에서 깨진 웹앱을 신뢰할 수
> 있고 공유 가능한 버그 리포트로 바꾸는 진단 CLI.

Playwright가 브라우저 workflow를 자동화하고 DevTools 도구가 브라우저를
깊게 탐색한다면, Chroma는 실제 Chrome 탭에서 발생한 실패를 포착해
provenance가 확인되는 인계용 증거로 패키징한다.

단순히 “MCP보다 가벼운 CDP CLI”, “기존 Chrome에 연결”, “접근성 스냅샷으로 클릭”, “JSON 출력”을 내세워서는 차별화되지 않는다. 공식 Chrome DevTools MCP에도 실험적 CLI가 있고, Playwright CLI도 기존 Chrome 연결과 콘솔·네트워크 관찰을 제공한다. 커뮤니티에는 직접 CDP, 데몬, JSON, 안정적인 탭 별칭, 콘솔·네트워크 버퍼까지 구현한 Rust CLI도 있다.

따라서 차별점은 프로토콜 운반이나 자동화 명령 수가 아니라 다음 네 가지가 되어야 한다.

1. `doctor`: 연결 실패를 나열하는 대신 Chrome 버전, 실행 파일, 원격 디버깅 상태, 엔드포인트, 프로필 격리, 포트 노출을 검사하고 바로 실행할 수정 명령을 제시한다.
2. 실패 중심 질의: `errors`와 `network --failed`가 원시 로그 전체가 아니라 개발자가 바로 조치할 수 있는 실패 집합을 안정된 스키마로 반환한다.
3. 정직한 관찰 모델: 수집 시작 시각, 탐색 경계, 누락·드롭 여부, 선택한 탭을 결과에 포함한다. 연결 전에 발생한 이벤트를 본 것처럼 표현하지 않는다.
4. `report`: page/snapshot/screenshot/console exception/failed request/환경 정보를 동일한 관찰 창에서 모으고, 기본 비밀정보 제거와 provenance를 포함한 공유 가능한 증거 패킷을 만든다.

`click`, `fill`, `press`, `snapshot`, `screenshot`은 필요한 MVP이지만 시장 차별점이 아니라 진단을 재현하기 위한 보조 기능으로 다루는 편이 맞다.

## 경쟁 지형

| 도구 | 주된 제품 형태 | 기존 Chrome 연결 | 관찰·진단 표면 | 셸/기계 출력 | 이 프로젝트가 피해야 할 복제 |
| --- | --- | --- | --- | --- | --- |
| Chrome DevTools MCP + CLI | 공식 MCP 서버와 실험적 데몬형 CLI | URL/WS endpoint, Chrome 144+ auto-connect | snapshot, console, network, screenshot, trace, Lighthouse, heap | CLI의 raw JSON 지원 | MCP 도구를 1:1 CLI 하위 명령으로 생성 |
| Playwright CLI | 코딩 에이전트용 상태 유지 CLI | CDP URL/channel, 확장 연결 | snapshot, action, console, requests, trace, recording/video | 파일/표준출력 중심; README에서 전역 JSON 계약은 확인 못함 | 범용 브라우저 자동화·테스트 CLI |
| Playwright MCP | 접근성 트리 기반 MCP | CDP endpoint, 확장 연결 | action, console, network detail, trace 등 | MCP structured tool result | 풍부한 장기 에이전트 루프 |
| Puppeteer 계열 | JavaScript 라이브러리 + 브라우저 관리/replay CLI | `puppeteer.connect()` | API로 거의 모든 자동화·CDP 접근 | 앱이 직접 설계해야 함 | 라이브러리 API를 얇게 CLI로 감싸기 |
| chrome-remote-interface | 저수준 CDP 라이브러리 + REPL/target CLI | 기본 localhost:9222 및 endpoint | 임의 CDP 명령·이벤트 | 원시 객체/REPL | 범용 CDP 셸 또는 메서드 전달기 |
| aeroxy/chrome-devtools-cli | Rust 직접-CDP CLI + 데몬 | Chrome/Edge 자동 발견, WS endpoint | snapshot, action, console/network drain, heap, emulation | JSON/TOON | “가벼움·직접 CDP·기존 Chrome·데몬” 자체 |
| browser-debugger-cli (`bdg`) | 에이전트용 직접-CDP CLI | 지속 세션 | 644개 raw CDP, DOM/network 래퍼, HAR/memory | JSON 기본, semantic exit codes | self-discovery/raw CDP/토큰 효율 자체 |
| chrome-cdp-cli (`cdp`) | 직접-CDP 자동화 CLI | localhost:9222 | eval, DOM, action, log/network follow | text/JSON, 일부 exit codes | 범용 `eval` + selector action CLI |

### “cdp-shell” 명칭에 관한 조사 한계

**관찰:** 조사 범위에서는 현재 널리 쓰이는 단일 정본 프로젝트 이름 `cdp-shell`을 확인하지 못했다. 대신 이 범주를 가장 오래되고 명확하게 대표하는 1차 자료로 `chrome-remote-interface`의 번들 `inspect` REPL을 비교했다. 이 도구는 target 관리 하위 명령과 자동완성이 있는 CDP REPL을 제공한다. 따라서 문서에서 “cdp-shell 계열”은 특정 브랜드가 아니라 원시 CDP 명령/이벤트를 대화형으로 전달하는 도구군을 뜻한다.

## 도구별 조사

### 1. Chrome DevTools MCP와 실험적 Chrome DevTools CLI

**사실:** 공식 프로젝트는 라이브 Chrome을 제어·검사하는 MCP 서버이며, 성능 trace/insight, 네트워크 요청, 콘솔, screenshot, accessibility snapshot, Lighthouse, heap snapshot까지 넓은 DevTools 표면을 제공한다. 자동화 동작은 Puppeteer를 사용한다. [공식 README](https://github.com/ChromeDevTools/chrome-devtools-mcp) · [도구 레퍼런스](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)

**사실:** 같은 npm 패키지에 실험적 `chrome-devtools` CLI가 포함되어 있다. 첫 도구 호출이 백그라운드 MCP 데몬과 브라우저를 자동 시작하고, 후속 호출은 같은 상태를 재사용한다. 명령은 대체로 MCP 도구 이름을 그대로 노출하며 `--output-format=json`을 지원한다. 일부 도구와 서버 인자는 CLI 생성에서 제외된다. [CLI 문서](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md)

**사실:** 기존 브라우저에는 `--browser-url`, `--ws-endpoint`로 연결할 수 있고, Chrome 144+에는 `chrome://inspect/#remote-debugging`에서 허용한 인스턴스를 찾는 `--auto-connect`가 있다. auto-connect는 선택된 프로필의 열린 모든 창에 접근하며 사용자 허용 대화상자를 표시한다. [연결 설정](https://github.com/ChromeDevTools/chrome-devtools-mcp#connecting-to-a-running-chrome-instance)

**사실:** 콘솔·네트워크 목록은 마지막 navigation 이후를 기본 범위로 하며, 보존 옵션으로 최근 3개 navigation을 포함할 수 있다. 네트워크 목록 필터는 문서상 resource type 기준이고 콘솔은 type과 stack trace 옵션을 제공한다. [도구 레퍼런스](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md#list_network_requests)

**사실:** MCP는 브라우저 내용을 클라이언트에 노출하고 수정할 수 있다고 경고한다. 수동 원격 디버깅 포트는 로컬의 어떤 앱도 연결해 브라우저를 제어할 수 있으므로 민감한 사이트를 열지 말라고 명시한다. 사용 통계는 기본 활성화이며 비활성화할 수 있고, 성능 기능은 CrUX API를 호출할 수 있다. [README의 disclaimer·통계·연결 경고](https://github.com/ChromeDevTools/chrome-devtools-mcp)

**사실:** CLI용 공식 skill은 기본적으로 파일 저장·업로드에 unrestricted filesystem access를 허용하고, 플래그로 OS 임시 디렉터리에 제한할 수 있다고 설명한다. [CLI skill](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/chrome-devtools-cli/SKILL.md#permissions--file-access)

**관찰:** 문서에는 여러 원천의 런타임 실패를 하나의 `errors` 의미 모델로 합치는 명령, 실패 요청 전용 명령, 연결 상태를 원인별로 판정하는 `doctor`, 동시점 증거를 묶는 범용 `report` 명령은 보이지 않는다. 다만 성능과 Lighthouse에는 별도 분석/report 기능이 있다.

**함의:** 가장 강한 직접 경쟁자다. “Chrome DevTools를 CLI에서 쓴다”는 설명으로는 이길 수 없다. Chroma는 도구 폭보다 진단 질문에 대한 단일 답과 증거 무결성에 집중해야 한다.

### 2. Playwright CLI

**사실:** Microsoft의 Playwright CLI는 코딩 에이전트용 CLI를 명시적으로 표방하며, MCP보다 도구 스키마와 큰 접근성 트리를 모델 문맥에 싣지 않아 토큰 효율적이라고 설명한다. 세션별로 브라우저 상태를 유지하며 persistent profile도 지원한다. [공식 README](https://github.com/microsoft/playwright-cli)

**사실:** `snapshot`, `click`, `fill`, `press`, screenshot뿐 아니라 console, 전체 request 목록·상세, tracing, action recording, video, network mocking을 제공한다. snapshot은 파일로 남고 ref, CSS selector, Playwright locator 모두로 대상을 지정할 수 있다. [명령 목록](https://github.com/microsoft/playwright-cli#commands)

**사실:** 현재 문서는 `attach --cdp=chrome`, `attach --cdp=<url>`, `attach --extension=chrome`, `detach`를 명시한다. 즉 기존 실제 Chrome 연결 자체도 차별점이 아니다. [attach 명령](https://github.com/microsoft/playwright-cli#open-parameters)

**사실:** 여러 세션을 관리하고 live screencast grid에서 사람이 에이전트 세션을 관찰·인수할 수 있는 `show` 대시보드도 제공한다. [세션 모니터링](https://github.com/microsoft/playwright-cli#monitoring)

**관찰:** README는 file/stdout output mode는 설명하지만, 모든 명령이 공유하는 versioned JSON envelope와 exit-code 의미 계약은 문서화하지 않는다. request 목록은 전체 요청이며, 문서화된 `--failed` 전용 필터나 통합 진단 report/doctor는 확인되지 않는다.

**함의:** Chroma가 범용 action 수, locator 다양성, cross-browser, recording, trace viewer로 경쟁하면 불리하다. “로컬 앱이 왜 깨졌나?”를 적은 명령과 작은 결과로 답하는 쪽이 유효하다.

### 3. Playwright MCP

**사실:** Playwright MCP는 screenshot 인식보다 구조화된 accessibility snapshot을 사용해 결정론적으로 페이지를 조작하는 MCP 서버다. core 도구에 console messages와 network request 목록·상세가 있고, 실행 중인 Chrome에는 CDP endpoint 또는 확장으로 연결한다. [공식 README](https://github.com/microsoft/playwright-mcp)

**사실:** origin allow/block와 파일 접근 guardrail을 제공하지만 이 서버 자체를 보안 경계로 보지 말라고 명시한다. `browser_run_code_unsafe`는 서버 프로세스에서 임의 JavaScript를 실행하므로 RCE와 동등하다고 표시되어 있다. [설정·보안](https://github.com/microsoft/playwright-mcp#configuration) · [도구 목록](https://github.com/microsoft/playwright-mcp#tools)

**함의:** 풍부한 대화형 탐색과 장기 자동화는 MCP의 강점이다. Chroma의 셸 UX는 MCP를 흉내 내기보다 한 호출의 결과가 파이프·CI·이슈 첨부물로 완결되는 데 초점을 맞춰야 한다.

### 4. Playwright 라이브러리의 CDP 연결

**사실:** `chromium.connectOverCDP()`는 기존 Chromium 계열 브라우저에 HTTP 또는 WebSocket CDP endpoint로 연결한다. 공식 문서는 이 연결이 Playwright protocol보다 “significantly lower fidelity”라고 경고하며, Playwright가 기대하는 실행 인자와 다르게 브라우저를 띄우면 일부 기능이 깨질 수 있다고 설명한다. [BrowserType.connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)

**사실:** 현재 API에는 daily-driver Chrome에 연결할 때 기본 context override를 줄이는 `noDefaults` 옵션도 있다. 같은 문서는 기본 Chrome 프로필 자동화 대신 별도 user-data directory 사용을 권한다. [같은 API 문서](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)

**함의:** Chroma가 Playwright 기반이면 기존 Chrome에서 fidelity/launch-argument 차이를 숨기면 안 된다. 직접 CDP는 Chrome 전용이라는 대가로 관찰 의미를 더 정확히 제어할 수 있다.

### 5. Puppeteer 계열

**사실:** Puppeteer는 Chrome/Firefox를 DevTools Protocol 또는 WebDriver BiDi로 제어하는 고수준 JavaScript 라이브러리이고, `puppeteer.connect()`로 기존 브라우저에 붙을 수 있다. `puppeteer-core`는 브라우저를 다운로드하지 않는 프로그래밍 인터페이스다. [Puppeteer README](https://github.com/puppeteer/puppeteer) · [`connect()` API](https://pptr.dev/api/puppeteer.puppeteer.connect)

**사실:** `@puppeteer/browsers` CLI의 목적은 브라우저/드라이버 install, launch, clear, list 관리다. `@puppeteer/replay` CLI는 DevTools Recorder가 만든 user-flow JSON을 재생·변환한다. 이들은 범용 대화형 진단 CLI가 아니다. [`@puppeteer/browsers`](https://github.com/puppeteer/puppeteer/blob/main/packages/browsers/README.md) · [`@puppeteer/replay`](https://github.com/puppeteer/replay)

**함의:** Puppeteer는 좋은 구현 부품일 수 있지만 “Puppeteer를 쉘로 노출”하는 것만으로 제품 가치가 생기지 않는다. 브라우저 설치·테스트 flow 재생도 MVP의 중심이 아니다.

### 6. chrome-remote-interface / CDP 셸 계열

**사실:** `chrome-remote-interface`는 CDP command와 notification의 간단한 JavaScript 추상화다. 번들 CLI는 target list/new/activate/close/version을 지원하고, `inspect` 하위 명령은 자동완성과 embedded protocol metadata가 있는 REPL에서 임의 CDP method를 실행하고 event handler를 등록한다. [공식 저장소](https://github.com/cyrus-and/chrome-remote-interface#bundled-client)

**사실:** CDP 자체는 domain별 command/event를 JSON 객체로 전송한다. tip-of-tree protocol은 자주 바뀌며 하위 호환이 보장되지 않고, 안정판 1.3은 Chrome 64 시기의 더 작은 부분집합이다. 브라우저 endpoint와 target 목록은 `/json/version`, `/json/list`에서 찾을 수 있다. [공식 CDP 문서](https://chromedevtools.github.io/devtools-protocol/)

**함의:** raw CDP passthrough는 escape hatch로는 유용하지만 제품 중심이면 사용자가 protocol domain, enable 순서, event lifetime, target session을 직접 이해해야 한다. Chroma는 안정된 작은 의미 모델 위에 제한적인 raw escape hatch를 나중에 둘 수 있다.

### 7. 커뮤니티 직접-CDP CLI

#### aeroxy/chrome-devtools-cli

**사실:** Rust 단일 CLI로 기존 Chrome/Edge의 `DevToolsActivePort`를 찾아 직접 CDP에 연결한다. endpoint별 백그라운드 데몬이 연결과 Network/Runtime event buffer를 유지한다. 안정적인 단어 쌍 target 이름, accessibility snapshot, selector action, JSON/TOON, console/network drain을 제공한다. [프로젝트 README](https://github.com/aeroxy/chrome-devtools-cli)

**사실:** console/network는 마지막 drain 또는 attach 이후 누적된 이벤트를 소비한다. resource type과 console level filter는 있지만 README 명령 표에는 failed-request 전용 필터가 없다. `doctor`와 통합 report도 README에서 확인되지 않는다. [Network and console inspection](https://github.com/aeroxy/chrome-devtools-cli#network-and-console-inspection)

**함의:** “가벼운 Rust”, “직접 CDP”, “기존 브라우저 자동 연결”, “데몬으로 이벤트 유지”, “안정 탭 별칭”은 이미 구현된 차별점이다. Chroma가 Node로 시작해도 괜찮지만 속도/크기만을 핵심 주장으로 삼으면 안 된다.

#### browser-debugger-cli (`bdg`)

**사실:** persistent Chrome 연결과 Unix pipe 조합을 내세우며, raw CDP 644개 method를 progressive discovery로 노출한다. JSON 기본, semantic exit code, structured error, HAR export와 memory profiling을 주장하며 현재 high-level wrapper는 추가 중이라고 밝힌다. Windows는 WSL만 지원하고 패키지는 alpha다. [프로젝트 README](https://github.com/szymdzum/browser-debugger-cli)

**함의:** “agent-friendly/self-documenting/semantic exit codes/JSON”도 단독 차별점이 아니다. 대신 고수준 실패 분류의 정확성과 보고서 품질을 증명해야 한다.

#### chrome-cdp-cli (`cdp`)

**사실:** `eval`, screenshot, DOM, log/network follow, selector 기반 action과 text/JSON 출력을 제공한다. exit code는 success/general/connection/invalid arguments로 나눈다. Chrome 136+에서는 별도 user-data-dir이 필요하다고 문서화한다. [프로젝트 README](https://github.com/nicoster/chrome-devtools-cli)

**함의:** 짧은 명령명과 Unix pipe는 참고할 만하지만, 임의 page JavaScript 실행을 기본 해결책으로 밀면 안전 경계와 결과 스키마가 약해진다.

## 기능별 빈틈과 제품 요구사항

### `doctor`: 설치 확인이 아니라 원인 판정

**관찰:** 경쟁 도구 대부분은 troubleshooting 문서나 `status`는 있지만, 조사한 주 명령 표면에는 연결 원인을 단계별로 검사하는 `doctor`가 없다.

**추론/제안:** `doctor`는 다음 검사를 순서대로 수행하고 각 항목을 `pass | warn | fail | skipped`로 반환해야 한다.

- 지원 OS/Node 버전과 Chrome 실행 파일 발견
- Chrome 버전 및 Chrome 136/144 경계에 맞는 연결 방식
- 명시한 endpoint의 loopback 여부, TCP reachability, `/json/version` 응답
- protocol version과 browser product 확인
- `/json/list`의 page target 수 및 attach 가능성
- launch 모드의 user-data-dir이 기본 프로필과 다른지
- 포트가 wildcard interface에 노출됐는지와 민감 profile 위험
- stale PID/socket/session state
- 실패마다 copy-paste 가능한 `next_steps[]`

`doctor --json`도 정상 결과와 같은 envelope를 써야 하며, 사용법 오류·Chrome 미발견·endpoint 거부·protocol 불일치를 서로 다른 machine code로 내야 한다.

### `errors`: 로그 덤프가 아니라 실패 정규화

**추론/제안:** 다음 원천을 하나의 시간순 event schema로 정규화한다.

- `Runtime.exceptionThrown`: uncaught exception/rejection, stack
- `Runtime.consoleAPICalled`: `console.error`, 필요 시 warning
- `Log.entryAdded`: browser/security/deprecation/violation 계열
- 선택적으로 failed resource와 연관된 initiator stack

중복 stack/message는 fingerprint로 묶고 `count`, `first_seen`, `last_seen`, `source`, `url`, `line`, `column`을 보존한다. 기본은 error만, `--level warn`으로 넓힌다. 앱의 error 발견과 CLI 자체 실패는 다른 exit 의미여야 한다.

### `network --failed`: 두 종류의 실패를 구분

**추론/제안:** 최소한 아래를 섞지 않고 반환한다.

- HTTP 실패: response를 받았지만 status가 4xx/5xx
- transport 실패: `Network.loadingFailed`의 DNS/TLS/CORS/cancelled/blocked 등

각 record에는 `request_id`, method, URL, resource type, status/error text, initiator, start/end time을 둔다. header/body/cookie는 기본 보고서에서 제외하거나 redaction한다. `--all`, `--status`, `--type`, `--since`, `--limit`로 점진적으로 넓힌다.

### 관찰 창: 이 제품의 기술적 핵심

**사실:** CDP의 오류와 네트워크는 event stream이다. attach 후 domain을 enable해야 이후 이벤트를 받을 수 있다. CDP tip-of-tree는 변경될 수 있다. [공식 CDP 문서](https://chromedevtools.github.io/devtools-protocol/)

**추론/제안:** 모든 관찰 결과에 아래 provenance를 포함한다.

```json
{
  "observation": {
    "startedAt": "2026-09-02T12:34:56.000Z",
    "endedAt": "2026-09-02T12:35:01.000Z",
    "navigationId": "...",
    "targetId": "...",
    "completeSinceNavigation": true,
    "droppedEvents": 0
  }
}
```

프로세스가 attach하기 전에 일어난 오류는 복구할 수 없으므로 `completeSinceNavigation: false`로 표시한다. drain 방식 대신 cursor/checkpoint를 두어 `errors`, `network`, `report` 호출 순서가 서로의 증거를 파괴하지 않게 하는 편이 낫다. 버퍼 상한과 dropped count를 명시한다.

### `report`: 공유 가능한 진단 증거 패킷

**추론/제안:** `report`는 임의 분석문이 아니라 안정된 manifest와 artifact 집합이어야 한다.

```text
report/
  manifest.json
  summary.md
  page.json
  snapshot.txt
  screenshot.png
  errors.json
  failed-network.json
```

`manifest.json`에는 CLI/schema/browser/protocol 버전, target identity, 관찰 창, 실행한 수집 단계, 단계별 성공·실패, redaction 정책, 누락 이유를 넣는다. 한 구성요소가 실패해도 가능한 artifact를 남기는 partial-success 모델이 유용하다. 기본적으로 Cookie, Authorization, Set-Cookie, query secret 후보, request/response body는 제거하고 사용자가 명시적으로 확장하게 한다.

## 셸 네이티브 계약 제안

이 부분은 “에이전트 친화”라는 추상적 문구보다 테스트 가능한 공개 계약이어야 한다.

- 사람이 보는 text는 TTY에 맞추되 `--json`은 stdout에 JSON 하나만 출력한다.
- progress, warning, remediation은 stderr로 보낸다.
- 모든 JSON은 `schemaVersion`, `command`, `ok`, `data`, `warnings`, `error`를 공유한다.
- entity ID는 Chrome target ID와 별도로 짧고 세션 내 안정적인 handle을 제공하되 JSON에는 둘 다 둔다.
- action은 최신 snapshot ref와 target을 요구하고 stale ref를 명확한 오류로 거절한다.
- pipe가 끊긴 EPIPE는 stack trace 없이 정상적으로 종료한다.
- 색상은 TTY에서만, `NO_COLOR`를 존중한다.
- `--timeout`, `--target`, `--json`의 위치·이름을 모든 명령에서 일관되게 유지한다.
- exit code는 CLI 실행 실패를 표현한다. 페이지에서 오류를 찾은 것은 데이터이며, CI용으로만 `--fail-on findings`를 제공한다.

권장 exit code 범주:

| 코드 | 의미 |
| --- | --- |
| 0 | 명령 실행 성공 |
| 2 | 사용법/검증 오류 |
| 3 | Chrome 발견·실행 실패 |
| 4 | endpoint/CDP 연결 실패 |
| 5 | target 없음·stale target/ref |
| 6 | command timeout |
| 7 | 부분 report를 만들었으나 필수 수집 단계 실패 |
| 10 | `--fail-on findings` 조건 충족 |

숫자 자체보다 문서화된 안정성과 JSON의 `error.code` 대응이 중요하다.

## 보안 경계

**사실:** Chrome은 credential 탈취에 remote debugging이 악용되는 것을 줄이기 위해 Chrome 136부터 기본 데이터 디렉터리에 대한 `--remote-debugging-port`/`--remote-debugging-pipe`를 무시한다. 별도 `--user-data-dir`을 요구하고, 자동화에는 Chrome for Testing을 권장한다. [Chrome 공식 공지](https://developer.chrome.com/blog/remote-debugging-port)

**추론/제안:** 기본 정책은 다음과 같아야 한다.

- `launch`는 임시 또는 명시적 전용 profile을 만들고 기본 daily profile을 재사용하지 않는다.
- `connect`는 loopback endpoint만 기본 허용한다. 비-loopback WS/TCP에는 명시적 opt-in과 경고를 요구한다.
- endpoint/WS URL에 credential이 들어간 경우 출력과 report에서 제거한다.
- 실제 사용자 profile에 auto-connect할 때 “열린 모든 탭·쿠키·스토리지에 접근 가능”을 표시한다.
- report는 request/response body와 인증 header를 기본 수집하지 않는다.
- 임의 JavaScript 실행, 파일 upload/download, raw CDP는 MVP 기본 표면에서 제외하거나 unsafe 표식을 붙인다.
- 제품 telemetry와 외부 서비스 호출은 기본 off로 두고, target 앱과 loopback Chrome 외 네트워크를 쓰면 명시한다.

이 CLI는 sandbox도 security boundary도 아니다. CDP 권한은 사실상 해당 브라우저 profile에 대한 강한 제어 권한이다.

## 의도적으로 경쟁하지 않을 영역

- cross-browser test runner, assertion DSL, retry/sharding/trace viewer
- 수백 개 CDP method의 완전 노출
- 좌표 기반 vision automation
- 장시간 자율 에이전트의 MCP state loop
- performance/Lighthouse/heap 분석의 전체 DevTools 대체
- 로그인된 daily profile을 마찰 없이 자동화하는 기능

이 선택은 기능 부족을 숨기기 위한 것이 아니라 “로컬 앱 문제를 빠르게 분류하고 증거를 남긴다”는 작업을 선명하게 하기 위한 것이다.

## 트레이드오프

| 선택 | 얻는 것 | 잃는 것/대응 |
| --- | --- | --- |
| Chrome/CDP 전용 | DevTools event 의미와 실제 Chrome 연결을 직접 제어 | Firefox/WebKit 범위 상실; Playwright를 추천할 명확한 기준 문서화 |
| 작고 opinionated한 명령 집합 | 학습·출력·테스트 계약이 작음 | rare CDP 기능 부족; 후순위 raw escape hatch 고려 |
| background observer | 명령 사이 console/network event 보존 | lifecycle/stale state 복잡성; `doctor`, idle timeout, explicit stop 필요 |
| non-destructive cursor | report와 개별 질의가 같은 증거를 재사용 | 메모리 증가; ring buffer와 dropped counter 필요 |
| 기본 redaction | report 공유 안전성 향상 | 일부 원인 데이터 은닉; `--include-sensitive`를 강한 경고와 함께 opt-in |
| JSON schema 안정성 | jq/CI/에이전트 모두 신뢰 가능 | 버전 관리 비용; fixture/golden contract test 필요 |
| read-mostly 중심 | 실수 위험이 낮고 진단 목적이 명확 | 자동화 범위 작음; click/fill/press는 재현 보조로 제한 |

## MVP 우선순위와 수용 기준

아래는 조사 당시의 구현 제안이다. 현재 충족 여부와 실제 실행 증거는
[`docs/validation.md`](validation.md)를 정본으로 본다.

사용자가 지정한 MVP 명령은 모두 필요하지만, 제품 가치 기준으로 묶으면 다음과 같다.

1. **연결 신뢰성:** `doctor`, `launch`, `connect`, `tabs`
   - 실제 Chrome/CfT에서 원인별 오류, 별도 profile, loopback 기본, stable target 선택을 검증한다.
2. **관찰 신뢰성:** `errors`, `network --failed`
   - attach 이전 누락을 표시하고 HTTP/transport 실패를 fixture로 구분한다.
3. **증거 전달:** `report`, `screenshot`, `snapshot`
   - partial report, redaction, manifest, 동일 관찰 창을 golden test로 검증한다.
4. **가벼운 재현:** `click`, `fill`, `press`
   - snapshot ref 기반 성공, stale ref 거절, action 후 관찰 정보 보존을 검증한다.
5. **공통 계약:** 전 명령 `--json`, stderr 분리, exit code, timeout/EPIPE
   - text와 JSON 모두 E2E에서 검증하고 JSON schema fixture를 고정한다.

## 오픈소스 채택 관점

**추론/제안:** 별 개수는 기능 수보다 30초 안에 느끼는 효용과 신뢰에서 나올 가능성이 크다. README 첫 화면은 범용 자동화 데모 대신 깨진 fixture에 대해 다음과 같은 흐름을 보여주는 편이 좋다.

```sh
chroma doctor
chroma connect
chroma errors
chroma network --failed
chroma report --output .chroma/report
```

그리고 report가 “API 500, 그 요청을 시작한 UI action, 동시에 발생한 uncaught exception, screenshot”을 한 묶음으로 보여주는 실제 출력 예시를 둔다. 경쟁 제품을 깎아내리기보다 다음 선택 기준을 솔직히 제시한다.

- 테스트 suite와 cross-browser가 필요하면 Playwright.
- 깊은 performance/heap/Lighthouse가 필요하면 Chrome DevTools MCP.
- 임의 CDP command가 필요하면 `bdg` 또는 chrome-remote-interface.
- 로컬 앱 실패를 빠르게 수집·공유하려면 Chroma.

이 비교가 성립하려면 `report`의 품질, 기본 redaction, 진단 메시지, 실제 Chrome E2E가 README의 주장과 정확히 일치해야 한다.

## 1차 자료 목록

- [ChromeDevTools/chrome-devtools-mcp README](https://github.com/ChromeDevTools/chrome-devtools-mcp)
- [Chrome DevTools MCP CLI](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md)
- [Chrome DevTools MCP tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)
- [Chrome DevTools CLI skill](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/chrome-devtools-cli/SKILL.md)
- [microsoft/playwright-cli README](https://github.com/microsoft/playwright-cli)
- [microsoft/playwright-mcp README](https://github.com/microsoft/playwright-mcp)
- [Playwright `connectOverCDP` API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [Puppeteer README](https://github.com/puppeteer/puppeteer)
- [Puppeteer `connect()` API](https://pptr.dev/api/puppeteer.puppeteer.connect)
- [`@puppeteer/browsers` README](https://github.com/puppeteer/puppeteer/blob/main/packages/browsers/README.md)
- [`@puppeteer/replay` README](https://github.com/puppeteer/replay)
- [chrome-remote-interface README](https://github.com/cyrus-and/chrome-remote-interface)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Chrome 136 remote debugging 보안 변경](https://developer.chrome.com/blog/remote-debugging-port)
- [aeroxy/chrome-devtools-cli README](https://github.com/aeroxy/chrome-devtools-cli)
- [szymdzum/browser-debugger-cli README](https://github.com/szymdzum/browser-debugger-cli)
- [nicoster/chrome-devtools-cli README](https://github.com/nicoster/chrome-devtools-cli)

## 결정 현황과 남은 질문

MVP에서 결정되어 ADR과 구현에 반영된 항목:

- 기본 managed isolated profile과 명시적 `--profile` override
- 별도 detached observer와 command 간 bounded JSONL evidence
- `report` 실행 시점의 한 observation boundary
- persistence 전 denylist/key-pattern 기반 `mandatory-v1` redaction
- finding 유무와 무관한 query exit 0, operation/usage/capability exit 1–3
- `schemaVersion: 1`과 additive-compatible field 정책

남은 질문:

- Chrome의 user-enabled remote debugging auto-connect를 명시적 port 연결과
  별도 지원할지
- schema v1 compatibility 기간과 향후 major-version migration 도구를 어떻게
  운영할지
