# 읽기 전용 서비스 진단

Node24.21.0과 Docker CLI를 사용합니다. 저장소는 private Capture/operations 또는
private package를 import하지 않으며 외부 dependency·설치 과정이 없습니다.

```sh
node bin/diagnose.mjs --project exhibitos-example --services platform,database
```

프로젝트 이름과 필요한 서비스 목록은 명시적 입력입니다. 현재 Docker context의
컨테이너를 읽으며, 다른 context로 전환하거나 Docker를 설치·시작하지 않습니다.
`ps --all`의 Compose project label로 후보를 찾고, 전체 container ID와 project label을
각 inspect에서 다시 확인합니다. 마지막 census가 달라지면 결과는 unknown입니다.
관찰은 원자적 snapshot이 아니며 마지막 검사 뒤 상태가 변할 수 있습니다.

결과에는 서비스별 state, container health, exit code, restart count, image **config**
digest와 container ID가 포함됩니다. config digest는 registry manifest digest 또는
release 서명 검증이 아닙니다. CPU/RAM/disk/queue 측정과 application HTTP readiness,
TLS·DB·storage 연결 검사는 이 결과에 포함되지 않습니다.

| 종료 코드 | 결과 | 의미 |
| --- | --- | --- |
| 0 | healthy | 필요한 서비스가 각각 하나이고 running/healthy로 관찰됨 |
| 1 | unhealthy | 완전한 관찰 중 컨테이너 unhealthy 상태 확인 |
| 2 | unknown | 없음·누락·중복·추가 서비스·상태 변경·healthcheck 미설정 등 |
| 3 | observation-failed | 잘못된 입력, 실행 도구·권한·timeout·출력 검사 오류 |

unhealthy와 unknown이 함께 있으면 전체 결과는 unknown이지만 각 서비스의 실제
unhealthy는 보존됩니다. running만으로 healthy를 가정하지 않습니다. 정지된 컨테이너의 과거 health 상태는
`observedEngineHealth`로 보존하지만 현재 건강 상태는 unknown으로 처리합니다. 빈 목록이나
없는 환경을 성공으로 처리하지 않습니다. 서비스 최대16개, 관찰 container 최대64개,
명령별 최대8초/256KiB, 전체 명령 관찰 예산20초입니다. 진단은 재시도하거나 파일을
쓰기·서비스를 정지·데이터를 지우지 않습니다.

Docker inspect는 Env, mounts, credential, healthcheck 출력 또는 logs를 요청하지 않습니다.
stderr와 실행 실패의 raw message/stack은 표시하지 않고 고정 오류 코드만 반환합니다.
사용자가 입력한 이름 자체에 secret을 넣지 마세요. Docker credential/context는 기존
환경 그대로 사용하며 이 도구가 secret reference를 해석하지 않습니다.

검사: `npm test`. 아래 명시적 자원 관찰 옵션을 제공하며, 설치·전체 운영 dashboard·전체 복구 검사는 별도입니다. 이 도구는 OED를 실행하는 adapter가
아니며 OED 형식 검사와 혼동하지 않습니다.


## 관찰한 포트에 연결된 애플리케이션 준비 상태

```sh
node bin/diagnose.mjs --project exhibitos-example --services platform,database --application-readiness platform
```

추가 옵션은 서비스 목록에 있는 Platform 서비스 하나를 지정합니다. Docker에서
관찰한 해당 컨테이너의 `8080/tcp` 포트가 오직 `127.0.0.1`의 단일 포트로 공개된
경우에만 `/api/v1/readiness`를 읽습니다. 주소·URL·credential은 입력받지 않습니다.
외부 주소, wildcard, IPv6, 다중 binding 또는 포트 미공개는 unknown입니다.

HTTP 요청 전후 container ID, image config digest, running 상태, restart count,
포트 binding과 최종 서비스 census를 비교합니다. 응답은 최대16KiB/2초이며
전체 관찰20초 예산을 공유합니다. redirect, 인증, cookie, proxy, DNS 조회와
응답 재시도는 사용하지 않습니다. JSON 중복 필드와 지원하지 않는 버전·서비스·
응답 상태 조합을 거부합니다. 현재 지원 계약은 protocol1, Platform0.1.0,
schema1.0.0-draft.1 및 platform/api/database/web/storage의 다섯 상태입니다.

이 모드의 종료0은 컨테이너 건강과 HTTP 준비 상태 모두 확인됐을 때만 가능합니다.
HTTP503의 유효한 unavailable 응답이나 포트/상태 변경은 종료2입니다. 건강한
컨테이너만으로 HTTP 준비 완료를 주장하지 않습니다. 응답 원문은 출력하지 않습니다.

준비 상태는 해당 순간의 애플리케이션 보고입니다. 원자적 snapshot, 서명된
릴리스 진위, Realtime, TLS, CPU/RAM/disk/queue, 전체 복구 또는 운영 배포의
완료 증거가 아닙니다. 이전 기본 모드는 HTTP를 호출하지 않습니다.

## Local engine requirement for HTTP observations

Optional Platform HTTP readiness refuses TCP (including localhost), SSH and other remote Docker transports before any container census or HTTP request. It resolves the effective selection in Docker order: nonempty `DOCKER_CONTEXT`, then `DOCKER_HOST`, then the current context. Context discovery reads only the selected Docker endpoint; no TLS/credential fields are requested. Only bounded Unix socket or local named-pipe endpoints are admitted. Unsupported context names/transports fail closed.

All optional-mode Docker observations use the resolved explicit host and a frozen environment, so changing the current context cannot redirect an intermediate census/inspection. Selection environment and context endpoint are reobserved immediately before HTTP and after the final census; drift refuses positive readiness. This is a point observation, not an atomic lock on Docker configuration. The socket/named-pipe daemon and any local proxy are trusted local infrastructure; a local proxy forwarding elsewhere is not cryptographically detected. No signed engine identity or remote-engine readiness is qualified. Raw endpoint paths, selection environment and credential metadata do not enter the diagnostic receipt. Container-only mode remains independent of this local HTTP requirement.


## 명시적 자원 관찰

```sh
node bin/diagnose.mjs --project exhibitos-example --services platform,database --resources
```

기본 진단과 `--application-readiness` 호출·응답은 유지합니다. 이 옵션은 선언한 서비스가 각각 하나인 프로젝트만 관찰합니다. 고정된 전체 container ID에 `docker stats --no-stream --no-trunc`를 사용해 CPU와 메모리를 읽고, `docker inspect --size`의 ID·project·쓰기 레이어 크기만 읽습니다. Docker 공식 [stats 설명](https://docs.docker.com/reference/cli/docker/container/stats/)과 [inspect 설명](https://docs.docker.com/reference/cli/docker/inspect/)에 기반합니다. Env, mounts, 로그, 프로세스 인수, 자격증명, host 디렉터리 경로를 요청하지 않습니다. 쓰기·실행·재시도는 하지 않습니다.

CPU는 단일 코어 기준 백분율이므로 여러 코어에서100%를 넘을 수 있습니다. 메모리 bytes는 CLI 표시 문자열의 추정값이며 Linux Docker CLI의 cache 제외 의미를 따릅니다. 임계값은 CPU90%, 메모리85%, 컨테이너 쓰기 레이어1GiB의 **순간 관찰 경고**입니다. 운영 한도·CPU quota·지속 과부하·자동 알림이나 자동 변경을 뜻하지 않습니다. exit code가0이 아니었던 컨테이너 수와 현재 컨테이너의 restart 누계도 제공하며, 오류 발생률로 해석하지 않습니다.

쓰기 레이어와 root filesystem bytes는 볼륨·DB·blob·호스트 파일시스템의 사용량 또는 여유 공간이 아닙니다. 따라서 `storageCapacity`는 `unknown`입니다. 작업 대기열은 현재 tenant의 인증된 집계가 없으면 `unknown`입니다. 이 결과만으로 전체 운영 지표 연결이 완료됐다고 표시하지 않습니다. unsupported format·정지된 서비스·측정 실패·출력 오류는0으로 대체하지 않습니다.

자원 관찰은 기존 전체20초 예산 안에서 최대5초만 사용하고 마지막 container census를 위해8초를 남깁니다. 명령별 자원 관찰은 최대2초/256KiB입니다. 마지막 census가 달라지면 숫자 관찰은 모두 폐기합니다. 이는 원자적 snapshot이나 Docker daemon의 암호학적 신원 증명이 아닙니다.

종료0은 기존 container health와 CPU/RAM/쓰기 레이어 관찰이 모두 확인된 경우입니다. 일부 자원값이 unknown이면 종료2이며 container health 사실은 별도 필드에 남습니다. data-volume capacity·작업 대기열이 측정됐다는 의미는 아닙니다. 인증된 tenant의 queue/error와 configured blob 여유 공간은 아래 별도 API에서 관찰합니다. 이 CLI만으로 해당 관찰을 대신하지 않습니다.


## 인증된 tenant 운영 지표

Platform의 `GET /api/v1/tenants/{tenantId}/operations/metrics`는 기존 로그인 session으로 현재 tenant의 관리자만 읽습니다. 현재 membership을 다시 확인하며 다른 tenant 접근은 거부합니다. 응답은 `Cache-Control: no-store`이고 작품·작업 ID, object key, credential, 원문 오류나 저장소 경로를 포함하지 않습니다.

실제 asset-import와 OEX-import 두 대기열의 queued/processing 수, 가장 오래 대기한 작업의 나이와 최근24시간에 updated된 현재 failed 작업 수를 제공합니다. 이는 전체 오류 event 수나 오류 발생률이 아닙니다. OEX export는 동기 처리이므로 별도 persistent export queue를 꾸며내지 않습니다. 대기300초 이상 또는 failed 작업1개 이상은 조사가 필요한 순간 경고이며 자동 복구·자동 알림·서비스 한도는 아닙니다.

실제 configured `FileBlobStore`인 경우 그 디렉터리가 놓인 **공유 파일시스템**의 전체·가용 bytes와 free percent를 읽습니다. tenant quota, DB volume capacity 또는 컨테이너 writable layer와 같지 않습니다. free percent10% 미만은 경고입니다. S3·다른 backend 또는 로컬 관찰 실패는 `unknown`이며 임의의 host 디렉터리로 대체하지 않습니다.

집계 SQL의 transaction-local statement timeout은2초입니다. 비동기 파일시스템 호출 전체의 deadline이나 취소 완료는 보장하지 않습니다. 서로 다른 시점의 관찰이므로 원자적 snapshot을 주장하지 않습니다. CPU/RAM은 위 컨테이너 진단에서 별도로 관찰하며 이 API의 해당 항목과 DB capacity는 관찰하지 않은 `unknown`으로 남습니다.
