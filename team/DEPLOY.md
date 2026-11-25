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

## 추가 확인

- [x] 서버 시간대 `Asia/Seoul` 확인
- [ ] 컨테이너 교체 후 화면의 기존 팀원·작업 유지 확인
- [ ] 새벽 예약으로 날짜별 백업 파일 생성 확인
- [ ] 운영 컨테이너를 대상으로 한 복구 절차 정리
- [ ] 최신 배포 커밋 기록
- [ ] 방 기능 전체 통합 검증 후 활성화