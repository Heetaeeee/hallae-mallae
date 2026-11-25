# 배포 기록과 운영 절차

배포 주소: [https://hallaemallae.duckdns.org](https://hallaemallae.duckdns.org)

담당: 박지호(B)

## 구성

| 항목 | 설정 |
|---|---|
| 서버 | AWS EC2, 서울 리전, Ubuntu 24.04, t3.micro |
| 인스턴스 | `3oss-server` |
| 관리자 접속 | AWS Session Manager |
| 외부 포트 | HTTP 80, HTTPS 443 |
| 실행 | Docker 컨테이너 `3oss-app`, 메모리 제한 512MB |
| 앱 연결 | nginx → `127.0.0.1:3000` |
| 데이터 | Docker 볼륨 `3oss-data` → `/data` |
| 재시작 정책 | `unless-stopped` |
| HTTPS | Let's Encrypt, Certbot 자동 갱신 |
| 방 기능 | 통합 검증 완료 전까지 `ROOMS_ENABLED=0` |

## 서버 접속

AWS EC2에서 인스턴스를 선택하고 연결 → SSM Session Manager로 접속합니다.

```bash
sudo -iu ubuntu
cd ~/3oss
```

`.env`와 실제 데이터는 저장소에 올리지 않습니다. `.env` 권한은 600으로 유지합니다.

## 수동 업데이트

최신 main을 받고 빌드가 성공한 뒤 기존 컨테이너를 교체합니다.
교체 직전에 데이터 백업을 남깁니다.

```bash
cd ~/3oss
git pull --ff-only origin main
docker build -t 3oss .
docker cp 3oss-app:/data/db.json ~/backups/before-update.json
chmod 600 ~/backups/before-update.json
docker stop 3oss-app
docker rm 3oss-app
docker run -d --name 3oss-app --init --restart unless-stopped -p 127.0.0.1:3000:3000 --memory 512m --env-file .env -v 3oss-data:/data 3oss
```

빌드나 백업이 실패하면 다음 단계로 진행하지 않습니다.

교체 후 확인합니다.

```bash
docker ps
docker logs --tail 30 3oss-app
```

배포 주소에서 기존 데이터와 핵심 기능도 확인합니다.
데이터 볼륨 `3oss-data`는 삭제하지 않습니다.

## 백업

백업 위치는 `/home/ubuntu/backups`입니다.
서버 시간대가 `Asia/Seoul`인지 확인합니다.

ubuntu 사용자의 crontab에 다음 예약을 등록했습니다.

```cron
0 4 * * * /usr/bin/docker cp 3oss-app:/data/db.json /home/ubuntu/backups/db-$(date +\%F).json && chmod 600 /home/ubuntu/backups/db-$(date +\%F).json
```

예약 등록과 실제 실행 성공은 구분합니다.
예약 시간 이후 파일 생성 여부를 확인해야 합니다.

이 백업은 같은 EC2 디스크에 있으므로 서버·디스크 자체의 손실에 대비한 외부 백업은 아닙니다.

## 백업 복구 점검 — 별도 테스트 볼륨

운영 볼륨을 건드리지 않고 백업을 읽을 수 있는지 확인하는 절차입니다.
다음 명령은 AWS 서버의 ubuntu 사용자로 실행합니다.

복원할 백업 파일이 있는지 먼저 확인합니다.

```bash
ls -lh /home/ubuntu/backups/before-restart.json
```

별도 테스트 볼륨에 백업을 복사합니다.

```bash
docker volume create 3oss-restore-check

docker run --rm --network none --user 0 \
  -v 3oss-restore-check:/data \
  -v /home/ubuntu/backups:/backup:ro \
  --entrypoint sh 3oss \
  -c 'cp /backup/before-restart.json /data/db.json && chown node:node /data/db.json'
```

앱의 저장소 코드로 복원 데이터를 읽습니다.
이 점검은 기존 운영 모드와 동일하게 방 기능을 끈 상태로 실행합니다.

```bash
docker run --rm --network none \
  -e ROOMS_ENABLED=0 \
  -v 3oss-restore-check:/data \
  --entrypoint node 3oss --input-type=module \
  -e 'import { load } from "./src/lib/store.js"; const db = load(); console.log("복원 데이터 읽기 성공"); console.log("팀원:", db.members.length, "명, 작업:", db.tasks.length, "개");'
```

이 절차는 별도 볼륨에서의 복구 점검이며, 운영 데이터 복구는 아닙니다.
운영 볼륨 `3oss-data`는 삭제하지 않습니다.

## 운영 데이터 복구 절차

운영 복구는 현재 데이터를 백업 시점으로 되돌립니다.
복구 중에는 서비스를 사용할 수 없으므로 팀원에게 작업 중단을 안내합니다.

1. 복원할 백업 파일과 해당 저장 형식을 읽을 수 있는 코드 버전을 확인합니다.
2. 현재 운영 데이터를 별도 파일로 백업하고 성공 여부를 확인합니다.
3. 운영 컨테이너를 중지합니다.
4. 백업 파일을 운영 볼륨의 `/data/db.json`으로 복사하고 소유자를 `node` 사용자로 맞춥니다.
5. 호환되는 코드 이미지와 환경 설정으로 컨테이너를 시작합니다.
6. 컨테이너 상태와 HTTPS 접속, 팀원·작업 데이터를 확인합니다.

각 단계가 실패하면 다음 단계로 진행하지 않습니다.
방별 형식으로 이전한 데이터를 이전 코드로 되돌리는 경우에는
스위치만 끄지 말고 이전 전 백업을 복원해야 합니다.

운영 볼륨을 대상으로 한 실제 복구는 아직 수행하지 않았습니다.

## 방 기능 활성화

전체 통합 검증을 마친 뒤 `ROOMS_ENABLED=1`로 변경합니다.

- 활성화 직전에 기존 `db.json`을 수동 백업합니다.
- 활성화한 상태에서 기존 파일을 처음 읽으면 방별 저장 형식으로 이전되며, `/data`에 기존 파일의 `.bak` 백업이 생성됩니다.
- 이전 코드로 되돌릴 때는 스위치를 끄는 것만으로 저장 형식이 복원되지 않습니다. 앱을 중지하고 이전 전 백업 또는 `.bak` 파일로 `db.json`을 복원한 뒤 이전 코드를 실행해야 합니다.

## 검증 기록 — 2026-11-25

- HTTPS 외부 접속 성공
- `certbot renew --dry-run` 성공
- 컨테이너 `healthy` 확인
- 서버 재부팅 후 팀원·작업 유지 확인
- 컨테이너 교체 후 `healthy` 확인
- 자동 백업 예약 등록 및 cron 서비스 활성 확인
- 별도 볼륨 `3oss-restore-check`에 백업을 복사하고 앱의 `load()`로 읽기 성공

### 서버 확인 — 2026-11-25

- 서버 시간대: `Asia/Seoul`
- 컨테이너 시간대: `KST`
- 서버 체크아웃 커밋: `ecc7541` — PR #63 병합
- 수동 백업: `before-restart.json`
- 날짜별 자동 백업은 11/26 새벽 4시 이후 생성 여부 확인 예정

### 최신 버전 재배포 확인 — 2026-11-25

- 서버 체크아웃 커밋: `3f8e69b` — PR #68까지 병합된 main
- 최신 코드로 Docker 이미지 빌드 및 운영 컨테이너 교체 완료
- 교체 후 컨테이너 `healthy` 확인
- HTTPS의 `/api/config` 응답에서 `roomsEnabled: false` 확인
- 교체 직전 백업: `before-update-20261125-163117.json`
- 백업과 현재 `/data/db.json`의 JSON 내용이 동일함을 확인
- 이미지의 `/app/seed/demo.json`을 기본 실행 사용자인 `node`로 읽기 성공
- 예시 데이터의 팀원 3명·작업 11개 확인
- 운영 환경은 방 기능 활성화 전까지 `ROOMS_ENABLED=0` 유지

### 로컬 방 기능 통합 점검 — 2026-11-25

최신 main `3f8e69b`에서 별도 임시 데이터와 포트 3001을 사용해
`ROOMS_ENABLED=1` 상태로 점검했습니다.

- 방 A·B의 팀원과 작업이 서로 분리됨을 확인
- 나가기 후 방 코드로 재입장하고 기존 팀원을 선택하는 흐름 확인
- 정원 2명 중 1명만 추정하면 비공개 유지
- 두 번째 팀원 입장 후에도 미제출 상태에서는 비공개 유지
- 전원 제출 후 추정값 3·5시간과 중앙값 4시간 공개
- 작업 크기 4시간, 가능한 시간 10·5시간에서 예상 부담률 40·80% 확인
- 추천만으로 담당자가 변경되지 않고 배정 버튼으로 반영됨을 확인
- 배정 후 부담률 40%, 완료 처리 후 작업량 0시간·부담률 0% 확인
- A방 변경 후에도 B방의 작업이 유지됨을 확인

운영 서버의 방 기능 활성화는 별도로 진행합니다.

## 추가 확인

- [x] 서버 시간대 `Asia/Seoul` 확인
- [x] 컨테이너 교체 후 화면의 기존 팀원·작업 유지 확인
- [ ] 새벽 예약으로 날짜별 백업 파일 생성 확인
- [x] 운영 컨테이너를 대상으로 한 복구 절차 정리
- [x] 최신 배포 커밋 기록
- [ ] 방 기능 전체 통합 검증 후 활성화
- [ ] 발표 전 배포 데이터 점검: 불필요한 테스트 작업을 삭제하거나 시연용 데이터로 정리
