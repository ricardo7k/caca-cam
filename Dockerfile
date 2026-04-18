# Build stage for frontend assets (optional if we just serve static files)
# For this project, we serve from root, so a single stage is fine.

# 1. Use Node.js 18 slim image
FROM node:18-slim

# 2. Install FFmpeg and clean up apt cache to keep image small
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 3. Set work directory
WORKDIR /app

# 4. Copy current directory into container
COPY . .

# 5. Move to streamer directory and install dependencies
WORKDIR /app/streamer
RUN npm install

# 6. Set environment variables
ENV PORT=8080
ENV FFMPEG_PATH=ffmpeg
ENV FPS=10

# 7. Cloud Run requires the app to listen on the $PORT variable
# Our index.js already does this (via process.env.PORT)

# 8. Start the server
CMD ["node", "index.js"]
