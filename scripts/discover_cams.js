const axios = require('axios');
const fs = require('fs');

const IP = "177.8.172.52";
const PORTS = [6600, 6601, 7600, 7601, 8600, 8601, 9600, 9601];

const TARGET_CAMS = [
    "CAM064-svr1",
    "CAM027-svr3",
    "CAM006-%20svr2",
    "CAM007-%20svr2",
    "CAM006-svr2", // Sem o %20 por garantia
    "CAM007-svr2"
];

const AUTH = "AuthUser=associados&AuthPass=socios2013";

async function checkCam(port, camName) {
    const url = `http://${IP}:${port}/Interface/Cameras/GetSnapshot?Camera=${camName}&${AUTH}&Width=32&Height=24&Quality=10`;
    try {
        const response = await axios.get(url, { timeout: 2000, responseType: 'arraybuffer' });
        const contentType = response.headers['content-type'];
        if (contentType && contentType.includes('image')) {
            return true;
        }
    } catch (e) {
        // Silently fail
    }
    return false;
}

async function discover() {
    console.log(`🔍 Iniciando descoberta no IP ${IP}...`);
    const found = [];

    for (const port of PORTS) {
        process.stdout.write(`\nTesting Port ${port}: `);
        for (const cam of TARGET_CAMS) {
            process.stdout.write(`${cam}... `);
            const exists = await checkCam(port, cam);
            if (exists) {
                console.log(`✅ ENCONTRADA!`);
                found.push({ server: `${IP}:${port}`, name: cam });
            }
        }
    }

    console.log("\n\n---------------------------------");
    console.log("🎯 Resumo da Descoberta:");
    console.log(JSON.stringify(found, null, 2));
    
    if (found.length > 0) {
        console.log("\nSalvando resultados em discovered_extra.json...");
        fs.writeFileSync('discovered_extra.json', JSON.stringify(found, null, 2));
    } else {
        console.log("\nNenhuma câmera encontrada desta vez.");
    }
}

discover();
