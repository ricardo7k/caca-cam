const functions = require('@google-cloud/functions-framework');
const axios = require('axios');
const admin = require('firebase-admin');
const { Firestore } = require('@google-cloud/firestore');
const cors = require('cors')({ origin: true });

const http = require('http');
const https = require('https');

admin.initializeApp();
const db = new Firestore();

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

functions.http('proxySnapshot', async (req, res) => {
    cors(req, res, async () => {
        try {
            // 1. Validar Token Firebase
            const authHeader = req.headers.authorization?.split('Bearer ')[1];
            const queryToken = req.query.token;
            const idToken = authHeader || queryToken;

            if (!idToken) return res.status(401).send('Não autorizado');

            const decodedToken = await admin.auth().verifyIdToken(idToken);
            const email = decodedToken.email;

            // 2. Verificar Whitelist
            const userDoc = await db.collection('allowed_users').doc(email).get();
            if (!userDoc.exists) {
                return res.status(403).send(`Acesso negado para ${email}`);
            }

            // 3. Proxy da Imagem
            const { url } = req.query;
            if (!url) return res.status(400).send('URL ausente');

            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                timeout: 15000,
                validateStatus: false,
                httpAgent,
                httpsAgent
            });

            res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
            res.setHeader('Cache-Control', 'no-cache');
            
            response.data.pipe(res);

            // Tratamento de erros no stream para evitar que a função "pendure"
            response.data.on('error', (err) => {
                console.error(`❌ Erro no stream da câmera (${url}):`, err.message);
                if (!res.writableEnded) res.status(502).end();
            });

            req.on('aborted', () => {
                console.warn(`⚠️ Requisição abortada pelo cliente (${url})`);
                response.data.destroy();
            });

        } catch (error) {
            console.error('❌ Erro no Proxy:', error.message);
            if (!res.writableEnded) {
                res.status(500).send('Erro ao buscar imagem: ' + error.message);
            }
        }
    });
});
