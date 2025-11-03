const fs = require('fs-extra');

class CleanupManager {
    constructor(config, progressTracker, authManager) {
        this.config = config;
        this.progress = progressTracker;
        this.authManager = authManager;
    }

    matchesFilePattern(fileName, patterns) {
        return patterns.some(pattern => {
            const regexPattern = pattern
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.');
            const regex = new RegExp(`^${regexPattern}$`);
            return regex.test(fileName);
        });
    }

    async listBackupFiles() {
        const { folderId } = this.config.googleDrive;

        try {
            // Garantir autenticação antes de tentar listar
            const driveClient = await this.authManager.ensureAuthenticated();

            const response = await driveClient.files.list({
                q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
                fields: 'files(id, name, createdTime, size, mimeType)',
                orderBy: 'createdTime desc',
                pageSize: 1000,
            });

            return response.data.files || [];
        } catch (error) {
            this.progress.error(`❌ Erro ao listar arquivos do Drive: ${error.message}`);
            return [];
        }
    }

    async cleanupRemote() {
        const { enabled, keepLast, strategy, maxAgeDays, filePatterns } = this.config.cleanup;

        if (!enabled) {
            this.progress.log('ℹ️ Limpeza de backups antigos desabilitada.');
            return;
        }

        this.progress.startOperation('Limpeza de backups antigos no Google Drive');

        try {
            const allFiles = await this.listBackupFiles();

            // Filtrar apenas arquivos que correspondem aos padrões
            const backupFiles = allFiles.filter(file =>
                this.matchesFilePattern(file.name, filePatterns)
            );

            this.progress.log(`📊 Encontrados ${backupFiles.length} arquivos de backup no Drive.`);

            let filesToDelete = [];

            if (strategy === 'age' && maxAgeDays) {
                // Estratégia por idade
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

                filesToDelete = backupFiles.filter(file => {
                    const fileDate = new Date(file.createdTime);
                    return fileDate < cutoffDate;
                });

                this.progress.log(`🗑️ Removendo backups com mais de ${maxAgeDays} dias.`);

            } else {
                // Estratégia por quantidade
                filesToDelete = backupFiles.slice(keepLast);
                this.progress.log(`🗑️ Mantendo os últimos ${keepLast} backups.`);
            }

            if (filesToDelete.length === 0) {
                this.progress.log('✅ Nenhum backup antigo para limpar.');
                return;
            }

            this.progress.log(`🔍 Encontrados ${filesToDelete.length} backups antigos para limpar.`);

            let deletedCount = 0;
            const driveClient = this.authManager.getDriveClient();

            for (let i = 0; i < filesToDelete.length; i++) {
                const file = filesToDelete[i];
                try {
                    await driveClient.files.delete({
                        fileId: file.id,
                    });
                    deletedCount++;
                    const fileDate = new Date(file.createdTime).toLocaleDateString('pt-BR');
                    const progress = Math.round(((i + 1) / filesToDelete.length) * 100);
                    this.progress.updateProgress(
                        progress,
                        `Limpando backups antigos`
                    );
                    this.progress.log(`✅ Backup antigo removido: ${file.name} (${fileDate})`);
                } catch (error) {
                    this.progress.error(`❌ Erro ao remover backup ${file.name}: ${error.message}`);
                }
            }

            this.progress.endOperation('Limpeza de backups antigos');
            this.progress.log(`🗑️ ${deletedCount} arquivos removidos do Drive.`);

        } catch (error) {
            this.progress.error(`❌ Erro na limpeza de backups: ${error.message}`);
        }
    }

    async cleanupLocal(files) {
        if (files.length === 0) {
            this.progress.log('ℹ️ Nenhum arquivo local para limpar.');
            return;
        }

        this.progress.startOperation('Limpeza de arquivos locais temporários');

        let cleanedCount = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                if (fs.existsSync(file)) {
                    await fs.remove(file);
                    cleanedCount++;
                    this.progress.log(`✅ Arquivo local limpo: ${file}`);
                }
                const progress = Math.round(((i + 1) / files.length) * 100);
                this.progress.updateProgress(progress, 100, `Limpando arquivos locais: ${progress}%`);
            } catch (error) {
                this.progress.error(`❌ Erro ao limpar arquivo local ${file}: ${error.message}`);
            }
        }

        this.progress.endOperation('Limpeza de arquivos locais');
        this.progress.log(`🧹 ${cleanedCount} arquivos locais removidos.`);
    }
}

module.exports = CleanupManager;