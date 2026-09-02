# 구현 리뷰 1 — 최신 수정본 재검증

- 리뷰일: 2026-09-02 (Asia/Seoul)
- 최종 재검증 대상: `src/**/*.js`, `bin/chroma.js`, `package.json`, `README.md`, `test/e2e/chrome.test.js`
- 방식: 읽기 전용 코드 리뷰, 단위/fixture 테스트, 격리 profile의 실제 Chrome 152 E2E
- Fresh-eye satisfaction: 독립 E2E/경쟁 조사 서브에이전트 재감사 후 발견 사항 수정
- 위치 표기는 줄 번호보다 symbol/test 이름을 정본으로 본다. 이 검토는 아직 commit되지 않은 최종 worktree 기준이다.

## 최종 판정

초기 리뷰의 가장 위험했던 결함은 대부분 닫혔다. endpoint와 browser instance identity가 연결됐고, monitor는 첫 poll과 target attach를 마친 뒤 `readyAt`을 기록한다. URL/이벤트는 durable append 전에 redaction되고 snapshot state에는 이제 ref binding만 남는다. `--clear`는 scoped marker이며, launch는 기존 CDP port를 거절하고, 출력 충돌은 fail-closed다. 실제 Chrome의 전체 진단 흐름도 통과했다.

accepted ADR의 causal doctor, 동일-boundary report, same-session restart continuity까지 최신 수정에서 닫혔다. 현재 확인된 MVP 완료 차단 항목은 없다.

## 실행 검증

- `npm run check`: exit 0, lint 통과, 41/41 pass.
- `npm run test:e2e`: 실제 Chrome lane 최신 단일 1/1 pass(13.188초), 동일한
  진단 구현의 동시 실행 2/2 pass(13.327초/13.025초).
- 실제 Chrome 152 / CDP 1.3에서 `launch -> doctor -> tabs -> snapshot -> click/fill/press -> errors -> network --failed -> screenshot -> report`가 통과했다.
- 초기 수동 trace에서도 monitor process 시작과 첫 target attach 사이 약 0.59초 간격이 있었고, 최신 코드는 이를 `monitorStartedAt`과 target별 `observationStartedAt`으로 분리한다.

## 이번 MVP 완료를 막는 잔여 항목 — 0개

마지막 fresh-eye 감사에서 같은 browser/endpoint의 session 혼입과 overlay click false-success 두 HIGH가 발견됐다. 전자는 `belongsToLiveBrowser`의 session ID 조건과 ignored evidence boundary로, 후자는 click 전 page hit-test와 `ELEMENT_OBSCURED`로 닫혔다. `test/e2e/chrome.test.js`가 두 경로를 실제 Chrome에서 재현한다. 같은 감사의 read-failure/no-store, same-URL reload/browser-binding, cleanup 완료 증명 공백도 함께 닫혔다.

## 초기 C 항목 disposition

| ID | 최종 상태 | 최신 근거와 잔여 |
| --- | --- | --- |
| C1 endpoint/session 변경 시 monitor 오재사용 | **Resolved** | `startMonitor`, `assertSessionIdentity`, `belongsToLiveBrowser`, `ignoredEventLog`가 endpoint+browser+observation session을 함께 검증한다. same-browser/different-session 실제 E2E도 이전 evidence가 0건임을 확인한다. |
| C2 attach 전 ready/거짓 관찰 구간 | **Resolved** | process start, target observation, ready를 구분하고 write/drop/corruption 및 restart discontinuity를 기록한다. restart degradation도 새 explicit session까지 sticky하다. |
| C3 report/durable redaction 부재 | **Resolved for declared policy** | monitor `record`는 persistence 전 redaction+UTF-8 bounding을 적용한다. snapshot state에는 values가 아닌 identity/ref binding만 저장하고 report도 value를 재차 가린다. Screenshot/accessibility name·description은 경고가 필요한 residual content이며 README가 이를 명시한다. |
| C4 launch가 기존 Chrome을 오인 | **Resolved for identity; explicit profile risk remains** | launch는 기존 CDP port를 typed `PORT_IN_USE`로 거절하고 timeout 시 owned child를 종료하며 browser WebSocket identity hash를 저장한다. 기본 profile은 state 아래 non-default dir라 Chrome 136+ 조건을 충족한다. explicit personal profile은 warning을 내고 startup 실패도 `CDP_STARTUP_FAILED`+복구 hint로 반환한다. |
| C5 scoped clear가 전체 evidence 삭제 | **Resolved** | `readEvents`가 target+kind cursor를 별도 atomic state에 기록하며 unit/실제 Chrome test가 다른 tab/kind 보존을 검증한다. |
| C6 artifact overwrite/symlink/partial | **Resolved** | `captureScreenshot`은 `wx`, `commandReport`는 기존 output을 거절하고 private staging에서 완성한 뒤 atomic rename하며 실패 시 staging을 지운다. SHA-256 attachment integrity도 검증한다. |
| C7 tab/ref/selector가 잘못된 node를 mutate | **Resolved for MVP** | ambiguous tab은 fail-closed, mutation은 multiple tabs에서 explicit `--tab`을 요구한다. selector는 `querySelectorAll` 후 exactly-one을 요구하고, ref는 endpoint+browser instance+target+URL fingerprint+loaderId+backend node로 검증한다. 이전 schema의 미바인딩 ref도 stale로 거절한다. |
| C8 E2E가 0 tests green | **Resolved** | `test/e2e/chrome.test.js`의 전체 흐름이 단일 1회와 동시 2회 통과하고 종료/임시 경로 부재까지 assert한다. |

## 초기 I 항목 disposition

| ID | 최종 상태 | 최신 근거와 잔여 |
| --- | --- | --- |
| I1 failed network correlation | **Partial, non-blocking** | request map으로 transport failure에도 URL/method, duration, initiator 요약이 붙고 실제 E2E가 HTTP 503+disconnect를 검증한다. report는 10초 이내 선행 action을 `basis: temporal`로 명시하며, redirect chain/고신뢰 causal attribution은 후속이다. |
| I2 doctor causal checks | **Resolved for MVP** | doctor helpers가 Chroma/Node, executable version, writable/private/corrupt state, endpoint, instance identity, protocol, monitor readiness, event-store health, profile isolation을 독립 checks로 내고 causal next action을 계산한다. |
| I3 JSON/exit 계약 | **Resolved for MVP** | ADR/README/구현은 0–3 의미와 success `error:null`에 맞춰졌다. stale snapshot, selector/tab ambiguity, output collision, remote policy, endpoint/startup/monitor failure는 stable string code와 `retryable`, recovery `hint`, 해당 시 `details`를 보존한다. CDP protocol numeric code는 `details.protocolCode`에만 둔다. |
| I4 invalid filter/command timeout | **Resolved** | `commandEvents`가 limit/time을 선검증하고 `CdpConnection`이 typed pending/open timeout과 timer cleanup을 구현한다. |
| I5 unbounded/corrupt event store | **Resolved for MVP** | byte-bounded rotation, serialized append, write/drop health, corrupt-line cursor, restart health 승계와 sticky degradation이 추가됐다. |
| I6 report provenance/partial | **Resolved for MVP** | shared cursor, overall status, restart discontinuity, atomic bundle, value-free action outcome history가 추가됐다. JSON과 Markdown은 같은 `report.status`를 사용한다. |
| I7 production에 test flags 강제 | **Resolved** | `src/chrome.js:92-105`에서 background/extension flags는 explicit `--deterministic`일 때만 적용되고 E2E가 그 mode를 사용한다. report에도 mode가 남는다. |
| I8 fill stdin/element 범위 | **Partially resolved, deferred remainder** | `fill --stdin`이 shell history/process list 노출을 피하면서 character count만 기록한다. contenteditable/select 의미는 문서화된 후속이다. |

## 후속 항목

- 사용자용 `stop`/idle timeout과 ownership-safe Chrome lifecycle은 계속 후속이다. E2E harness는 현재 owned process group을 정리한다.
- Node >=22는 built-in WebSocket을 위한 의식적 채택 비용이다. 현 단계에서 Node 18 호환 layer를 넣을 이유는 없다.
- raw CDP, broad automation, cross-browser parity는 계속 제외하는 것이 맞다. doctor/report/observation integrity가 이 프로젝트의 제품 경계다.
- report redaction E2E는 known marker를 URL query와 input value에 심어 state dir와 textual bundle 전체에서 부재를 검증한다. Screenshot/accessible-name 잔여 위험은 명시적 경고와 수동 검토 경계로 남는다.

## 우선 수정 순서

1. redirect/중복 정규화와 action-to-failure correlation 신뢰도 표기를 확장한다. 기본 timing/initiator와 temporal correlation은 구현됐다.
2. Chrome startup/profile 실패 원인을 플랫폼별로 더 세분화한다.
3. Linux/Windows에서 같은 real-browser lane을 실행한다.

## Structured Findings

- No remaining act-before-ship finding in this review scope.
- I1 | bin: valid-but-defer | evidence: strong | ref: `src/monitor.js`;`src/cli.js` | action: defer | URL/method/timing/initiator and explicitly-temporal action correlation are present; redirect normalization remains
- I3 | bin: resolved | evidence: strong | ref: `src/errors.js`;`src/cdp.js`;`src/operations.js`;`src/cli.js` | action: accept | public failures keep stable string codes, recovery hints, retryability, and bounded details
- I8 | bin: valid-but-defer | evidence: strong | action: defer | stdin is supported; contenteditable/select semantics remain documented limits
