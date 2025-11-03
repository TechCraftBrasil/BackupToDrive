const { spawn } = require('child_process');
const fs = require('fs-extra');

class DatabaseExporter {
    constructor(config, progressTracker) {
        this.config = config;
        this.progress = progressTracker;
    }

    async listDatabases() {
        const { database } = this.config;

        return new Promise((resolve, reject) => {
            const mysql = spawn('mysql', [
                `--host=${database.host}`,
                `--user=${database.user}`,
                `--password=${database.password}`,
                `-N`,
                `-e`,
                `SHOW DATABASES;`
            ]);

            let output = '';
            let error = '';

            mysql.stdout.on('data', (data) => {
                output += data.toString();
            });

            mysql.stderr.on('data', (data) => {
                error += data.toString();
            });

            mysql.on('close', (code) => {
                if (code === 0) {
                    const databases = output.split('\n')
                        .map(db => db.trim())
                        .filter(db => db && !database.excludedDatabases.includes(db));
                    resolve(databases);
                } else {
                    reject(new Error(`Erro ao listar bancos: ${error}`));
                }
            });
        });
    }

    async exportSingleDatabase(dbName, current, total) {
        const { database } = this.config;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dumpFile = `db-${dbName}-${timestamp}.sql`;

        return new Promise((resolve, reject) => {
            const mysqldump = spawn('mysqldump', [
                `--host=${database.host}`,
                `--user=${database.user}`,
                `--password=${database.password}`,
                `--databases`,
                dbName
            ]);

            let totalSize = 0;
            let currentSize = 0;

            const output = fs.createWriteStream(dumpFile);

            mysqldump.stdout.on('data', (data) => {
                currentSize += data.length;
                if (totalSize === 0) {
                    totalSize = currentSize * 10; // Estimativa inicial
                }
                const progress = Math.min(95, Math.round((currentSize / totalSize) * 100));
                this.progress.updateProgress(
                    progress,
                    `Exportando banco ${dbName} (${current}/${total})`
                );
            });

            mysqldump.stderr.on('data', (data) => {
                this.progress.error(`mysqldump stderr para ${dbName}: ${data}`);
            });

            mysqldump.stdout.pipe(output);

            mysqldump.on('close', (code) => {
                if (code === 0) {
                    this.progress.updateProgress(100, `Banco ${dbName} exportado`);
                    this.progress.log(`Backup do banco ${dbName} exportado para: ${dumpFile}`);
                    resolve(dumpFile);
                } else {
                    reject(new Error(`mysqldump falhou para ${dbName} com código: ${code}`));
                }
            });
        });
    }

    async exportAllDatabases() {
        const { database } = this.config;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dumpFile = `all-databases-${timestamp}.sql`;

        return new Promise((resolve, reject) => {
            const mysqldump = spawn('mysqldump', [
                `--host=${database.host}`,
                `--user=${database.user}`,
                `--password=${database.password}`,
                `--all-databases`,
                `--ignore-table=mysql.event`
            ]);

            let totalSize = 0;
            let currentSize = 0;

            const output = fs.createWriteStream(dumpFile);

            mysqldump.stdout.on('data', (data) => {
                currentSize += data.length;
                if (totalSize === 0) {
                    totalSize = currentSize * 10;
                }
                const progress = Math.min(95, Math.round((currentSize / totalSize) * 100));
                this.progress.updateProgress(progress, 100, `Exportando todos os bancos: ${progress}%`);
            });

            mysqldump.stderr.on('data', (data) => {
                this.progress.error(`mysqldump stderr: ${data}`);
            });

            mysqldump.stdout.pipe(output);

            mysqldump.on('close', (code) => {
                if (code === 0) {
                    this.progress.updateProgress(100, 100, 'Todos os bancos exportados');
                    this.progress.log(`Backup de todos os bancos exportado para: ${dumpFile}`);
                    resolve(dumpFile);
                } else {
                    reject(new Error(`mysqldump falhou com código: ${code}`));
                }
            });
        });
    }

    async export() {
        const { database } = this.config;

        if (!database.backupEnabled) {
            this.progress.log('Backup de banco de dados desabilitado na configuração.');
            return [];
        }

        const backupFiles = [];

        try {
            if (database.backupStrategy === 'all') {
                this.progress.startOperation('Exportação de todos os bancos');
                const dumpFile = await this.exportAllDatabases();
                backupFiles.push(dumpFile);
                this.progress.endOperation('Exportação de todos os bancos');

            } else if (database.backupStrategy === 'individual') {
                const databases = database.individualDatabases.length > 0
                    ? database.individualDatabases
                    : await this.listDatabases();

                this.progress.startOperation(`Exportação de ${databases.length} bancos individuais`);

                for (let i = 0; i < databases.length; i++) {
                    const dbName = databases[i];
                    try {
                        const dumpFile = await this.exportSingleDatabase(dbName, i + 1, databases.length);
                        backupFiles.push(dumpFile);
                    } catch (error) {
                        this.progress.error(`Erro ao exportar banco ${dbName}: ${error.message}`);
                    }
                }

                this.progress.endOperation(`Exportação de ${databases.length} bancos individuais`);

            } else if (database.backupStrategy === 'except') {
                const allDatabases = await this.listDatabases();
                const databasesToBackup = allDatabases.filter(
                    db => !database.excludedDatabases.includes(db)
                );

                this.progress.startOperation(`Exportação de ${databasesToBackup.length} bancos (exceto excluídos)`);

                for (let i = 0; i < databasesToBackup.length; i++) {
                    const dbName = databasesToBackup[i];
                    try {
                        const dumpFile = await this.exportSingleDatabase(dbName, i + 1, databasesToBackup.length);
                        backupFiles.push(dumpFile);
                    } catch (error) {
                        this.progress.error(`Erro ao exportar banco ${dbName}: ${error.message}`);
                    }
                }

                this.progress.endOperation(`Exportação de ${databasesToBackup.length} bancos`);
            }

        } catch (error) {
            this.progress.error(`Erro no processo de exportação do banco: ${error.message}`);
        }

        return backupFiles;
    }
}

module.exports = DatabaseExporter;