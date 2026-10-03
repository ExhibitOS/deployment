# 배포 준비 확인

[처음으로](../README.md) · [확인 기록 양식](preflight-record-template.md) · [공개 OED 명세](https://github.com/ExhibitOS/spec/blob/8ee5741860b626448dcba0c82657de6621e1c058/oed/v1/README.md)

현재 사용할 수 있는 것은 **OED 문서 형식 검사**입니다. 이 저장소의
plan/apply/status/rollback 명령, 서버 설치 프로그램과 provider adapter는
아직 구현되지 않았습니다. 아래 절차는 준비 상태를 정리하며 배포를 실행하지 않습니다.

## 1. 문서 형식 확인

OED는 배포 대상·이미지 digest·저장소·secret 참조를 담은 draft입니다.
validator는 실제 자격증명, 연결, 이미지 존재, 여유 공간이나 복원을 확인하지 않습니다.

별도의 새 경로에 공개 spec을 준비합니다. 기존 checkout을 덮어쓰지 않습니다.
아래 고정 commit은 실행 예제의 기준이며 최신 배포판 또는 안정 버전이라는 뜻이 아닙니다.
Node24.21.0/npm11.19.0을 PATH에 준비한 상태에서 실행하세요.

```sh
git clone --no-checkout https://github.com/ExhibitOS/spec.git exhibitos-spec-preflight
cd exhibitos-spec-preflight
git checkout --detach 8ee5741860b626448dcba0c82657de6621e1c058
npm ci
npm run validate:package -- oed oed/v1/examples/local.json
npm run validate:package -- oed oed/v1/examples/ssh.json
```

두 합성 예제는 문서 검사에 통과합니다. 이미지의 전부 0인 digest와
`host.example.invalid`는 설명용 값이며 실제 실행 대상이 아닙니다.
실제 OED를 검사할 때는 마지막 명령의 파일 경로만 자신의 문서로 바꿉니다.
경로는 따옴표로 감싸고 secret의 값 대신 참조만 넣으세요.

```sh
node validators/package-cli.mjs oed "/absolute/path/deployment.json"
```

직접 Node 명령은 stdout에 JSON 결과를 냅니다. `valid:true`와 종료 코드0은
형식 검사 통과만 의미합니다. 실패는 종료 코드1이며 `errors`에 오류 코드와
필드 경로가 있습니다. npm 명령은 JSON 앞에 npm 실행 헤더를 표시합니다.

## 2. 실행 준비 증거 모으기

[확인 기록 양식](preflight-record-template.md)을 복사해 운영 기록으로 보관합니다.
미확인 항목은 **미확인**으로 남기고, 다른 항목의 성공으로 대신 채우지 않습니다.

| 확인할 것 | 필요한 증거 | 확인 전 중단 이유 |
| --- | --- | --- |
| 대상과 범위 | 소유·접근 권한, 지정 개발 환경, 현재 실행 버전 | 다른 환경의 변경 방지 |
| 이미지 | 실제 배포 채널, immutable digest, 호환 버전, 원문 라이선스·고지 | 형식만 맞는 가짜 digest는 실행할 수 없음 |
| 실행 도구 | 대상 OS에서 engine·Compose·권한·readiness 실제 결과 | 설치 여부와 실행 가능 여부가 다름 |
| 저장소 | DB/blob/volume 위치, 여유 공간, 원본 권리, 데이터 보존 범위 | container 정지와 데이터 삭제를 구분 |
| secret | 공식 credential store의 참조가 해당 환경에서 사용 가능한지 | OED 검사는 값이나 권한을 확인하지 않음 |
| 비용 | 모든 provider·storage·egress·CI 합계와 실제 상한 통제 | 검증되지 않은 무료·월 한도 추정 방지 |
| 복원 | 일관된 DB+blob+설정 snapshot, 별도 경로 복원 결과, 시각과 대상 | Git bundle은 작품·DB·credential 복원이 아님 |
| 변경 절차 | 실제 구현된 adapter, health 실패·중단·rollback 검사 결과 | 현재 계획 문서는 실행 도구가 아님 |

프로젝트의 초기 정책은 신규 유료 사용 없이 로컬 검증을 우선합니다.
이 프로젝트 전체 월 신규 비용 상한은10,000KRW입니다. 저장소 밖의 계정
청구 상태가 확인되지 않으면 실제 지출0으로 기록하지 않습니다.

## 3. 실패 후 다시 진행하는 조건

| 관찰한 결과 | 할 일 | 다시 확인할 것 |
| --- | --- | --- |
| `USAGE` | 명령의 mode가 `oed`이고 파일 인수가 하나인지 확인 | 위 직접 Node 명령 |
| `INVALID_INPUT` | 파일 접근·UTF-8·JSON 문법을 확인 | 원래 파일을 보존한 별도 수정본 |
| `INPUT_LIMIT` | 파일 크기와 일반 파일 여부를 확인 | 기준 CLI의 최대1MiB; 검사를 우회하지 않음 |
| OED 필드·버전 오류 | `errors`의 필드 경로를 명세와 비교 | secret 값·미선언 필드를 넣지 않은 문서 |
| 예제 검사도 실패 | 고정 commit·Node 버전·lockfile·설치를 확인 | 별도 새 checkout과 `npm ci` |
| 형식 통과, 환경 미확인 | 항목별 실제 증거를 수집 | 이미지·권한·readiness·비용·복원 |
| adapter 또는 복원 미완료 | 실행하지 않고 인수인계 | 실제 도구·복구 검사가 준비된 이후 |

재시도는 OED 검사만 재실행합니다. 이 문서는 연결·배포·삭제·자격증명 조회를
실행하는 명령을 제공하지 않습니다. 실패한 상태에서 실제 데이터나 기존 백업을
삭제하거나 digest·schema 검사를 우회하는 동작은 복구 절차가 아닙니다.

## 4. 다음 담당자에게 넘기기

양식에 검사 source/version, 명령, 종료 코드, 결과 시각과 미확인 항목을 적습니다.
확인되지 않은 항목은 담당자와 재개 조건을 명시하세요. 토큰·비밀번호·키 bytes,
원본 artwork, raw 환경 출력은 Git/Issue/PR에 첨부하지 않습니다.

모든 준비 항목이 확인돼도 현재 저장소에서 배포할 수 있다는 뜻은 아닙니다.
실제 OCI/Compose 및 SSH/provider/rollback 구현과 실환경 검증은 기존 배포
구현 단계에서 별도로 완료해야 합니다.
