const functions = require('@google-cloud/functions-framework');
const compute = require('@google-cloud/compute');
const { Firestore } = require('@google-cloud/firestore');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });

// 🔍 Log da versão para diagnóstico
console.log('🔍 compute module keys:', Object.keys(compute));
console.log('🔍 InstancesClient?', typeof compute.InstancesClient);

// Inicialização Global mínima
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const PROJECT_ID = 'paineiras-cam';
const REGION = 'southamerica-east1';
const ZONE = 'southamerica-east1-a';
const SA_EMAIL = `monitor-sa@${PROJECT_ID}.iam.gserviceaccount.com`;

// Clientes da API v4
const instancesClient = new compute.InstancesClient();

// Use exportação direta para o functions-framework
exports.apiControl = (req, res) => {
    cors(req, res, async () => {
        try {
            console.log('📨 Recebendo requisição:', req.path);
            const { email } = await validateRequest(req);
            
            // Tenta achar a ação de forma robusta no path
            const action = req.path.includes('status') ? 'status' :
                           req.path.includes('start') ? 'start' :
                           req.path.includes('stop') ? 'stop' :
                           req.path.includes('whitelist') ? 'whitelist' : 
                           req.path.split('/').pop();

            const db = new Firestore();

            switch (action) {
                case 'start':
                    return await startStream(req, res, db);
                case 'stop':
                    return await stopStream(req, res, db);
                case 'status':
                    return await getStatus(req, res, db);
                case 'whitelist':
                    return await manageWhitelist(req, res, db);
                default:
                    res.status(404).send('Ação não encontrada');
            }
        } catch (error) {
            console.error('❌ Erro na API:', error.message);
            res.status(error.message.includes('autorizado') ? 401 : 500).json({ error: error.message });
        }
    });
};

async function validateRequest(req) {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) throw new Error('Não autorizado: Token ausente');

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email;

    const db = new Firestore();
    const userDoc = await db.collection('allowed_users').doc(email).get();
    if (!userDoc.exists) {
        throw new Error(`Acesso negado: O email ${email} não está na lista permitida.`);
    }

    return { email, decodedToken };
}

async function startStream(req, res, db) {
    const { cameraUrl, streamKey, cameraName, server } = req.body;

    // 1. Limpa qualquer VM existente antes de criar uma nova (só 1 VM por vez)
    const existingDoc = await db.collection('system').doc('current_stream').get();
    if (existingDoc.exists) {
        const existing = existingDoc.data();
        console.log(`♻️ Já existe VM ${existing.vmName}. Destruindo antes de criar nova...`);
        try {
            await instancesClient.delete({
                project: PROJECT_ID,
                zone: ZONE,
                instance: existing.vmName,
            });
            console.log(`✅ VM antiga ${existing.vmName} deletada.`);
        } catch (e) {
            console.warn(`⚠️ VM antiga ${existing.vmName} já não existia:`, e.message);
        }
        await db.collection('system').doc('current_stream').delete();
    }

    // 2. Cria a nova VM
    const vmName = `streamer-${Date.now()}`;
    console.log(`🚀 Criando VM ${vmName} para câmera ${cameraName}...`);

    const instanceResource = {
        name: vmName,
        machineType: `zones/${ZONE}/machineTypes/e2-medium`,
        scheduling: {
            provisioningModel: 'SPOT',
            instanceTerminationAction: 'DELETE',
            onHostMaintenance: 'TERMINATE',
        },
        serviceAccounts: [
            {
                email: SA_EMAIL,
                scopes: ['https://www.googleapis.com/auth/cloud-platform'],
            },
        ],
        disks: [
            {
                initializeParams: {
                    sourceImage: 'projects/debian-cloud/global/images/family/debian-12',
                    diskSizeGb: '10',
                },
                boot: true,
                autoDelete: true,
            },
        ],
        networkInterfaces: [
            {
                name: 'global/networks/default',
                accessConfigs: [
                    {
                        name: 'External NAT',
                        type: 'ONE_TO_ONE_NAT',
                    },
                ],
            },
        ],
        metadata: {
            items: [
                {
                    key: 'startup-script',
                    value: getStartupScript(cameraUrl, streamKey),
                },
                { key: 'camera-name', value: cameraName },
            ],
        },
        tags: {
            items: ['http-server'],
        },
    };

    const [operation] = await instancesClient.insert({
        project: PROJECT_ID,
        zone: ZONE,
        instanceResource,
    });

    console.log(`⏳ Operação de criação: ${operation.name}`);

    // 3. Salvar estado no Firestore
    await db.collection('system').doc('current_stream').set({
        status: 'starting',
        vmName,
        cameraName,
        server: server || null,
        startTime: new Date(),
        updatedAt: new Date(),
    });

    res.json({ message: 'Provisionando VM Spot...', vmName });
}

async function stopStream(req, res, db) {
    const streamDoc = await db.collection('system').doc('current_stream').get();
    if (!streamDoc.exists) return res.status(404).send('Nenhuma transmissão ativa');

    const { vmName } = streamDoc.data();
    
    try {
        console.log(`🛑 Deletando VM ${vmName}...`);
        await instancesClient.delete({
            project: PROJECT_ID,
            zone: ZONE,
            instance: vmName,
        });
    } catch (e) {
        console.warn('VM já não existia ou erro ao deletar:', e.message);
    }

    await db.collection('system').doc('current_stream').delete();
    res.json({ message: 'Transmissão encerrada e VM deletada.' });
}

async function getStatus(req, res, db) {
    const streamDoc = await db.collection('system').doc('current_stream').get();

    if (!streamDoc.exists) {
        return res.json({ status: 'idle' });
    }

    const data = streamDoc.data();
    const { vmName, status, cameraName, server } = data;

    // Se já foi marcado como 'streaming' pelo startup-script, retorna diretamente
    if (status === 'streaming') {
        // Verifica se a VM ainda existe (pode ter sido preemptada)
        try {
            const [instance] = await instancesClient.get({
                project: PROJECT_ID,
                zone: ZONE,
                instance: vmName,
            });
            if (instance.status === 'RUNNING') {
                return res.json({ status: 'streaming', vmName, cameraName, server, vmStatus: 'RUNNING' });
            } else if (instance.status === 'TERMINATED' || instance.status === 'STOPPED') {
                // VM foi preemptada ou parou
                console.log(`⚠️ VM ${vmName} foi preemptada (status: ${instance.status}). Limpando...`);
                await db.collection('system').doc('current_stream').delete();
                try { await instancesClient.delete({ project: PROJECT_ID, zone: ZONE, instance: vmName }); } catch (e) { }
                return res.json({ status: 'idle' });
            }
            // Outros estados (STAGING, etc)
            return res.json({ status: 'streaming', vmName, cameraName, server, vmStatus: instance.status });
        } catch (e) {
            // VM não encontrada — foi deletada
            console.log(`⚠️ VM ${vmName} não encontrada. Limpando Firestore...`);
            await db.collection('system').doc('current_stream').delete();
            return res.json({ status: 'idle' });
        }
    }

    // Se o status é 'starting', verifica se a VM já subiu
    if (status === 'starting') {
        try {
            const [instance] = await instancesClient.get({
                project: PROJECT_ID,
                zone: ZONE,
                instance: vmName,
            });
            console.log(`🔍 VM ${vmName} status: ${instance.status}`);

            if (instance.status === 'RUNNING') {
                // VM está rodando! Verifica há quanto tempo (se >60s, assume que FFmpeg já iniciou)
                const startTime = data.startTime?.toDate ? data.startTime.toDate() : new Date(data.startTime);
                const elapsed = (Date.now() - startTime.getTime()) / 1000;

                if (elapsed > 90) {
                    // Após 90s, assume que apt-get + ffmpeg já iniciaram
                    console.log(`✅ VM ${vmName} rodando há ${Math.round(elapsed)}s. Marcando como streaming.`);
                    await db.collection('system').doc('current_stream').update({
                        status: 'streaming',
                        updatedAt: new Date(),
                    });
                    return res.json({ status: 'streaming', vmName, cameraName, server, vmStatus: 'RUNNING' });
                }

                return res.json({ status: 'starting', vmName, cameraName, server, vmStatus: 'RUNNING', elapsed: Math.round(elapsed) });
            } else if (instance.status === 'TERMINATED' || instance.status === 'STOPPED') {
                console.log(`❌ VM ${vmName} falhou ao iniciar (status: ${instance.status}).`);
                await db.collection('system').doc('current_stream').delete();
                try { await instancesClient.delete({ project: PROJECT_ID, zone: ZONE, instance: vmName }); } catch (e) { }
                return res.json({ status: 'idle' });
            }

            // STAGING, PROVISIONING, etc.
            return res.json({ status: 'starting', vmName, cameraName, server, vmStatus: instance.status });
        } catch (e) {
            console.warn(`⚠️ VM ${vmName} não encontrada durante verificação:`, e.message);
            // VM não existe mais
            await db.collection('system').doc('current_stream').delete();
            return res.json({ status: 'idle' });
        }
    }

    // Fallback
    res.json(data);
}

async function manageWhitelist(req, res, db) {
    const { action, emailToAdd } = req.body;
    if (action === 'add') {
        await db.collection('allowed_users').doc(emailToAdd).set({ addedAt: new Date() });
        return res.json({ message: `Email ${emailToAdd} adicionado.` });
    }
    // Listar todos
    const snapshot = await db.collection('allowed_users').get();
    const emails = snapshot.docs.map(doc => doc.id);
    res.json({ emails });
}

function getStartupScript(cameraUrl, streamKey) {
    return `#!/bin/bash
set -e

# Instalar dependências
apt-get update -qq
apt-get install -y -qq ffmpeg curl

echo "🚀 Iniciando FFmpeg para YouTube..."

# Loop de captura: curl pega JPEG e pipa direto no FFmpeg
while true; do
    curl -s --max-time 3 "${cameraUrl}" || true
    sleep 0.1
done | ffmpeg -f image2pipe -vcodec mjpeg -framerate 10 -i - \\
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \\
    -map 0:v -map 1:a -c:v libx264 -pix_fmt yuv420p -preset ultrafast -tune zerolatency \\
    -b:v 1500k -maxrate 1500k -bufsize 3000k -g 20 -c:a aac -b:a 128k -ar 44100 -f flv \\
    "${streamKey}"
`;
}
