const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  PermissionsBitField, 
  Partials 
} = require('discord.js');
const { token } = require('./config.json');

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

const serverSettings = new Map();
const videoDatabase = new Map();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

function saveVideoData(guildId, messageId, data) {
  if (!videoDatabase.has(guildId)) {
      videoDatabase.set(guildId, new Map());
  }
  videoDatabase.get(guildId).set(messageId, {
      ...data,
      timestamp: new Date(),
  });
}

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!') || message.author.bot) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'setup') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
          return message.reply('이 명령어는 관리자만 사용할 수 있습니다.');
      }
      serverSettings.set(message.guildId, message.channelId);
      await message.reply({
          embeds: [
              new EmbedBuilder()
                  .setTitle('채널 설정 완료')
                  .setDescription('현재 채널이 비디오 채널로 설정되었습니다.')
                  .setColor('#00FF00')
          ]
      });
  } else if (command === 'search') {
      const searchQuery = args.join(' ').toLowerCase();
      const guildVideos = videoDatabase.get(message.guildId);
      if (!guildVideos) return message.reply('저장된 비디오가 없습니다.');

      const searchResults = Array.from(guildVideos.values())
          .filter(video => video.title.toLowerCase().includes(searchQuery))
          .slice(0, 5);

      if (searchResults.length === 0) return message.reply('검색 결과가 없습니다.');

      const searchEmbed = new EmbedBuilder()
          .setTitle('검색 결과')
          .setDescription(
              searchResults.map(video => 
                  `[${video.title}](${video.url}) - 좋아요: ${video.likes}`
              ).join('\n')
          )
          .setColor('#00FF00');

      await message.reply({ embeds: [searchEmbed] });
  } else if (command === 'top') {
      const period = args[0]?.toLowerCase();
      const guildVideos = videoDatabase.get(message.guildId);
      if (!guildVideos) return message.reply('저장된 비디오가 없습니다.');

      const now = new Date();
      const videos = Array.from(guildVideos.values())
          .filter(video => {
              if (period === 'month') {
                  return video.timestamp.getMonth() === now.getMonth() &&
                         video.timestamp.getFullYear() === now.getFullYear();
              } else if (period === 'year') {
                  return video.timestamp.getFullYear() === now.getFullYear();
              }
              return true;
          })
          .sort((a, b) => b.likes - a.likes)
          .slice(0, 5);

      const periodText = period === 'month' ? '이번 달' : 
                        period === 'year' ? '올해' : '전체';

      const topEmbed = new EmbedBuilder()
          .setTitle(`${periodText} 인기 영상 TOP 5`)
          .setDescription(
              videos.map((video, index) => 
                  `${index + 1}. [${video.title}](${video.url}) - 좋아요: ${video.likes}`
              ).join('\n')
          )
          .setColor('#00FF00');

      await message.reply({ embeds: [topEmbed] });
  }
});

client.on('messageCreate', async (message) => {
  const videoChannelId = serverSettings.get(message.guildId);
  
  if (message.channelId !== videoChannelId) return;
  if (message.author.bot) return;

  const videoAttachment = message.attachments.find(
      (attachment) => attachment.contentType?.startsWith('video/')
  );

  if (videoAttachment) {
      try {
          const titlePrompt = await message.reply('영상의 제목을 입력해주세요 (30초 안에 입력해주세요)');

          const collected = await message.channel.awaitMessages({
              filter: (m) => m.author.id === message.author.id,
              max: 1,
              time: 30000,
              errors: ['time']
          });

          const title = collected.first().content;

          const videoEmbed = new EmbedBuilder()
              .setTitle(title)
              .setAuthor({
                  name: message.author.username,
                  iconURL: message.author.displayAvatarURL()
              })
              .setDescription(`
                  업로더: ${message.author.username}
                  [영상 보기](${videoAttachment.url})
              `)
              .addFields(
                  { name: '좋아요', value: '0', inline: true }
              )
              .setTimestamp();

          const postedVideo = await message.channel.send({
              files: [videoAttachment], 
              embeds: [videoEmbed]
          });
          await postedVideo.react('👍');

          const thread = await postedVideo.startThread({
              name: `💬 ${title} 댓글`,
              autoArchiveDuration: 1440, 
          });

          await thread.send({
              embeds: [
                  new EmbedBuilder()
                      .setDescription('이 쓰레드에서 영상에 대한 의견을 나눠보세요!')
                      .setColor('#00FF00')
              ]
          });

          saveVideoData(message.guildId, postedVideo.id, {
              title: title,
              url: videoAttachment.url,
              likes: 0,
              author: message.author.id,
              threadId: thread.id
          });

          await message.delete();
          await titlePrompt.delete();
          await collected.first().delete();

      } catch (error) {
          if (error.code === 'CollectorError') {
              message.reply('제목 입력 시간이 초과되었습니다. 다시 시도해주세요.');
          } else {
              console.error(error);
              message.reply('영상 업로드 중 오류가 발생했습니다.');
          }
      }
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  
  if (reaction.partial) {
      try {
          await reaction.fetch();
      } catch (error) {
          console.error('리액션 정보를 가져오는데 실패했습니다:', error);
          return;
      }
  }

  const videoChannelId = serverSettings.get(reaction.message.guildId);
  if (reaction.message.channelId !== videoChannelId) return;
  if (reaction.emoji.name !== '👍') return;

  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  if (!message.embeds.length) return;

  try {
      const likeReaction = message.reactions.cache.get('👍');
      const likeCount = likeReaction ? likeReaction.count - 1 : 0;

      const embed = EmbedBuilder.from(message.embeds[0]);
      embed.spliceFields(0, 1, { name: '좋아요', value: likeCount.toString(), inline: true });
      
      await message.edit({ embeds: [embed] });

      const guildVideos = videoDatabase.get(message.guildId);
      if (guildVideos && guildVideos.has(message.id)) {
          const videoData = guildVideos.get(message.id);
          videoData.likes = likeCount;
          guildVideos.set(message.id, videoData);
      }
  } catch (error) {
      console.error('임베드 업데이트 실패:', error);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  
  if (reaction.partial) {
      try {
          await reaction.fetch();
      } catch (error) {
          console.error('리액션 정보를 가져오는데 실패했습니다:', error);
          return;
      }
  }

  const videoChannelId = serverSettings.get(reaction.message.guildId);
  if (reaction.message.channelId !== videoChannelId) return;
  if (reaction.emoji.name !== '👍') return;

  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  if (!message.embeds.length) return;
  
  try {
      const likeReaction = message.reactions.cache.get('👍');
      const likeCount = likeReaction ? likeReaction.count - 1 : 0;

      const embed = EmbedBuilder.from(message.embeds[0]);
      embed.spliceFields(0, 1, { name: '좋아요', value: likeCount.toString(), inline: true });
      
      await message.edit({ embeds: [embed] });

      const guildVideos = videoDatabase.get(message.guildId);
      if (guildVideos && guildVideos.has(message.id)) {
          const videoData = guildVideos.get(message.id);
          videoData.likes = likeCount;
          guildVideos.set(message.id, videoData);
      }
  } catch (error) {
      console.error('임베드 업데이트 실패:', error);
  }
});

client.login(token);