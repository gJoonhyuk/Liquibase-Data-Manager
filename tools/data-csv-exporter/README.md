# Data CSV Exporter

실제 DB 테이블 데이터를 CSV 파일로 추출하는 도구입니다.

- 출력: `<out>/<TABLE>.csv`
- 파일명은 테이블명
- 첫 줄은 컬럼 헤더
- 진행 로그(연결/테이블별 진행률/파일 쓰기) 출력

## 1) 설치

```bash
cd tools/data-csv-exporter
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
  --out ../../sample-data
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
  --out ../../sample-data
```

### Oracle

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
  --out ../../sample-data
```

## 3) 옵션

- `--tables C_USER,C_ORDER` : 특정 테이블만 추출
- `--nullToken "\\N"` : DB의 NULL 값을 CSV에서 구분 가능한 텍스트로 출력 (기본값: 빈문자열)

## 참고

- Oracle은 환경에 따라 Instant Client 경로(`--oracleClientPath`) 설정이 필요합니다.
