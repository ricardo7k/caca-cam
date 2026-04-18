#!/bin/bash

INPUT="streamer/public/active_ips.txt"
OUTPUT="streamer/public/camera_nodes.json"
CREDENTIALS="AuthUser=associados&AuthPass=socios2013"

echo "Verifying Camera API on active nodes..."
echo "[" > $OUTPUT

FIRST=true
while read line; do
    IP=$(echo $line | cut -d':' -f1)
    PORT=$(echo $line | cut -d':' -f2)
    
    # Try a simple snapshot request for CAM001 to see if server responds
    URL="http://$IP:$PORT/Interface/Cameras/GetSnapshot?Camera=CAM001-svr3&$CREDENTIALS&Width=10&Height=10&Quality=1"
    
    STATUS=$(curl -o /dev/null -s -w "%{http_code}" --max-time 2 "$URL")
    
    if [ "$STATUS" == "200" ]; then
        echo "[!] Found active API on $IP:$PORT"
        if [ "$FIRST" = false ]; then echo "," >> $OUTPUT; fi
        echo "  {\"ip\": \"$IP\", \"port\": \"$PORT\"}" >> $OUTPUT
        FIRST=false
    fi
done < $INPUT

echo "]" >> $OUTPUT
echo "Verification complete. Results in $OUTPUT"
