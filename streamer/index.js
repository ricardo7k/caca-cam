require('dotenv').config();
const { spawn } = require('child_process');
const axios = require('axios');
const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Serve static files from the root directory
const rootDir = path.join(__dirname, '..');
app.use(express.static(rootDir));

let currentStream = {
    ffmpeg: null,
    isCapturing: false,
    interval: null,
    status: 'idle',
    cameraUrl: null,
    server: null,
    cameraName: null
};

const FPS = process.env.FPS || 10;
const FFMPEG_PATH = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg';

function stopCurrentStream() {
    console.log('🛑 Parando stream atual...');
    if (currentStream.ffmpeg) {
        currentStream.ffmpeg.stdin.end();
        currentStream.ffmpeg.kill('SIGKILL');
    }
    if (currentStream.interval) {
        clearTimeout(currentStream.interval);
    }
    currentStream = {
        ffmpeg: null,
        isCapturing: false,
        interval: null,
        status: 'idle',
        cameraUrl: null,
        server: null,
        cameraName: null
    };
}

async function captureFrame(cameraUrl) {
    if (currentStream.isCapturing || currentStream.status !== 'streaming') return;
    currentStream.isCapturing = true;
    
    const startTime = Date.now();
    try {
        const response = await axios.get(cameraUrl, {
            responseType: 'arraybuffer',
            timeout: 3000 
        });

        if (response.status === 200 && currentStream.ffmpeg && currentStream.ffmpeg.stdin.writable) {
            currentStream.ffmpeg.stdin.write(Buffer.from(response.data));
        }
    } catch (error) {
        // Silently continue to maintain frame flow
    }

    currentStream.isCapturing = false;
    const elapsedTime = Date.now() - startTime;
    const frameInterval = 1000 / parseInt(FPS);
    const waitTime = Math.max(0, frameInterval - elapsedTime);
    
    if (currentStream.status === 'streaming') {
        currentStream.interval = setTimeout(() => captureFrame(cameraUrl), waitTime);
    }
}

app.post('/api/stream/start', (req, res) => {
    const { cameraUrl, streamKey, server, cameraName } = req.body;

    if (!cameraUrl || !streamKey) {
        return res.status(400).json({ error: 'cameraUrl e streamKey são obrigatórios' });
    }

    stopCurrentStream();

    const youtubeUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

    const ffmpegArgs = [
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-framerate', FPS.toString(),
        '-i', '-',                          
        '-f', 'lavfi', 
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', 
        
        '-map', '0:v',                      
        '-map', '1:a',                      
        
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast',
        '-b:v', '2500k',                    
        '-maxrate', '2500k',
        '-bufsize', '5000k',
        '-g', (parseInt(FPS) * 2).toString(),
        
        '-c:a', 'aac',                      
        '-b:a', '128k',                     
        '-ar', '44100',
        
        '-f', 'flv',
        youtubeUrl
    ];

    console.log(`🚀 Iniciando stream: ${cameraUrl} -> YouTube`);

    currentStream.ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
    currentStream.status = 'streaming';
    currentStream.cameraUrl = cameraUrl;
    currentStream.server = server;
    currentStream.cameraName = cameraName;

    currentStream.ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('frame=')) {
            process.stdout.write(`\r📺 Transmitindo: ${msg.split('fps=')[0].trim()} | Status: OK`);
        }
    });

    currentStream.ffmpeg.on('close', (code) => {
        console.log(`\nProcesso FFmpeg encerrado com código ${code}`);
        if (currentStream.status === 'streaming') {
            currentStream.status = 'idle';
        }
    });

    captureFrame(cameraUrl);

    res.json({ message: 'Stream iniciado com sucesso', status: 'streaming' });
});

app.post('/api/stream/stop', (req, res) => {
    stopCurrentStream();
    res.json({ message: 'Stream parado', status: 'idle' });
});

app.get('/api/stream/status', (req, res) => {
    res.json({ 
        status: currentStream.status,
        cameraUrl: currentStream.cameraUrl,
        server: currentStream.server,
        cameraName: currentStream.cameraName
    });
});

app.listen(port, () => {
    console.log(`✅ Servidor rodando em http://localhost:${port}`);
    console.log(`📁 Servindo arquivos estáticos de: ${rootDir}`);
});

process.on('SIGINT', () => {
    stopCurrentStream();
    process.exit();
});

