const { Client, GatewayIntentBits, EmbedBuilder, Partials, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const cron = require('node-cron');

class DiscordBot {
    constructor(config, backupManager) {
        this.config = config;
        this.backupManager = backupManager;
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ],
            partials: [Partials.Channel, Partials.Message]
        });
        this.channelId = config.discord_bot?.channel_id || '1434895763414188154';
        this.allowedUserIds = config.discord_bot?.allowed_users || [];
        this.lastMessageId = null;
        this.isReady = false;
        this.messageQueue = [];
        this.isProcessingQueue = false;
        this.lastEditTime = 0;
        this.editCooldown = 5000;

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.client.on('ready', async () => {
            console.log(`✅ Bot conectado como ${this.client.user.tag}`);
            console.log(`📝 Canal configurado: ${this.channelId}`);
            this.isReady = true;

            // Registrar comandos slash
            await this.registerSlashCommands();

            this.setupScheduler();
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isCommand()) return;

            // Verificar permissões
            if (!this.isUserAllowed(interaction.user.id)) {
                await interaction.reply({
                    content: '❌ Você não tem permissão para usar este comando.',
                    ephemeral: true
                });
                return;
            }

            await this.handleSlashCommand(interaction);
        });

        this.client.on('error', (error) => {
            console.error('❌ Erro no bot Discord:', error);
        });
    }

    isUserAllowed(userId) {
        if (this.allowedUserIds.length === 0) return true; // Se não configurado, permite todos
        return this.allowedUserIds.includes(userId);
    }

    async registerSlashCommands() {
        try {
            const rest = new REST({ version: '10' }).setToken(this.config.discord_bot.token);

            const commands = [
                new SlashCommandBuilder()
                    .setName('backup')
                    .setDescription('Executar backup manualmente')
                    .addStringOption(option =>
                        option.setName('tipo')
                            .setDescription('Tipo de backup')
                            .setRequired(false)
                            .addChoices(
                                { name: 'Completo', value: 'full' },
                                { name: 'Apenas Bancos', value: 'database' },
                                { name: 'Apenas Arquivos', value: 'files' }
                            )
                    ),
                new SlashCommandBuilder()
                    .setName('backup_status')
                    .setDescription('Ver status dos backups'),
                new SlashCommandBuilder()
                    .setName('backup_schedule')
                    .setDescription('Ver horários agendados'),
                new SlashCommandBuilder()
                    .setName('backup_cleanup')
                    .setDescription('Executar limpeza de backups antigos'),
                new SlashCommandBuilder()
                    .setName('backup_list')
                    .setDescription('Listar backups realizados')
            ].map(command => command.toJSON());

            // Usar applicationCommands sem especificar guild - comandos globais
            const data = await rest.put(
                Routes.applicationCommands(this.config.discord_bot.client_id), // Usar client_id do config
                { body: commands }
            );

            console.log(`✅ ${data.length} comandos slash registrados com sucesso!`);
        } catch (error) {
            console.error('❌ Erro ao registrar comandos:', error);
            // Não lançar erro para não quebrar a aplicação
        }
    }

    async handleSlashCommand(interaction) {
        const { commandName, options } = interaction;

        try {
            switch (commandName) {
                case 'backup':
                    await interaction.deferReply();
                    const tipo = options.getString('tipo') || 'full';
                    await this.executeManualBackup(interaction, tipo);
                    break;

                case 'backup_status':
                    await interaction.reply({ embeds: [await this.getStatusEmbed()] });
                    break;

                case 'backup_schedule':
                    await interaction.reply({ embeds: [this.getScheduleEmbed()] });
                    break;

                case 'backup_cleanup':
                    await interaction.deferReply();
                    await this.executeCleanup(interaction);
                    break;

                case 'backup_list':
                    await interaction.deferReply();
                    await this.listBackups(interaction);
                    break;
            }
        } catch (error) {
            console.error(`❌ Erro no comando ${commandName}:`, error);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply('❌ Ocorreu um erro ao executar o comando.');
            } else {
                await interaction.reply('❌ Ocorreu um erro ao executar o comando.');
            }
        }
    }

    async executeManualBackup(interaction, tipo) {
        const embed = new EmbedBuilder()
            .setTitle('🔄 Backup Manual Iniciado')
            .setDescription(`Tipo: ${this.getBackupTypeName(tipo)}`)
            .setColor(0xFFFF00)
            .addFields(
                { name: '👤 Solicitado por', value: interaction.user.tag, inline: true },
                { name: '⏰ Início', value: new Date().toLocaleString('pt-BR'), inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        try {
            // Aqui você pode adaptar o backupManager para aceitar diferentes tipos
            const result = await this.backupManager.executeManualBackup();

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Backup Concluído')
                .setDescription('Backup manual executado com sucesso!')
                .setColor(0x00FF00)
                .addFields(
                    { name: '📊 Arquivos Processados', value: `${result.filesProcessed}/${result.totalFiles}`, inline: true },
                    { name: '💾 Tamanho Total', value: `${result.totalSizeMB}MB`, inline: true },
                    { name: '⏱️ Duração', value: result.duration, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('💥 Erro no Backup')
                .setDescription('Ocorreu um erro durante o backup manual')
                .setColor(0xFF0000)
                .addFields(
                    { name: '❌ Erro', value: error.message, inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }

    async executeCleanup(interaction) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('🧹 Iniciando Limpeza')
                .setDescription('Executando limpeza de backups antigos...')
                .setColor(0xFFFF00)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

            // Executar limpeza
            await this.backupManager.cleanupManager.cleanupRemote();

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Limpeza Concluída')
                .setDescription('Backups antigos foram removidos conforme configuração')
                .setColor(0x00FF00)
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('💥 Erro na Limpeza')
                .setDescription('Ocorreu um erro durante a limpeza')
                .setColor(0xFF0000)
                .addFields(
                    { name: '❌ Erro', value: error.message, inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }

    async listBackups(interaction) {
        try {
            const backupFiles = await this.backupManager.cleanupManager.listBackupFiles();

            const embed = new EmbedBuilder()
                .setTitle('📋 Backups no Google Drive')
                .setColor(0x0099FF)
                .setTimestamp();

            if (backupFiles.length === 0) {
                embed.setDescription('Nenhum backup encontrado no Google Drive');
            } else {
                const recentBackups = backupFiles.slice(0, 10); // Mostrar apenas os 10 mais recentes

                embed.setDescription(`Total de backups: ${backupFiles.length}\nMostrando os 10 mais recentes:`);

                recentBackups.forEach((file, index) => {
                    const fileDate = new Date(file.createdTime).toLocaleString('pt-BR');
                    const sizeMB = file.size ? Math.round(file.size / 1024 / 1024) : 'N/A';

                    embed.addFields({
                        name: `📄 ${file.name}`,
                        value: `Data: ${fileDate}\nTamanho: ${sizeMB}MB`,
                        inline: false
                    });
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('💥 Erro ao Listar Backups')
                .setDescription('Ocorreu um erro ao buscar a lista de backups')
                .setColor(0xFF0000)
                .addFields(
                    { name: '❌ Erro', value: error.message, inline: false }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }

    getBackupTypeName(tipo) {
        const types = {
            'full': 'Completo (Bancos + Arquivos)',
            'database': 'Apenas Bancos de Dados',
            'files': 'Apenas Arquivos'
        };
        return types[tipo] || 'Completo';
    }

    async getStatusEmbed() {
        const backupFiles = await this.backupManager.cleanupManager.listBackupFiles();
        const recentBackup = backupFiles[0];

        const embed = new EmbedBuilder()
            .setTitle('📊 Status do Sistema de Backup')
            .setColor(0x0099FF)
            .addFields(
                { name: '🔧 Status do Bot', value: this.isReady ? '✅ Online' : '❌ Offline', inline: true },
                { name: '📁 Total de Backups', value: backupFiles.length.toString(), inline: true },
                { name: '🕒 Último Backup', value: recentBackup ? new Date(recentBackup.createdTime).toLocaleString('pt-BR') : 'Nenhum', inline: true }
            )
            .setTimestamp();

        return embed;
    }

    getScheduleEmbed() {
        const scheduleTimes = this.config.backup_schedule || ['03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '00:00'];

        const embed = new EmbedBuilder()
            .setTitle('🕒 Horários de Backup Agendados')
            .setColor(0x0099FF)
            .setDescription('Backups automáticos são executados nos seguintes horários:')
            .addFields(
                { name: '📅 Horários', value: scheduleTimes.join('\n'), inline: false }
            )
            .setTimestamp();

        return embed;
    }

    // Sistema de fila para evitar flood de edições
    async queueMessageUpdate(embedData) {
        this.messageQueue.push(embedData);
        if (!this.isProcessingQueue) {
            await this.processMessageQueue();
        }
    }

    async processMessageQueue() {
        if (this.isProcessingQueue || this.messageQueue.length === 0) return;

        this.isProcessingQueue = true;

        while (this.messageQueue.length > 0) {
            const now = Date.now();
            const timeSinceLastEdit = now - this.lastEditTime;

            // Aguardar cooldown se necessário
            if (timeSinceLastEdit < this.editCooldown) {
                await new Promise(resolve => setTimeout(resolve, this.editCooldown - timeSinceLastEdit));
            }

            const embedData = this.messageQueue.shift();
            await this.sendBackupMessage(embedData);
            this.lastEditTime = Date.now();
        }

        this.isProcessingQueue = false;
    }

    async sendBackupMessage({ status, title, description, fields = [] }) {
        if (!this.isReady) {
            console.log('🤖 Bot não está pronto, mensagem não enviada:', title);
            return;
        }

        try {
            const channel = await this.client.channels.fetch(this.channelId);
            if (!channel) {
                console.error(`❌ Canal não encontrado: ${this.channelId}`);
                return;
            }

            const color = this.getColorByStatus(status);
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(color)
                .addFields(fields)
                .setTimestamp();

            if (status === 'error') {
                embed.setFooter({ text: '@everyone' });
            }

            let message;
            if (this.lastMessageId) {
                try {
                    // Usar fila para evitar flood
                    message = await channel.messages.edit(this.lastMessageId, {
                        embeds: [embed],
                        content: status === 'error' ? '@everyone' : null
                    });
                } catch (error) {
                    // Se não conseguir editar, criar nova mensagem
                    message = await channel.send({
                        embeds: [embed],
                        content: status === 'error' ? '@everyone' : null
                    });
                    this.lastMessageId = message.id;
                }
            } else {
                // Primeira mensagem
                message = await channel.send({
                    embeds: [embed],
                    content: status === 'error' ? '@everyone' : null
                });
                this.lastMessageId = message.id;
            }

            return message;

        } catch (error) {
            console.error(`❌ Erro ao enviar mensagem para o canal ${this.channelId}:`, error.message);
        }
    }

    getColorByStatus(status) {
        const colors = {
            running: 0xFFFF00, // Amarelo
            success: 0x00FF00, // Verde
            error: 0xFF0000    // Vermelho
        };
        return colors[status] || 0x000000;
    }

    async updateProgress(progress, currentOperation, details = '') {
        // Usar fila para evitar flood
        await this.queueMessageUpdate({
            status: 'running',
            title: '🔄 Backup em Andamento',
            description: `Progresso do backup: ${progress.toString()}%`,
            fields: [
                { name: '🔧 Operação Atual', value: currentOperation, inline: true },
                { name: '📊 Progresso', value: `${progress.toString()}%`, inline: true },
                { name: '⏰ Última Atualização', value: new Date().toLocaleString('pt-BR'), inline: true },
                { name: '📝 Detalhes', value: details || 'Processando...', inline: false }
            ]
        });
    }

    async sendSuccess(finalDetails) {
        await this.queueMessageUpdate({
            status: 'success',
            title: '✅ Backup Concluído com Sucesso',
            description: 'Todos os arquivos foram processados e enviados',
            fields: [
                { name: '🎉 Status', value: 'Concluído', inline: true },
                { name: '⏰ Concluído em', value: new Date().toLocaleString('pt-BR'), inline: true },
                { name: '📊 Detalhes Finais', value: finalDetails.toString(), inline: false }
            ]
        });
    }

    async sendError(error, context = '') {
        await this.queueMessageUpdate({
            status: 'error',
            title: '💥 Falha no Backup',
            description: 'Ocorreu um erro durante o processo de backup',
            fields: [
                { name: '❌ Erro', value: error.message, inline: false },
                { name: '🔧 Contexto', value: context || 'Operação não especificada', inline: true },
                { name: '⏰ Horário do Erro', value: new Date().toLocaleString('pt-BR'), inline: true }
            ]
        });
    }

    async login() {
        if (!this.config.discord_bot?.token) {
            console.error('❌ Token do bot Discord não configurado');
            return false;
        }

        try {
            await this.client.login(this.config.discord_bot.token);
            return true;
        } catch (error) {
            console.error('❌ Erro ao conectar bot Discord:', error.message);
            return false;
        }
    }

    setupScheduler() {
        const scheduleTimes = this.config.backup_schedule || ['03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '00:00'];

        console.log(`🕒 Configurando ${scheduleTimes.length} backups agendados...`);

        scheduleTimes.forEach(time => {
            const [hour, minute] = time.split(':');

            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                const cronExpression = `${minute} ${hour} * * *`;

                cron.schedule(cronExpression, () => {
                    console.log(`🕒 Executando backup agendado para ${time}`);
                    this.executeScheduledBackup(time);
                });

                console.log(`✅ Backup agendado para ${time}`);
            }
        });
    }

    async executeScheduledBackup(scheduleTime) {
        if (!this.isReady) return;

        try {
            await this.sendBackupMessage({
                status: 'running',
                title: '🔄 Backup Agendado Iniciado',
                description: `Executando backup agendado para ${scheduleTime}`,
                fields: [
                    { name: '⏰ Horário', value: scheduleTime, inline: true },
                    { name: '📅 Data', value: new Date().toLocaleString('pt-BR'), inline: true }
                ]
            });

            await this.backupManager.run();

        } catch (error) {
            await this.sendError(error, `Backup agendado ${scheduleTime}`);
        }
    }
}

module.exports = DiscordBot;