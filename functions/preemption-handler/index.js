const functions = require('@google-cloud/functions-framework');
const compute = require('@google-cloud/compute');
const { Firestore } = require('@google-cloud/firestore');
const admin = require('firebase-admin');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const PROJECT_ID = 'paineiras-cam';
const ZONE = 'southamerica-east1-a';
const SA_EMAIL = `monitor-sa@${PROJECT_ID}.iam.gserviceaccount.com`;

// Cliente v4
const instancesClient = new compute.InstancesClient();

exports.preemptionHandler = async (cloudEvent) => {
    try {
        console.log('🔔 Iniciando processamento de preempção...');
        const db = new Firestore();

        const base64Data = cloudEvent.data?.message?.data;
        if (!base64Data) {
            console.log('⚠️ Payload do Pub/Sub vazio.');
            return;
        }
        const logEntry = JSON.parse(Buffer.from(base64Data, 'base64').toString());

        // Verificar no Firestore se o sistema "acredita" que deveria estar transmitindo
        const streamDoc = await db.collection('system').doc('current_stream').get();
        
        if (!streamDoc.exists) {
            console.log('⏹️  Nenhuma transmissão ativa. Ignorando evento de preempção.');
            return;
        }

        const streamData = streamDoc.data();
        const oldVmName = logEntry.resource.labels.instance_id;

        console.log(`🧨 VM ${oldVmName} foi interrompida pelo Google.`);
        console.log(`🔄 Reiniciando transmissão para: ${streamData.cameraName}...`);

        // Re-criação da VM usando API v4
        const newVmName = `streamer-resilient-${Date.now()}`;
        const instanceResource = {
            name: newVmName,
            machineType: `zones/${ZONE}/machineTypes/e2-medium`,
            scheduling: {
                provisioningModel: 'SPOT',
                instanceTerminationAction: 'DELETE',
                onHostMaintenance: 'TERMINATE',
            },
            serviceAccounts: [{
                email: SA_EMAIL,
                scopes: ['https://www.googleapis.com/auth/cloud-platform'],
            }],
            disks: [{
                initializeParams: {
                    sourceImage: 'projects/debian-cloud/global/images/family/debian-12',
                    diskSizeGb: '10',
                },
                boot: true,
                autoDelete: true,
            }],
            networkInterfaces: [{
                name: 'global/networks/default',
                accessConfigs: [{
                    name: 'External NAT',
                    type: 'ONE_TO_ONE_NAT',
                }],
            }],
            metadata: {
                items: [
                    { key: 'startup-script', value: streamData.startupScript || '' },
                    { key: 'camera-name', value: streamData.cameraName }
                ]
            },
            tags: {
                items: ['http-server'],
            },
        };

        await instancesClient.insert({
            project: PROJECT_ID,
            zone: ZONE,
            instanceResource,
        });

        // Atualizar Firestore com o novo nome da VM
        await db.collection('system').doc('current_stream').update({
            vmName: newVmName,
            restartedAt: new Date(),
            restartCount: (streamData.restartCount || 0) + 1
        });

        console.log(`✅ Nova VM ${newVmName} criada com sucesso.`);

    } catch (error) {
        console.error('❌ Erro no Preemption Handler:', error.message);
    }
};
