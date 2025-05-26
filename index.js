const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  Partials,
} = require("discord.js");
const path = require("path");
const axios = require("axios");
const amqp = require("amqplib");
const fs = require("fs").promises;
const fsSync = require("fs");

const ENV = process.env.NODE_ENV || "development";
const configFileName =
  ENV === "production" ? "./config.prod.json" : "./config.json";

let config;
try {
  config = require(configFileName);
  console.log(`✅ 설정 파일 로드 완료: ${configFileName}`);
} catch (error) {
  console.error(`❌ 설정 파일 로드 실패: ${configFileName}`, error.message);
  process.exit(1);
}

const { TOKEN, RABBITMQ_URL, BACKEND_SERVER_URL } = config;

const CONSTANTS = {
  EXCHANGE_NAME: "video_exchange",
  QUEUE_NAME: "video.result.queue",
  CONFIG_FILE: "./channelConfig.json",
  TEMP_DIR: path.resolve("./temp"),
  VIDEO_EXTENSIONS: [".mp4", ".mov", ".avi", ".mkv"],
  MAX_FILE_SIZE: 10 * 1024 * 1024,
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.ThreadMember,
  ],
});

// 클래스로 설정 관리 분리
class ConfigManager {
  constructor(configFile) {
    this.configFile = configFile;
    this.videoChannels = {};
  }

  async load() {
    try {
      if (fsSync.existsSync(this.configFile)) {
        const data = await fs.readFile(this.configFile, "utf8");
        this.videoChannels = JSON.parse(data);
        console.log("✅ 채널 설정 파일을 로드했습니다.");
      } else {
        console.log("❗ 채널 설정 파일이 없습니다. 새로 생성됩니다.");
        await this.save();
      }
    } catch (err) {
      console.error("❌ 채널 설정 파일 로드 오류:", err);
      this.videoChannels = {};
    }
  }

  async save() {
    try {
      await fs.writeFile(
        this.configFile,
        JSON.stringify(this.videoChannels, null, 2)
      );
      console.log("✅ 채널 설정 파일이 저장되었습니다.");
    } catch (err) {
      console.error("❌ 채널 설정 파일 저장 오류:", err);
    }
  }

  setVideoChannel(serverId, channelId) {
    this.videoChannels[serverId] = channelId;
  }

  getVideoChannel(serverId) {
    return this.videoChannels[serverId];
  }

  isVideoChannel(serverId, channelId) {
    return this.videoChannels[serverId] === channelId;
  }
}

class FileManager {
  static async ensureTempDir() {
    try {
      await fs.access(CONSTANTS.TEMP_DIR);
    } catch {
      await fs.mkdir(CONSTANTS.TEMP_DIR, { recursive: true });
      console.log(`📁 임시 디렉토리 생성 완료: ${CONSTANTS.TEMP_DIR}`);
    }
  }

  static generateSafeFileName(url) {
    try {
      let fileName = path.basename(new URL(url).pathname);
      if (!fileName || fileName === "") {
        fileName = `video_${Date.now()}.mp4`;
      }

      return fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    } catch {
      return `video_${Date.now()}.mp4`;
    }
  }

  static async cleanupFile(filePath) {
    try {
      await fs.unlink(filePath);
      console.log(`🗑️ 임시 파일 삭제 완료: ${filePath}`);
    } catch (error) {
      console.error(`⚠️ 임시 파일 삭제 실패: ${filePath}`, error.message);
    }
  }

  static async downloadFile(url, filePath) {
    const writer = fsSync.createWriteStream(filePath);

    const response = await axios({
      method: "get",
      url: url,
      responseType: "stream",
      timeout: 30000, // 30초 타임아웃
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  static async getFileStats(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats;
    } catch (error) {
      throw new Error(`파일 정보 조회 실패: ${error.message}`);
    }
  }
}

class DiscordManager {
  static async sendErrorMessage(channelId, message) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel) {
        await channel.send(`❌ ${message}`);
      }
    } catch (error) {
      console.error(`❌ 오류 메시지 전송 실패:`, error);
    }
  }

  static async uploadVideo(channelId, videoUrl, caption) {
    let tempFilePath = null;

    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel) {
        throw new Error(`채널을 찾을 수 없습니다: ${channelId}`);
      }

      console.log(`🔄 비디오 다운로드 시작: ${videoUrl}`);

      await FileManager.ensureTempDir();

      const fileName = FileManager.generateSafeFileName(videoUrl);
      tempFilePath = path.join(CONSTANTS.TEMP_DIR, fileName);

      console.log(`📄 임시 파일 경로: ${tempFilePath}`);

      // 파일 다운로드
      await FileManager.downloadFile(videoUrl, tempFilePath);
      console.log(`✅ 비디오 다운로드 완료: ${tempFilePath}`);

      // 파일 검증
      const stats = await FileManager.getFileStats(tempFilePath);
      console.log(`📊 다운로드된 파일 크기: ${stats.size} 바이트`);

      if (stats.size === 0) {
        throw new Error("다운로드된 파일의 크기가 0입니다.");
      }

      if (stats.size > CONSTANTS.MAX_FILE_SIZE) {
        throw new Error(
          `파일 크기가 너무 큽니다. (${Math.round(
            stats.size / 1024 / 1024
          )}MB > 25MB)`
        );
      }

      console.log(`📤 Discord에 파일 업로드 시작...`);
      await channel.send({
        content: caption,
        files: [{ attachment: tempFilePath, name: fileName }],
      });

      console.log(`✅ 영상 업로드 완료: ${fileName}`);
    } catch (error) {
      console.error(`❌ 비디오 업로드 실패:`, error);
      await DiscordManager.sendErrorMessage(
        channelId,
        `영상 처리 중 오류가 발생했습니다: ${error.message}`
      );
      throw error;
    } finally {
      // 임시 파일 정리
      if (tempFilePath) {
        await FileManager.cleanupFile(tempFilePath);
      }
    }
  }

  static isVideoFile(filename) {
    const ext = path.extname(filename || "").toLowerCase();
    return CONSTANTS.VIDEO_EXTENSIONS.includes(ext);
  }
}

class BackendAPI {
  static async submitVideo(data) {
    try {
      await axios.post(
        `${BACKEND_SERVER_URL}/video`,
        {
          ...data,
          callbackQueue: CONSTANTS.QUEUE_NAME,
        },
        {
          timeout: 10000, // 10초 타임아웃
        }
      );
    } catch (error) {
      console.error("❌ API 서버 요청 실패:", error.message);
      throw new Error("영상 처리 요청 중 오류가 발생했습니다.");
    }
  }
}

class RabbitMQManager {
  constructor() {
    this.connection = null;
    this.channel = null;
  }

  async connect() {
    try {
      this.connection = await amqp.connect(RABBITMQ_URL);
      this.channel = await this.connection.createChannel();

      await this.channel.assertExchange(CONSTANTS.EXCHANGE_NAME, "topic", {
        durable: true,
      });
      await this.channel.assertQueue(CONSTANTS.QUEUE_NAME, { durable: true });
      await this.channel.bindQueue(
        CONSTANTS.QUEUE_NAME,
        CONSTANTS.EXCHANGE_NAME,
        CONSTANTS.QUEUE_NAME
      );

      console.log(`📥 RabbitMQ 연결 완료. Queue: ${CONSTANTS.QUEUE_NAME}`);

      this.connection.on("error", (err) => {
        console.error("❌ RabbitMQ 연결 오류:", err);
      });

      this.connection.on("close", () => {
        console.log("🔌 RabbitMQ 연결이 종료되었습니다.");
      });
    } catch (error) {
      console.error("❌ RabbitMQ 연결 실패:", error.message);
      throw error;
    }
  }

  async startListening() {
    if (!this.channel) {
      throw new Error("RabbitMQ 채널이 초기화되지 않았습니다.");
    }

    this.channel.consume(
      CONSTANTS.QUEUE_NAME,
      async (msg) => {
        if (msg !== null) {
          await this.processMessage(msg);
        }
      },
      { noAck: false }
    );
  }

  async processMessage(msg) {
    const content = msg.content.toString();
    console.log("📨 메시지 수신:", content);

    try {
      const data = JSON.parse(content);

      if (!data.processedFilePath) {
        throw new Error("영상 URL이 없습니다");
      }

      if (!data.channelId) {
        throw new Error("채널 ID가 없습니다");
      }

      if (data.success) {
        console.log(`🎬 영상 처리 성공: ${data.videoId}`);

        const caption = data.caption || `✅ 처리된 영상 (ID: ${data.videoId})`;
        await DiscordManager.uploadVideo(
          data.channelId,
          data.processedFilePath,
          caption
        );
      } else {
        console.error(`❌ 영상 처리 실패: ${data.error}`);
        await DiscordManager.sendErrorMessage(
          data.channelId,
          `영상 처리 실패: ${data.error}`
        );
      }
    } catch (error) {
      console.error("❌ 메시지 처리 실패:", error.message);

      try {
        const data = JSON.parse(content);
        if (data.channelId) {
          await DiscordManager.sendErrorMessage(
            data.channelId,
            `오류 발생: ${error.message}`
          );
        }
      } catch {}
    } finally {
      this.channel.ack(msg);
    }
  }

  async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      console.log("🔌 RabbitMQ 연결 종료 완료");
    } catch (error) {
      console.error("❌ RabbitMQ 연결 종료 실패:", error);
    }
  }
}

const configManager = new ConfigManager(CONSTANTS.CONFIG_FILE);
const rabbitMQManager = new RabbitMQManager();

client.once("ready", async () => {
  console.log(`🤖 봇 로그인 완료: ${client.user.tag}`);
  console.log(`🌍 환경: ${ENV}`);

  await configManager.load();

  try {
    await rabbitMQManager.connect();
    await rabbitMQManager.startListening();
  } catch (error) {
    console.error("❌ RabbitMQ 초기화 실패:", error);
    process.exit(1);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith("!setup")) {
    if (
      !message.member.permissions.has(PermissionsBitField.Flags.Administrator)
    ) {
      return message.reply("❌ 이 명령어는 관리자만 사용할 수 있습니다.");
    }

    const serverId = message.guildId;
    const channelId = message.channelId;

    configManager.setVideoChannel(serverId, channelId);
    await configManager.save();

    return message.reply(`✅ 이 채널이 영상 처리 채널로 설정되었습니다!`);
  }

  if (message.attachments.size > 0) {
    const serverId = message.guildId;

    if (!configManager.isVideoChannel(serverId, message.channelId)) {
      return; // 지정된 채널이 아니면 무시
    }

    for (const [, attachment] of message.attachments) {
      if (!DiscordManager.isVideoFile(attachment.name)) {
        continue;
      }

      try {
        await BackendAPI.submitVideo({
          serverId: message.guildId,
          channelId: message.channelId,
          senderId: message.author.id,
          videoUrl: attachment.url,
          fileName: attachment.name,
        });

        await message.reply("✅ 영상이 처리 대기열에 등록되었습니다!");
      } catch (error) {
        console.error("❌ 영상 제출 실패:", error.message);
        await message.reply("❌ 영상 처리 요청 중 오류가 발생했습니다.");
      }
    }
  }
});

process.on("SIGINT", async () => {
  console.log("🛑 프로세스 종료 신호 수신...");

  await rabbitMQManager.disconnect();

  if (client.isReady()) {
    client.destroy();
  }

  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("❌ 처리되지 않은 예외:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ 처리되지 않은 Promise 거부:", reason);
});

client.login(TOKEN).catch((error) => {
  console.error("❌ Discord 봇 로그인 실패:", error);
  process.exit(1);
});
