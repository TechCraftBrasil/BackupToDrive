class ProgressTracker {
    constructor(config = null) {
        this.currentOperation = '';
        this.config = config;
        this.lastProgress = 0;
        this.lastProgressLine = '';
        this.isTTY = process.stdout.isTTY;
    }

    updateProgress(progress, currentOperation, details = '') {
        // Para terminais TTY, atualizar a mesma linha
        if (this.isTTY) {
            const progressBar = this.createProgressBar(progress);
            const line = `📊 ${progressBar} ${progress}% - ${currentOperation}${details ? ` - ${details}` : ''}`;

            // Se for a mesma linha anterior, sobrescrever
            if (this.lastProgressLine) {
                process.stdout.clearLine(0);
                process.stdout.cursorTo(0);
            }

            process.stdout.write(line);
            this.lastProgressLine = line;

            // Se chegou a 100%, quebrar a linha
            if (progress === 100) {
                process.stdout.write('\n');
                this.lastProgressLine = '';
            }
        } else {
            // Para terminais não TTY, log apenas em marcos específicos
            const progressMilestones = [0, 25, 50, 75, 100];
            if (progressMilestones.includes(progress)) {
                console.log(`📊 Progresso: ${progress}% - ${currentOperation}${details ? ` - ${details}` : ''}`);
            }
        }
    }

    createProgressBar(progress) {
        const width = 20;
        const completed = Math.round((progress / 100) * width);
        const remaining = width - completed;
        return `[${'█'.repeat(completed)}${'░'.repeat(remaining)}]`;
    }

    startOperation(operation) {
        this.currentOperation = operation;
        if (this.lastProgressLine && this.isTTY) {
            process.stdout.write('\n');
            this.lastProgressLine = '';
        }
        console.log(`\n🔧 ${operation}...`);
    }

    endOperation(operation, success = true) {
        // Garantir que estamos em uma nova linha
        if (this.lastProgressLine && this.isTTY) {
            process.stdout.write('\n');
            this.lastProgressLine = '';
        }

        const emoji = success ? '✅' : '❌';
        const message = `${emoji} ${operation} ${success ? 'concluído' : 'falhou'}`;
        console.log(message);
    }

    log(message) {
        // Garantir que estamos em uma nova linha antes de logar
        if (this.lastProgressLine && this.isTTY) {
            process.stdout.write('\n');
            this.lastProgressLine = '';
        }
        console.log(`📝 ${message}`);
    }

    error(message) {
        // Garantir que estamos em uma nova linha antes de logar erro
        if (this.lastProgressLine && this.isTTY) {
            process.stdout.write('\n');
            this.lastProgressLine = '';
        }
        console.error(`❌ ${message}`);
    }
}

module.exports = ProgressTracker;