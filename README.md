# Data Manager

Liquibase 스키마 메타정보를 기준으로 CSV 시드 데이터를 관리하는 **Node.js + Electron + React** 기반 데스크톱 애플리케이션입니다.

## 구성

- `app`: React UI + Electron(main/preload) + Node 서비스 로직
- `sample-data`: 예제 CSV 데이터와 Liquibase changelog

## 개발 실행

```bash
cd app
npm install
npm run dev:electron
```

- Vite dev 서버(`http://localhost:23000`)와 Electron 앱이 함께 실행됩니다.
- 브라우저 단독 실행(`npm run dev`)도 가능하지만, 이 경우 Electron 전용 기능(IPC 파일 선택 등)은 제한됩니다.

## 빌드/패키징 (Windows)

```bash
cd app
npm run dist
```

- 설치 파일은 `app/release` 디렉토리에 생성됩니다.

## 주요 사용 흐름

1. 워크스페이스 열기 (UI 기본값: `sample-data`)
2. 테이블 데이터 조회/수정/삭제/행 순서 변경
3. `save`로 테이블 단위 일괄 저장
4. PK 변경이 포함되면 영향 미리보기 후 승인 시 FK 연쇄 업데이트 + 저장
5. 전체 무결성 검증 실행
6. 테이블 정보 UI(컬럼 default/PK 이름+순서/FK/Index) 수정 후 Liquibase changelog 생성

## 참고 사항

- CSV 인코딩/포맷: UTF-8, RFC4180
- 파일명 규칙: `{table}.csv`
- 첫 번째 행은 컬럼명(헤더)
- 생성된 changelog 경로:
  - master: `<workspace>/db/changelog/generated/generated-master.yaml`
  - tables: `<workspace>/db/changelog/generated/tables/<table>.yaml`
