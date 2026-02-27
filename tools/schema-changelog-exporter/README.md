# Schema Changelog Exporter

현재 실제 DB 스키마를 읽어서, 이 프로젝트가 사용하는 Liquibase `generated` 구조로 내보내는 도구입니다.

- 출력 구조:
  - `generated-master.yaml`
  - `tables/<TABLE>.yaml`
- changeSet 구조:
  - `createTable`
  - `addPrimaryKey`
  - `addForeignKeyConstraint`
  - `createIndex`

## 1) 설치

```bash
cd tools/schema-changelog-exporter
npm install
```

## 2) 실행

### PostgreSQL

```bash
node src/cli.mjs \
  --dbms postgres \
  --host 127.0.0.1 \
  --port 5432 \
  --user app \
  --password pw \
  --database sampledb \
  --schema public \
  --out ../../sample-data/db/changelog/generated
```

### MariaDB

```bash
node src/cli.mjs \
  --dbms mariadb \
  --host 127.0.0.1 \
  --port 3306 \
  --user app \
  --password pw \
  --database sampledb \
  --out ../../sample-data/db/changelog/generated
```

### Oracle (serviceName)

```bash
node src/cli.mjs \
  --dbms oracle \
  --host 127.0.0.1 \
  --port 1521 \
  --user APP \
  --password pw \
  --schema APP \
  --serviceName XEPDB1 \
  --oracleClientPath "C:\\oracle\\instantclient_23_5" \
  --out ../../sample-data/db/changelog/generated
```

### Oracle (SID)

```bash
node src/cli.mjs \
  --dbms oracle \
  --host 127.0.0.1 \
  --port 1521 \
  --user APP \
  --password pw \
  --schema APP \
  --sid XE \
  --oracleClientPath "C:\\oracle\\instantclient_23_5" \
  --out ../../sample-data/db/changelog/generated
```

## 3) 옵션

- `--tables C_USER,C_ORDER` : 특정 테이블만 추출
- `--author your-name` : changeSet author 지정 (기본값 `data-manager`)
- `--out <dir>` : 출력 디렉토리 (기본값 `./generated`)
- `--oracleClientPath <dir>` : Oracle Instant Client 라이브러리 디렉토리 경로 (필요한 환경에서 사용)

## 참고

- Oracle 드라이버(`oracledb`)는 환경에 따라 Instant Client 설정이 필요하며, 이 경우 `--oracleClientPath`를 지정하세요.
- 인덱스는 PK 인덱스를 제외하고 export 합니다.
