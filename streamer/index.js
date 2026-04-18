require('dotenv').config();
const { spawn } = require('child_process');
const axios = require('axios');
const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Serve static files from the internal public directory
const rootDir = path.join(__dirname, 'public');
app.use(express.static(rootDir));

// Explicit route for the index page
app.get('/', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
});

// Diagnostic endpoint
app.get('/api/debug/paths', (req, res) => {
    const fs = require('fs');
    try {
        res.json({
            status: 'ok',
            __dirname,
            cwd: process.cwd(),
            rootDir,
            exists: fs.existsSync(path.join(rootDir, 'index.html')),
            filesInRootDir: fs.existsSync(rootDir) ? fs.readdirSync(rootDir) : 'DIR NOT FOUND'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

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

// Proxy endpoint to fix Mixed Content (HTTP camera images on HTTPS site)
app.get('/api/proxy-snapshot', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL is required');

    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            timeout: 5000,
            validateStatus: false
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Error proxying image');
    }
});

app.get('/api/stream/status', (req, res) => {
    res.json({ 
        status: currentStream.status,
        cameraUrl: currentStream.cameraUrl,
        server: currentStream.server,
        cameraName: currentStream.cameraName
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Servidor rodando em http://0.0.0.0:${port}`);
    console.log(`📁 Servindo arquivos estáticos de: ${rootDir}`);
});

process.on('SIGINT', () => {
    stopCurrentStream();
    process.exit();
});

