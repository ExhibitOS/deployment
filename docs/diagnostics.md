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
unhealthy는 보존됩니다. running만으로 healthy를 가정하지 않습니다. 빈 목록이나
없는 환경을 성공으로 처리하지 않습니다. 서비스 최대16개, 관찰 container 최대64개,
명령별 최대8초/256KiB, 전체 명령 관찰 예산20초입니다. 진단은 재시도하거나 파일을
쓰기·서비스를 정지·데이터를 지우지 않습니다.

Docker inspect는 Env, mounts, credential, healthcheck 출력 또는 logs를 요청하지 않습니다.
stderr와 실행 실패의 raw message/stack은 표시하지 않고 고정 오류 코드만 반환합니다.
사용자가 입력한 이름 자체에 secret을 넣지 마세요. Docker credential/context는 기존
환경 그대로 사용하며 이 도구가 secret reference를 해석하지 않습니다.

검사: `npm test`. 설치와 application readiness·metrics·운영 dashboard 및 전체 복구
검사는 원래 배포 단계에서 추가해야 합니다. 이 도구는 OED를 실행하는 adapter가
아니며 OED 형식 검사와 혼동하지 않습니다.
