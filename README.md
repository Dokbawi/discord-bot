# Discord Video Bot

Discord 서버에서 업로드된 영상을 처리하는 봇입니다.
영상 데이터를 받아 업스케일링 및 음성 처리 작업을 진행하고 처리된 영상 데이터를 다시 해당 채널에 업로드합니다.

## 🚀 주요 기능

- **영상 자동 처리**: 지정된 채널에 업로드된 영상 파일을 자동으로 감지하고 처리
- **서버별 채널 설정**: 각 Discord 서버마다 독립적인 영상 처리 채널 설정
- **비동기 처리**: RabbitMQ를 통한 백엔드 서버와의 비동기 통신
- **영상 재업로드**: 처리 완료된 영상을 Discord 채널에 업로드

## 🛠️ 설치 및 설정

### 1. 프로젝트 클론

```bash
git clone <repository-url>
cd discord-bot
npm install
```

### 2. 환경 설정

**config.json** (개발 환경)

```json
{
  "TOKEN": "your-discord-bot-token",
  "RABBITMQ_URL": "amqp://localhost:5672",
  "BACKEND_SERVER_URL": "http://localhost:3000"
}
```

### 3. Discord Bot 설정

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 새 애플리케이션 생성
2. Bot 섹션에서 토큰 생성
3. 다음 권한을 봇에 부여:
   - Send Messages
   - Attach Files
   - Read Message History
   - View Channels

## ☁️ GCP Cloud Build 자동 배포

Google Cloud Build를 사용해 자동으로 이미지가 배포됩니다.

### 배포 과정

1. `master` 브랜치에 코드 푸시
2. Cloud Build가 자동으로 트리거됨
3. Docker 이미지 빌드 및 Container Registry에 푸시
4. 새 이미지로 서비스 업데이트

## 🎮 사용법

### 1. 봇을 Discord 서버에 초대

생성된 봇 초대 링크를 통해 서버에 봇을 추가합니다.

### 2. 영상 처리 채널 설정

Discord 서버에서 관리자 권한으로 다음 명령어를 실행:

```
!setup
```

명령어를 실행한 채널이 영상 처리 전용 채널로 설정됩니다.

### 3. 영상 업로드 및 처리

- 설정된 채널에 영상 파일을 업로드
- 봇이 자동으로 백엔드 서버에 처리 요청
- 처리 완료 후 같은 채널에 결과 영상 업로드

## 📁 프로젝트 구조

```
discord-bot/
├── index.js              # 메인 봇 로직
├── config.json           # 개발 환경 설정
├── config-prod.json      # 운영 환경 설정
├── channelConfig.json    # 서버별 채널 설정 (자동 생성)
├── temp/                 # 임시 파일 저장소
├── Dockerfile            # Docker 설정
├── cloudbuild.yaml       # Cloud Build 설정
├── package.json          # 프로젝트 의존성
└── README.md
```

## ⚙️ 주요 클래스

- **ConfigManager**: 서버별 채널 설정 관리
- **FileManager**: 파일 다운로드 및 임시 파일 관리
- **DiscordManager**: Discord API 상호작용
- **BackendAPI**: 백엔드 서버와의 통신
- **RabbitMQManager**: RabbitMQ 큐 관리 및 메시지 처리

## 🔗 관련 프로젝트

- [Winter cat video](https://github.com/Dokbawi/winter-cat-video) - Discord 영상 관련 API 서버
- [Codex Media](https://github.com/Dokbawi/codex-media) - 영상 처리 백엔드 서비스
- [Discord helm](https://github.com/Dokbawi/discord-video-helm) - 서비스 k8s 관리 helm chart
