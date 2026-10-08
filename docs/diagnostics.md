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

검사: `npm test`. 설치와 metrics·운영 dashboard 및 전체 복구
검사는 원래 배포 단계에서 추가해야 합니다. 이 도구는 OED를 실행하는 adapter가
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
