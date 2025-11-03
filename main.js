const fs = require('fs-extra');
const BackupManager = require('./lib/BackupManager');
const readline = require('readline');
const cron = require('node-cron');

// Carregar configuração
const configPath = './config.json';

if (!fs.existsSync(configPath)) {
    console.error('❌ Arquivo config.json não encontrado!');
    process.exit(1);
}

// Interface para comandos do console
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function main() {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        console.log('🚀 Iniciando Sistema de Backup 24/7...');

        // Inicializar BackupManager
        const backupManager = new BackupManager(config);

        // Configurar agendamentos
        function setupScheduler() {
            const scheduleTimes = config.backup_schedule || ['03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '00:00'];

            console.log(`🕒 Configurando ${scheduleTimes.length} backups agendados...`);

            scheduleTimes.forEach(time => {
                const [hour, minute] = time.split(':');

                if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                    const cronExpression = `${minute} ${hour} * * *`;

                    cron.schedule(cronExpression, () => {
                        console.log(`🕒 Executando backup agendado para ${time}`);
                        backupManager.run().catch(error => {
                            console.error(`❌ Erro no backup agendado ${time}:`, error.message);
                        });
                    });

                    console.log(`✅ Backup agendado para ${time}`);
                }
            });
        }

        // Sistema de comandos do console
        function showConsoleCommands() {
            console.log('\n🎮 COMANDOS DO CONSOLE:');
            console.log('   backup now          - Executar backup manual');
            console.log('   backup status       - Ver status dos backups');
            console.log('   backup schedule     - Ver horários agendados');
            console.log('   backup cleanup      - Executar limpeza');
            console.log('   backup list         - Listar backups');
            console.log('   exit                - Sair da aplicação');
            console.log('');
        }

        // Configurar agendamentos
        setupScheduler();
        showConsoleCommands();

        rl.on('line', async (input) => {
            const command = input.trim().toLowerCase();

            try {
                switch (command) {
                    case 'backup now':
                        console.log('🔄 Executando backup manual...');
                        await backupManager.executeManualBackup();
                        break;

                    case 'backup status':
                        console.log('📊 Buscando status dos backups...');
                        const backupFiles = await backupManager.cleanupManager.listBackupFiles();
                        console.log(`📁 Total de backups: ${backupFiles.length}`);
                        if (backupFiles[0]) {
                            const lastBackup = new Date(backupFiles[0].createdTime);
                            console.log(`🕒 Último backup: ${lastBackup.toLocaleString('pt-BR')}`);
                        }
                        break;

                    case 'backup schedule':
                        const schedule = config.backup_schedule || [];
                        console.log('🕒 Horários agendados:');
                        schedule.forEach(time => console.log(`   - ${time}`));
                        break;

                    case 'backup cleanup':
                        console.log('🧹 Executando limpeza...');
                        await backupManager.cleanupManager.cleanupRemote();
                        break;

                    case 'backup list':
                        console.log('📋 Listando backups...');
                        const files = await backupManager.cleanupManager.listBackupFiles();
                        files.slice(0, 5).forEach(file => {
                            const date = new Date(file.createdTime).toLocaleString('pt-BR');
                            console.log(`   📄 ${file.name} (${date})`);
                        });
                        if (files.length > 5) {
                            console.log(`   ... e mais ${files.length - 5} backups`);
                        }
                        break;

                    case 'exit':
                        console.log('🛑 Encerrando aplicação...');
                        process.exit(0);
                        break;

                    case 'help':
                        showConsoleCommands();
                        break;

                    default:
                        console.log('❌ Comando não reconhecido. Digite "help" para ver os comandos.');
                }
            } catch (error) {
                console.error(`❌ Erro no comando: ${error.message}`);
            }

            console.log(''); // Linha em branco para melhor legibilidade
        });

        // Manter aplicação rodando
        process.on('SIGINT', () => {
            console.log('\n🛑 Encerrando aplicação...');
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('\n🛑 Encerrando aplicação...');
            process.exit(0);
        });

        console.log('✅ Sistema de Backup rodando 24/7!');
        console.log('💡 Use os comandos acima para interagir com o sistema.');

    } catch (error) {
        console.error('❌ Erro na aplicação:', error.message);
        process.exit(1);
    }
}

main();