const fs = require('fs-extra');
const path = require('path');

class DriveUploader {
    constructor(config, progressTracker, authManager) {
        this.config = config;
        this.progress = progressTracker;
        this.authManager = authManager;
    }

    getMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.gz': 'application/gzip',
            '.sql': 'application/sql',
            '.tar': 'application/x-tar',
            '.tgz': 'application/gzip',
            '.sql.gz': 'application/gzip'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    async uploadFile(filePath, current, total) {
        const driveClient = this.authManager.getDriveClient();

        const fileMetadata = {
            name: path.basename(filePath),
            parents: [this.config.googleDrive.folderId],
        };

        const fileStats = fs.statSync(filePath);
        const fileSize = fileStats.size;
        let uploadedSize = 0;

        const media = {
            mimeType: this.getMimeType(filePath),
            body: fs.createReadStream(filePath),
        };

        // Monitorar progresso do upload
        media.body.on('data', (chunk) => {
            uploadedSize += chunk.length;
            const progress = Math.min(95, Math.round((uploadedSize / fileSize) * 100));
            this.progress.updateProgress(
                progress,
                `Enviando arquivo ${current}/${total}`
            );
        });

        try {
            const response = await driveClient.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, name, createdTime, size',
                uploadType: 'multipart'
            });

            this.progress.updateProgress(100, `Arquivo ${current}/${total} enviado`);

            const fileSizeMB = Math.round((response.data.size / 1024 / 1024) * 100) / 100;
            this.progress.log(`✅ Arquivo enviado: ${response.data.name} (${fileSizeMB}MB)`);

            return response.data;
        } catch (error) {
            this.progress.error(`❌ Erro ao enviar arquivo ${path.basename(filePath)}: ${error.message}`);

            // Tentar renovar o token se expirou durante o upload
            if (error.message.includes('token') || error.message.includes('authentication')) {
                this.progress.log('🔄 Tentando renovar token...');
                const refreshed = await this.authManager.refreshToken();
                if (refreshed) {
                    this.progress.log('🔄 Repetindo upload...');
                    return await this.uploadFile(filePath, current, total);
                }
            }

            throw error;
        }
    }
    async uploadFiles(files) {
        if (files.length === 0) {
            this.progress.log('⚠️ Nenhum arquivo para enviar.');
            return 0;
        }

        this.progress.startOperation(`Upload de ${files.length} arquivos para Google Drive`);

        // Garantir autenticação
        await this.authManager.ensureAuthenticated();

        const folderId = this.config.googleDrive.folderId;

        // Apenas logar a pasta que será usada, sem verificar se existe
        // A API do Google Drive criará os arquivos na pasta mesmo sem verificação prévia
        this.progress.log(`📁 Enviando arquivos para a pasta: ${folderId}`);

        // Fazer upload dos arquivos
        let successCount = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!fs.existsSync(file)) {
                this.progress.error(`❌ Arquivo não encontrado: ${file}`);
                continue;
            }

            try {
                await this.uploadFile(file, i + 1, files.length);
                successCount++;
            } catch (error) {
                this.progress.error(`❌ Falha no upload do arquivo ${file}`);
                // Se o erro for relacionado à pasta, tentar upload sem especificar pasta
                if (error.message.includes('File not found') && error.message.includes(folderId)) {
                    this.progress.log('🔄 Tentando upload para a raiz do Drive...');
                    try {
                        // Backup da folderId original
                        const originalFolderId = this.config.googleDrive.folderId;
                        // Temporariamente remover a folderId
                        this.config.googleDrive.folderId = undefined;
                        await this.uploadFile(file, i + 1, files.length);
                        successCount++;
                        // Restaurar a folderId original
                        this.config.googleDrive.folderId = originalFolderId;
                    } catch (rootError) {
                        this.progress.error(`❌ Falha no upload para raiz também: ${rootError.message}`);
                    }
                }
            }
        }

        this.progress.endOperation(`Upload de ${successCount}/${files.length} arquivos`);
        return successCount;
    }
}

module.exports = DriveUploader;