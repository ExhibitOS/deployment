# ExhibitOS deployment

Deployment adapters. OCI/compose, Generic SSH, DNS/TLS, OpenTofu와 provider adapter의 plan/apply/status/rollback을 담당한다.

## 현재 상태

2026-10-03 기준 README·에이전트 작업 규칙·운영자 준비 확인 문서가 있는 준비 단계다. 제품 코드, 실행 환경, dependency manifest, CI, 자동 테스트와 설치 파일은 아직 없다. 아래 기능과 검사는 계획이며 구현 완료를 뜻하지 않는다.

## 운영자가 시작할 곳

[배포 준비 확인](docs/preflight.md)에서 현재 실행 가능한 공개 OED 형식 검사와
환경·비용·복원 확인 항목을 읽습니다. [확인 기록 양식](docs/preflight-record-template.md)에
증거와 미확인 항목을 분리하여 남깁니다. 이 문서의 준비 확인은 서버 배포를 실행하지 않습니다.

## 책임과 계약

spec의 OED와 공개 platform OCI image를 사용하고 manager가 adapter를 호출한다.

이 저장소는 공개 후보이며 현재 GitHub에서는 비공개다. operations 및 Capture 저장소는 빌드·설치·CI 의존성이 될 수 없다. private submodule, private package와 secret을 필수 조건으로 추가하지 않는다. 공개 전환·라이선스 적용은 별도 기록과 검토 후 수행한다.

## 구현 순서

T10-01 → T10-02 → T10-03.

T00-02에서 toolchain·지원 환경·build/lint/typecheck/test 명령을 확정하고 실제 설정을 추가한다. 이후 task마다 코드·오류 검사·사용법과 검증 증거를 함께 작성한다. secret-free dry-run/plan, 건강 상태 검사, 재실행, 실패한 migration과 rollback, provider 없이 Generic SSH 흐름을 검증한다.

현재 실행 가능한 제품 build/test 명령은 없다. 이 문서 변경은 `git diff --check`와 tracked tree/의존 경계 검토로 확인한다.

## 기여와 보안 보고

작업 전 [AGENTS.md](AGENTS.md)를 읽고 `codex/<작업명>` 브랜치와 PR로 변경한다. 일반 문제는 이 저장소의 Issue/PR에서 다룬다. 취약점·토큰·비공개 작품을 일반 Issue에 게시하지 않는다. GitHub private vulnerability reporting이 활성화돼 있으면 사용하고, 없으면 조직 관리자에게 비공개 보고한다. 아직 전용 보안 연락처나 security reporting 기능이 설정됐다고 가정하지 않는다.

기획·상태 조정 자료는 접근 권한이 있는 에이전트가 operations에서 확인한다. 제품의 빌드와 배포는 이 운영 문서 없이 실행할 수 있어야 한다.

## 라이선스

프로젝트가 소유하는 코드·설정·스크립트와 문서는 [Apache-2.0](LICENSE)으로 제공합니다.
외부 코드·package·폰트·이미지·작품과 함께 배포하는 platform은 각각 원래 조건을 유지합니다.
원본 LICENSE와 관련 copyright·NOTICE를 보존하고 수정 파일에는 변경 고지를 남깁니다.
이 라이선스는 상표 허락이나 사용자 작품의 display/export 권한을 부여하지 않습니다.
현재 제품 코드·dependency·배포 image가 없는 준비 단계이며, 추가 시 출처와 재배포 조건을 확인합니다.
