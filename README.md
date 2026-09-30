# ExhibitOS deployment

Deployment adapters. OCI/compose, Generic SSH, DNS/TLS, OpenTofu와 provider adapter의 plan/apply/status/rollback을 담당한다.

## 현재 상태

2026-10-01 기준 README와 에이전트 작업 규칙만 있는 준비 단계다. 제품 코드, 실행 환경, dependency manifest, CI, 자동 테스트와 설치 파일은 아직 없다. 아래 기능과 검사는 계획이며 구현 완료를 뜻하지 않는다.

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
