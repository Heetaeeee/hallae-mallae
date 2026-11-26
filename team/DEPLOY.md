# 배포 기록과 운영 절차

배포 주소: [할래말래](https://hallaemallae.duckdns.org)

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
| 방 기능 | 활성화 준비 완료 전까지 `ROOMS_ENABLED=0` |

## 서버 접속

AWS EC2에서 인스턴스를 선택하고 연결 → SSM Session Manager로 접속합니다.

```bash
sudo -iu ubuntu
cd ~/3oss
```

`.env`와 실제 데이터는 저장소에 올리지 않습니다.
`.env` 권한은 600으로 유지합니다.

## 수동 업데이트

실행 중인 컨테이너의 이미지에 복귀용 태그를 남기고 최신 main으로 새 이미지를 빌드합니다.
컨테이너 교체 직전에 날짜가 포함된 파일로 데이터를 백업합니다.

다음 명령은 AWS 서버의 ubuntu 사용자로 실행합니다.
괄호 안에서 명령이 실패하면 이후 단계는 실행되지 않습니다.

```bash
cd ~/3oss

(
  set -e

  git pull --ff-only origin main

  DEPLOY_STAMP=$(date +%Y%m%d-%H%M%S)
  PREVIOUS_IMAGE="3oss:before-update-$DEPLOY_STAMP"
  BACKUP_FILE="$HOME/backups/before-update-$DEPLOY_STAMP.json"

  mkdir -p "$HOME/backups"
  chmod 700 "$HOME/backups"

  docker image tag \
    "$(docker inspect --format '{{.Image}}' 3oss-app)" \
    "$PREVIOUS_IMAGE"

  docker build -t 3oss .

  docker cp 3oss-app:/data/db.json "$BACKUP_FILE"
  chmod 600 "$BACKUP_FILE"

  printf '이전 이미지: %s\n' "$PREVIOUS_IMAGE"
  printf '데이터 백업: %s\n' "$BACKUP_FILE"

  docker stop 3oss-app
  docker rm 3oss-app

  docker run -d --name 3oss-app --init \
    --restart unless-stopped \
    -p 127.0.0.1:3000:3000 \
    --memory 512m \
    --env-file .env \
    -v 3oss-data:/data \
    3oss
)
```

표시된 이전 이미지 태그와 백업 경로를 배포 기록에 남깁니다.
복귀에 필요한 이미지와 백업은 확인 없이 삭제하지 않습니다.

컨테이너를 중지하거나 삭제한 뒤 실패했다면 서비스가 중단된 상태일 수 있으므로
오류를 확인하고 아래 운영 데이터 복구 절차에 따라 대응합니다.

교체 후 확인합니다.

```bash
docker ps
docker logs --tail 30 3oss-app
git log -1 --oneline
curl -fsS https://hallaemallae.duckdns.org/api/config
```

상태 검사가 `starting`이면 잠시 후 다시 확인합니다.
`healthy` 여부와 함께 배포 주소의 핵심 기능 및 저장 데이터 보존도 확인합니다.

데이터 볼륨 `3oss-data`는 삭제하지 않습니다.

## 백업

백업 위치는 `/home/ubuntu/backups`입니다.
서버 시간대가 `Asia/Seoul`인지 확인합니다.

ubuntu 사용자의 crontab에 다음 예약을 등록했습니다.

```cron
0 4 * * * /usr/bin/docker cp 3oss-app:/data/db.json /home/ubuntu/backups/db-$(date +\%F).json && chmod 600 /home/ubuntu/backups/db-$(date +\%F).json
```

예약 등록과 실제 실행 성공은 구분합니다.
예약 시간 이후 파일 생성 여부와 JSON 내용을 확인해야 합니다.

```bash
ls -lh /home/ubuntu/backups/db-$(date +%F).json
```

파일이 존재하는 것만으로 복구 가능성이 검증되지는 않습니다.
별도 테스트 볼륨에 복원하여 원본 백업과 내용이 일치하고 앱에서 읽히는지 확인합니다.

이 백업은 같은 EC2 디스크에 있으므로
서버·디스크 자체의 손실에 대비한 외부 백업은 아닙니다.

## 백업 복구 점검 — 별도 테스트 볼륨

운영 볼륨을 건드리지 않고 백업을 복원하고 읽을 수 있는지 확인하는 절차입니다.
다음 명령은 AWS 서버의 ubuntu 사용자로 실행합니다.

아래 예시는 기존 `{ members, tasks }` 형식의
`before-restart.json`을 대상으로 합니다.
방별 저장 형식의 백업은 해당 구조에 맞춰 별도로 검증해야 합니다.

복원할 백업 파일이 있는지 먼저 확인합니다.

```bash
ls -lh /home/ubuntu/backups/before-restart.json
```

별도 테스트 볼륨에 백업을 복사합니다.
각 명령이 성공했는지 확인한 뒤 다음 명령으로 진행합니다.

```bash
docker volume create 3oss-restore-check

docker run --rm --network none --user 0 \
  -v 3oss-restore-check:/data \
  -v /home/ubuntu/backups:/backup:ro \
  --entrypoint sh 3oss \
  -c 'cp /backup/before-restart.json /data/db.json && chown node:node /data/db.json'
```

복원 파일과 원본 백업의 JSON 내용을 비교하고,
앱에서 읽은 팀원·작업 수가 원본과 같은지도 확인합니다.

`load()`만 호출하면 파일이 없을 때 빈 데이터를 반환할 수 있으므로,
먼저 두 파일을 직접 읽고 비교합니다.

```bash
docker run --rm --network none \
  -e ROOMS_ENABLED=0 \
  -v 3oss-restore-check:/data \
  -v /home/ubuntu/backups:/backup:ro \
  --entrypoint node 3oss --input-type=module \
  -e '
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./src/lib/store.js";

const backup = JSON.parse(
  readFileSync("/backup/before-restart.json", "utf8")
);
const restored = JSON.parse(
  readFileSync("/data/db.json", "utf8")
);

assert.ok(Array.isArray(backup.members));
assert.ok(Array.isArray(backup.tasks));
assert.deepStrictEqual(restored, backup);

const db = load();
assert.deepStrictEqual(db.members, backup.members);
assert.deepStrictEqual(db.tasks, backup.tasks);

console.log("백업과 복원 파일 내용 일치");
console.log(
  "앱에서 읽은 팀원:", db.members.length,
  "명, 작업:", db.tasks.length, "개"
);
'
```

파일이 없거나 JSON·구조가 잘못됐거나 복원 내용이 다르면 실패합니다.
실패했을 때는 복구 점검 완료로 기록하지 않습니다.

이 절차는 별도 테스트 볼륨에서의 점검이며 운영 데이터 복구는 아닙니다.
운영 볼륨 `3oss-data`는 삭제하지 않습니다.

## 운영 데이터 복구 절차

운영 복구는 현재 데이터를 백업 시점으로 되돌립니다.
백업 이후의 변경 내용은 복구한 데이터에 포함되지 않습니다.

복구 중에는 서비스를 사용할 수 없으므로 팀원에게 작업 중단을 안내합니다.

1. 복원할 백업 파일과 해당 저장 형식을 읽을 수 있는 이미지 태그를 확인합니다.
2. `.env`의 기능 스위치와 저장 경로 등 실행 설정이 해당 이미지에 맞는지 확인합니다.
3. 현재 운영 데이터를 별도 파일로 백업하고 성공 여부를 확인합니다.
4. 운영 컨테이너를 중지합니다.
5. 선택한 백업을 운영 볼륨의 `/data/db.json`으로 복사하고 소유자를 실행 사용자인 `node`에 맞춥니다.
6. 기존 컨테이너를 교체하고 확인한 이미지 태그와 환경 설정으로 실행합니다.
7. 컨테이너 상태와 HTTPS 접속, 팀원·작업 데이터를 확인합니다.

각 단계가 실패하면 다음 단계로 진행하지 않습니다.

수동 업데이트 때 남긴 `3oss:before-update-날짜와시각` 태그를 사용하면
업데이트 전 실행 이미지를 선택할 수 있습니다.
이미지와 데이터 백업은 서로 호환되는 조합인지 확인해야 합니다.

방별 형식으로 이전한 데이터를 이전 코드로 되돌리는 경우에는
스위치를 끄는 것만으로 저장 형식이 복원되지 않습니다.
이전 전 백업 또는 이전 시 생성된 `.bak` 파일을 복원해야 합니다.

운영 볼륨을 대상으로 한 실제 복구는 아직 수행하지 않았습니다.

## 방 기능 활성화

기존 데이터 이전 방식의 보완과 전체 통합 검증을 마친 뒤
`ROOMS_ENABLED=1`로 변경합니다.

기존 배포 커밋 `3f8e69b`는 기존 데이터를 고정 코드 `LEGACY`로 이전합니다.

이를 보완해 활성화 시 `LEGACY`를 제외한 무작위 코드로 이전하도록
로컬 구현과 테스트를 완료했습니다.
main 병합 및 운영 배포가 완료됐는지 확인한 뒤 활성화해야 합니다.

이미 방별 저장 형식으로 이전된 파일의 코드는 이번 변경으로 바뀌지 않습니다.
운영 데이터가 이미 `LEGACY`로 이전된 상태라면 별도의 코드 변경 절차가 필요합니다.

- 무작위 코드 이전 후에도 기존 팀원·작업이 보존되고, 재조회 시 같은 방이 유지되는지 확인합니다.
- 활성화 직전에 기존 `db.json`을 수동 백업하고, 실행 이미지 태그와 환경 설정을 기록합니다.
- 활성화한 상태에서 기존 파일을 처음 읽으면 방별 저장 형식으로 이전되며 `/data`에 `.bak` 백업이 생성됩니다.
- 환경 변수 변경은 실행 중인 컨테이너에 자동 반영되지 않으므로 새 설정으로 컨테이너를 교체합니다.
- 활성화 후 배포 주소에서 방 생성·입장·추정·추천·배정과 방별 데이터 분리를 확인합니다.
- 이전 코드로 복귀할 때는 앱을 중지하고 이전 전 백업 또는 `.bak` 파일을 복원한 뒤 호환되는 이미지로 실행합니다.

이 보완과 검증이 완료되기 전에는 운영 환경의 `ROOMS_ENABLED=0`을 유지합니다.
무작위 방 코드는 본인 확인이나 사용자별 권한을 제공하지 않습니다.

### 활성화 후 기존 방 코드 확인

환경 변수를 켜는 것만으로 데이터가 즉시 이전되지는 않습니다.
`/api/config` 조회도 이전을 실행하지 않습니다.
저장소 함수를 처음 호출할 때 이전됩니다.

새 이미지 배포와 활성화 직전 백업을 완료하고,
`ROOMS_ENABLED=1`로 운영 컨테이너를 교체한 뒤 다음을 실행합니다.

아래 명령은 앱의 저장소 함수를 호출하므로 기존 형식이면
백업·이전을 실행하고, 이미 이전됐다면 저장된 기본 방 코드를 반환합니다.

```bash
docker exec 3oss-app node --input-type=module -e '
import { getDefaultRoomCode } from "./src/lib/store.js";

if (process.env.ROOMS_ENABLED !== "1") {
  throw new Error("방 기능 활성화 설정을 먼저 확인해 주세요.");
}

const code = getDefaultRoomCode();

if (code === "LEGACY") {
  throw new Error("이미 LEGACY로 이전된 데이터입니다. 별도 코드 변경 절차가 필요합니다.");
}

console.log("기존 팀의 방 코드:", code);
'
```

출력된 코드는 기존 팀원에게 전달합니다.
백업 파일과 이전 후 팀원·작업의 보존 여부도 확인합니다.

## 검증 기록 — 2026-11-25

- HTTPS 외부 접속 성공
- `certbot renew --dry-run` 성공
- 컨테이너 `healthy` 확인
- 서버 재부팅 후 팀원·작업 유지 확인
- 컨테이너 교체 후 `healthy` 확인
- 자동 백업 예약 등록 및 cron 서비스 활성 확인
- 별도 볼륨 `3oss-restore-check`에 백업을 복사하고 앱의 `load()`로 읽기 성공

위 복구 검증은 당시의 백업 복사·앱 읽기 확인 결과입니다.
문서 보완으로 추가한 원본·복원 파일 전체 비교 명령은 별도 실행 확인이 필요합니다.

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

이후 문서에 추가한 날짜별 이전 이미지 태그 보존 절차는
위 배포 당시 수행한 검증 기록과 구분합니다.

### 로컬 방 기능 통합 점검 — 2026-11-25

main `3f8e69b`에서 별도 임시 데이터와 포트 3001을 사용해
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
- 현재 참여 중인 팀원을 삭제하면 입장 화면으로 돌아감을 확인
- 재입장 목록에서 삭제된 팀원은 제외되고 다른 팀원은 유지됨을 확인

운영 서버의 방 기능 활성화는 별도로 진행합니다.

## 추가 확인

- [x] 서버 시간대 `Asia/Seoul` 확인
- [x] 컨테이너 교체 후 저장 데이터 유지 확인 — 교체 직전 백업과 현재 저장 데이터의 JSON 내용이 동일함
- [x] 별도 테스트 볼륨에서 백업 복사와 앱의 데이터 읽기 확인
- [x] 운영 데이터 복구 절차 정리 — 실제 운영 볼륨 복구는 미수행
- [x] 배포 커밋 `3f8e69b` 기록
- [ ] 새벽 예약으로 날짜별 백업 파일 생성 확인
- [ ] 강화한 복구 점검 명령으로 원본·복원 파일과 앱 데이터 비교 확인
- [ ] 다음 배포에서 이전 이미지 태그 보존과 날짜별 백업 절차 실행 확인
- [x] 기존 형식 데이터의 무작위 방 코드 이전 구현 및 로컬 테스트 — 전체 194개 통과
- [ ] 무작위 방 코드 이전 변경의 main 병합 및 운영 배포
- [ ] 방 기능 전체 통합 검증 후 운영 활성화
- [ ] 발표 전 배포 데이터 점검: 불필요한 테스트 작업을 삭제하거나 시연용 데이터로 정리