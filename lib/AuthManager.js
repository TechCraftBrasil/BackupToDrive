const fs = require('fs-extra');
const path = require('path');
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

class AuthManager {
    constructor(config, progressTracker) {
        this.config = config;
        this.progress = progressTracker;
        this.oauth2Client = null;
        this.driveClient = null;
        this.tokenPath = './token.json';
        this.initializeOAuthClient();
    }

    initializeOAuthClient() {
        const { oauthClientId, oauthClientSecret } = this.config.googleDrive;

        if (!oauthClientId || !oauthClientSecret) {
            throw new Error('❌ OAuth Client ID e Secret não configurados no config.json');
        }

        // Usar redirect URI local
        this.oauth2Client = new google.auth.OAuth2(
            oauthClientId,
            oauthClientSecret,
            'http://localhost:3000/oauth2callback'
        );

        // Configurar escopos
        this.oauth2Client.scopes = ['https://www.googleapis.com/auth/drive.file'];

        // Carregar token se existir
        this.loadToken();
    }

    loadToken() {
        if (fs.existsSync(this.tokenPath)) {
            try {
                const token = fs.readFileSync(this.tokenPath, 'utf8');
                const tokenData = JSON.parse(token);
                this.oauth2Client.setCredentials(tokenData);
                this.progress.log('✅ Token de autenticação carregado');

                // Inicializar drive client
                this.driveClient = google.drive({ version: 'v3', auth: this.oauth2Client });
                return true;
            } catch (error) {
                this.progress.error(`❌ Erro ao carregar token: ${error.message}`);
                return false;
            }
        }
        this.progress.log('ℹ️ Nenhum token encontrado, autenticação necessária');
        return false;
    }

    saveToken(token) {
        try {
            fs.writeFileSync(this.tokenPath, JSON.stringify(token));
            this.progress.log('✅ Token salvo com sucesso');
            return true;
        } catch (error) {
            this.progress.error(`❌ Erro ao salvar token: ${error.message}`);
            return false;
        }
    }

    async checkAuth() {
        if (!this.driveClient) {
            this.progress.log('ℹ️ Drive client não inicializado');
            return false;
        }

        if (!this.oauth2Client.credentials) {
            this.progress.log('ℹ️ Nenhuma credencial encontrada');
            return false;
        }

        try {
            // Verificar se o token é válido tentando listar arquivos
            await this.driveClient.files.list({
                pageSize: 1,
                fields: 'files(id, name)'
            });
            this.progress.log('✅ Autenticação válida');
            return true;
        } catch (error) {
            if (error.message.includes('invalid_grant') ||
                error.message.includes('invalid_credentials') ||
                error.message.includes('access token') ||
                error.message.includes('unauthorized')) {
                this.progress.log('🔄 Token expirado ou inválido');
                return false;
            }
            this.progress.error(`❌ Erro ao verificar autenticação: ${error.message}`);
            return false;
        }
    }

    async authenticate() {
        return new Promise((resolve, reject) => {
            try {
                // Gerar URL de autorização
                const authUrl = this.oauth2Client.generateAuthUrl({
                    access_type: 'offline',
                    scope: ['https://www.googleapis.com/auth/drive.file'],
                    prompt: 'consent'
                });

                // Criar servidor local para capturar o callback
                const server = http.createServer(async (req, res) => {
                    if (req.url.startsWith('/oauth2callback')) {
                        const query = url.parse(req.url, true).query;

                        if (query.error) {
                            res.writeHead(400, { 'Content-Type': 'text/html' });
                            res.end(`
                                <html>
                                    <body>
                                        <h1>Erro de Autenticação</h1>
                                        <p>${query.error}</p>
                                        <p>Você pode fechar esta janela.</p>
                                    </body>
                                </html>
                            `);
                            reject(new Error(query.error));
                            return;
                        }

                        if (query.code) {
                            try {
                                const { tokens } = await this.oauth2Client.getToken(query.code);
                                this.oauth2Client.setCredentials(tokens);

                                // Salvar token
                                this.saveToken(tokens);

                                // Inicializar drive client
                                this.driveClient = google.drive({ version: 'v3', auth: this.oauth2Client });

                                res.writeHead(200, { 'Content-Type': 'text/html' });
                                res.end(`
                                    <html>
                                        <body>
                                            <h1>Autenticação Bem-sucedida!</h1>
                                            <p>Você pode fechar esta janela e voltar para o terminal.</p>
                                            <script>
                                                setTimeout(() => window.close(), 2000);
                                            </script>
                                        </body>
                                    </html>
                                `);

                                this.progress.log('✅ Autenticação concluída com sucesso!');
                                server.close();
                                resolve(true);
                                return;
                            } catch (tokenError) {
                                this.progress.error(`❌ Erro ao obter token: ${tokenError.message}`);
                                res.writeHead(400, { 'Content-Type': 'text/html' });
                                res.end(`
                                    <html>
                                        <body>
                                            <h1>Erro</h1>
                                            <p>Erro ao obter token: ${tokenError.message}</p>
                                        </body>
                                    </html>
                                `);
                                server.close();
                                reject(tokenError);
                                return;
                            }
                        }
                    }

                    // Página padrão
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(`
                        <html>
                            <body>
                                <h1>Callback do Google OAuth</h1>
                                <p>Esta página deve redirecionar automaticamente.</p>
                            </body>
                        </html>
                    `);
                });

                server.listen(3000, () => {
                    this.progress.log('\n🔐 AUTENTICAÇÃO GOOGLE DRIVE REQUERIDA');
                    this.progress.log('='.repeat(50));
                    this.progress.log(`📋 Para autenticar, siga estes passos:`);
                    this.progress.log(`1️⃣  Acesse este URL no seu navegador:`);
                    this.progress.log(`   ${authUrl}`);
                    this.progress.log(`2️⃣  Faça login na sua conta Google`);
                    this.progress.log(`3️⃣  Permita o acesso ao Google Drive`);
                    this.progress.log(`4️⃣  Você será redirecionado automaticamente`);
                    this.progress.log(`5️⃣  Feche a janela do navegador após o sucesso`);
                    this.progress.log('='.repeat(50));
                    this.progress.log('⏳ Aguardando autenticação...');
                });

                server.on('error', (error) => {
                    this.progress.error(`❌ Erro no servidor de autenticação: ${error.message}`);
                    reject(error);
                });

            } catch (error) {
                this.progress.error(`❌ Erro no processo de autenticação: ${error.message}`);
                reject(error);
            }
        });
    }

    async ensureAuthenticated() {
        // Se não temos drive client, tentar carregar token
        if (!this.driveClient) {
            const tokenLoaded = this.loadToken();
            if (!tokenLoaded) {
                this.progress.log('🔄 Nenhum token encontrado, realizando autenticação...');
                await this.authenticate();
                return this.driveClient;
            }
        }

        // Verificar se a autenticação atual é válida
        const isAuthenticated = await this.checkAuth();

        if (!isAuthenticated) {
            this.progress.log('🔄 Token inválido ou expirado, realizando nova autenticação...');
            await this.authenticate();
        } else {
            this.progress.log('✅ Já autenticado no Google Drive');
        }

        return this.driveClient;
    }

    getDriveClient() {
        if (!this.driveClient) {
            throw new Error('Drive client não inicializado. Execute ensureAuthenticated() primeiro.');
        }
        return this.driveClient;
    }

    // Método para renovar token se expirado
    async refreshToken() {
        if (!this.oauth2Client.credentials.refresh_token) {
            this.progress.log('ℹ️ Nenhum refresh token disponível');
            return false;
        }

        try {
            const { credentials } = await this.oauth2Client.refreshAccessToken();
            this.oauth2Client.setCredentials(credentials);
            this.saveToken(credentials);
            this.progress.log('✅ Token renovado com sucesso');
            return true;
        } catch (error) {
            this.progress.error(`❌ Erro ao renovar token: ${error.message}`);
            return false;
        }
    }
}

module.exports = AuthManager;