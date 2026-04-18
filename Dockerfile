# Use Node.js 18 slim image
FROM node:18-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set work directory directly to the streamer folder
WORKDIR /app

# Copy the entire project for context
COPY . .

# Move into the server directory
WORKDIR /app/streamer

# Install dependencies
RUN npm install

# Set environment variables
ENV HOST=0.0.0.0
ENV PORT=8080
ENV FFMPEG_PATH=ffmpeg

# Start the server
CMD ["node", "index.js"]
