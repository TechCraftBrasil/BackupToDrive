const fs = require('fs-extra');
const path = require('path');
const tar = require('tar');
const archiver = require('archiver');

class FileCompressor {
    constructor(config, progressTracker) {
        this.config = config;
        this.progress = progressTracker;
    }

    async createTarGz(files, outputPath, current, total) {
        return new Promise((resolve, reject) => {
            let totalSize = 0;
            let processedSize = 0;

            // Calcular tamanho total dos arquivos
            files.forEach(file => {
                if (fs.existsSync(file)) {
                    try {
                        const stats = fs.statSync(file);
                        if (stats.isDirectory()) {
                            totalSize += 100 * 1024 * 1024; // Estimativa para diretórios
                        } else {
                            totalSize += stats.size;
                        }
                    } catch (error) {
                        totalSize += 10 * 1024 * 1024; // Estimativa padrão
                    }
                }
            });

            const output = fs.createWriteStream(outputPath);
            const archive = archiver('tar', {
                gzip: true,
                gzipOptions: { level: 9 }
            });

            output.on('close', () => {
                this.progress.updateProgress(100, `Grupo ${current}/${total} compactado`);
                this.progress.log(`Arquivo criado: ${outputPath}`);
                resolve(outputPath);
            });

            archive.on('error', (error) => {
                reject(error);
            });

            archive.on('data', (data) => {
                processedSize += data.length;
                const progress = Math.min(95, Math.round((processedSize / totalSize) * 100));
                this.progress.updateProgress(
                    progress,
                    `Compactando grupo ${current}/${total}`
                );
            });

            archive.pipe(output);

            // Adicionar arquivos ao archive
            files.forEach(file => {
                if (fs.existsSync(file)) {
                    const stats = fs.statSync(file);
                    if (stats.isDirectory()) {
                        archive.directory(file, path.basename(file));
                    } else {
                        archive.file(file, { name: path.basename(file) });
                    }
                }
            });

            archive.finalize();
        });
    }

    async compressGroups() {
        const { backupGroups } = this.config;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFiles = [];

        const groupEntries = Object.entries(backupGroups);
        this.progress.startOperation(`Compactação de ${groupEntries.length} grupos de arquivos`);

        for (let i = 0; i < groupEntries.length; i++) {
            const [groupName, files] = groupEntries[i];
            const validFiles = files.filter(file => fs.existsSync(file));

            if (validFiles.length > 0) {
                const outputFile = `${groupName}-${timestamp}.tar.gz`;
                try {
                    await this.createTarGz(validFiles, outputFile, i + 1, groupEntries.length);
                    backupFiles.push(outputFile);
                } catch (error) {
                    this.progress.error(`Erro ao compactar grupo ${groupName}: ${error.message}`);
                }
            } else {
                this.progress.log(`Nenhum arquivo válido encontrado para o grupo: ${groupName}`);
            }
        }

        this.progress.endOperation(`Compactação de ${groupEntries.length} grupos`);
        return backupFiles;
    }
}

module.exports = FileCompressor;