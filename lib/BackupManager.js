const DatabaseExporter = require('./DatabaseExporter');
const FileCompressor = require('./FileCompressor');
const AuthManager = require('./AuthManager');
const DriveUploader = require('./DriveUploader');
const CleanupManager = require('./CleanupManager');
const ProgressTracker = require('./ProgressTracker');
const fs = require('fs-extra');

class BackupManager {
    constructor(config) {
        this.config = config;
        this.progress = new ProgressTracker(config);
        this.startTime = null;

        try {
            // Inicializar AuthManager primeiro (é a base para os outros)
            this.authManager = new AuthManager(config, this.progress);

            // Inicializar outros componentes
            this.databaseExporter = new DatabaseExporter(config, this.progress);
            this.fileCompressor = new FileCompressor(config, this.progress);
            this.driveUploader = new DriveUploader(config, this.progress, this.authManager);
            this.cleanupManager = new CleanupManager(config, this.progress, this.authManager);
        } catch (error) {
            this.progress.error(`❌ Erro ao inicializar BackupManager: ${error.message}`);
            throw error;
        }
    }

    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    async run() {
        this.startTime = new Date();

        try {
            this.progress.log('🚀 Iniciando processo de backup...');

            // Verificar configuração do Google Drive
            const { googleDrive } = this.config;
            if (!googleDrive.oauthClientId || !googleDrive.oauthClientSecret) {
                const errorMsg = '❌ OAuth Client ID e Secret não configurados no config.json';
                this.progress.error(errorMsg);
                throw new Error(errorMsg);
            }

            if (!googleDrive.folderId) {
                const errorMsg = '❌ Folder ID não configurado no config.json';
                this.progress.error(errorMsg);
                throw new Error(errorMsg);
            }

            // Limpar backups antigos primeiro
            await this.cleanupManager.cleanupRemote();

            // Coletar todos os arquivos de backup
            const backupFiles = [];

            // Exportar bancos de dados
            const dbFiles = await this.databaseExporter.export();
            backupFiles.push(...dbFiles);

            // Compactar grupos de arquivos
            const compressedFiles = await this.fileCompressor.compressGroups();
            backupFiles.push(...compressedFiles);

            if (backupFiles.length === 0) {
                this.progress.log('⚠️ Nenhum arquivo de backup foi criado.');
                throw new Error('Nenhum arquivo de backup criado');
            }

            this.progress.log(`📦 Total de ${backupFiles.length} arquivos para upload:`);
            let totalSizeMB = 0;
            backupFiles.forEach(file => {
                try {
                    const stats = fs.statSync(file);
                    const sizeMB = Math.round((stats.size / 1024 / 1024) * 100) / 100;
                    totalSizeMB += sizeMB;
                    this.progress.log(`   📄 ${file} (${sizeMB}MB)`);
                } catch (error) {
                    this.progress.log(`   📄 ${file} (tamanho não disponível)`);
                }
            });

            // Upload para Google Drive
            const successCount = await this.driveUploader.uploadFiles(backupFiles);

            // Limpeza de arquivos locais
            await this.cleanupManager.cleanupLocal(backupFiles);

            // Limpar backups antigos novamente (após upload)
            await this.cleanupManager.cleanupRemote();

            const endTime = new Date();
            const duration = endTime - this.startTime;

            this.progress.log(`🎉 Backup concluído com sucesso! ${successCount}/${backupFiles.length} arquivos enviados.`);
            this.progress.log(`⏱️ Duração: ${this.formatDuration(duration)}`);

            return {
                success: true,
                filesProcessed: successCount,
                totalFiles: backupFiles.length,
                totalSizeMB: Math.round(totalSizeMB),
                duration: this.formatDuration(duration)
            };

        } catch (error) {
            const endTime = new Date();
            const duration = endTime - this.startTime;

            this.progress.error(`💥 Erro no processo de backup: ${error.message}`);
            this.progress.log(`⏱️ Duração até o erro: ${this.formatDuration(duration)}`);

            throw error;
        }
    }

    // Método para executar backup manual via comando
    async executeManualBackup(backupType = 'full') {
        this.startTime = new Date();

        try {
            this.progress.log('🚀 Iniciando backup manual...');

            // Verificar configuração do Google Drive
            const { googleDrive } = this.config;
            if (!googleDrive.oauthClientId || !googleDrive.oauthClientSecret) {
                const errorMsg = '❌ OAuth Client ID e Secret não configurados no config.json';
                this.progress.error(errorMsg);
                throw new Error(errorMsg);
            }

            if (!googleDrive.folderId) {
                const errorMsg = '❌ Folder ID não configurado no config.json';
                this.progress.error(errorMsg);
                throw new Error(errorMsg);
            }

            // Limpar backups antigos primeiro
            this.progress.log('🧹 Limpando backups antigos...');
            await this.cleanupManager.cleanupRemote();

            // Coletar todos os arquivos de backup
            const backupFiles = [];
            let totalSizeMB = 0;

            // Exportar bancos de dados (se não for apenas arquivos)
            if (backupType === 'full' || backupType === 'database') {
                this.progress.log('🗄️ Exportando bancos de dados...');
                const dbFiles = await this.databaseExporter.export();
                backupFiles.push(...dbFiles);
            }

            // Compactar grupos de arquivos (se não for apenas bancos)
            if (backupType === 'full' || backupType === 'files') {
                this.progress.log('📦 Compactando arquivos...');
                const compressedFiles = await this.fileCompressor.compressGroups();
                backupFiles.push(...compressedFiles);
            }

            if (backupFiles.length === 0) {
                const errorMsg = '⚠️ Nenhum arquivo de backup foi criado.';
                this.progress.log(errorMsg);
                throw new Error(errorMsg);
            }

            // Calcular tamanho total
            this.progress.log(`📦 Total de ${backupFiles.length} arquivos para upload:`);
            backupFiles.forEach(file => {
                try {
                    const stats = fs.statSync(file);
                    const sizeMB = Math.round((stats.size / 1024 / 1024) * 100) / 100;
                    totalSizeMB += sizeMB;
                    this.progress.log(`   📄 ${file} (${sizeMB}MB)`);
                } catch (error) {
                    this.progress.log(`   📄 ${file} (tamanho não disponível)`);
                }
            });

            // Upload para Google Drive
            this.progress.log('☁️ Enviando arquivos para Google Drive...');
            const successCount = await this.driveUploader.uploadFiles(backupFiles);

            // Limpeza de arquivos locais
            this.progress.log('🧹 Limpando arquivos locais...');
            await this.cleanupManager.cleanupLocal(backupFiles);

            // Limpar backups antigos novamente (após upload)
            await this.cleanupManager.cleanupRemote();

            const endTime = new Date();
            const duration = endTime - this.startTime;

            this.progress.log(`🎉 Backup manual concluído com sucesso! ${successCount}/${backupFiles.length} arquivos enviados.`);
            this.progress.log(`⏱️ Duração: ${this.formatDuration(duration)}`);

            return {
                success: true,
                filesProcessed: successCount,
                totalFiles: backupFiles.length,
                totalSizeMB: Math.round(totalSizeMB),
                duration: this.formatDuration(duration),
                backupType: backupType
            };

        } catch (error) {
            const endTime = new Date();
            const duration = endTime - this.startTime;

            this.progress.error(`💥 Erro no backup manual: ${error.message}`);
            this.progress.log(`⏱️ Duração até o erro: ${this.formatDuration(duration)}`);

            throw error;
        }
    }

    // Método auxiliar para obter nome do tipo de backup
    getBackupTypeName(backupType) {
        const types = {
            'full': 'Completo (Bancos + Arquivos)',
            'database': 'Apenas Bancos de Dados',
            'files': 'Apenas Arquivos'
        };
        return types[backupType] || 'Completo';
    }
}

module.exports = BackupManager;