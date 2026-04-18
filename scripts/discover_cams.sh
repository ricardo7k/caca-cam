#!/bin/bash

IP="177.8.172.52"
PORTS=(6600 6601 7600 7601 8600 8601 9600 9601)
CAM_NAMES=("CAM064-svr1" "CAM027-svr3" "CAM006-%20svr2" "CAM007-%20svr2" "CAM006-svr2" "CAM007-svr2")
AUTH="AuthUser=associados&AuthPass=socios2013"

echo "🔍 Iniciando descoberta no IP $IP via CURL..."

# Criar/Esvaziar arquivo de resultados
echo "[" > discovered_extra.json

FIRST=true

for PORT in "${PORTS[@]}"; do
    echo -n "Port $PORT: "
    for CAM in "${CAM_NAMES[@]}"; do
        # Codificar o %20 para a URL se necessário (já está na variável se for o caso)
        URL="http://$IP:$PORT/Interface/Cameras/GetSnapshot?Camera=$CAM&$AUTH&Width=32&Height=24&Quality=10"
        
        # Tentar baixar os headers e verificar o Content-Type
        RESPONSE=$(curl -s -I "$URL" --connect-timeout 2)
        
        if echo "$RESPONSE" | grep -qi "Content-Type: image"; then
            echo -n "✅ $CAM found! "
            
            if [ "$FIRST" = true ]; then
                FIRST=false
            else
                echo "," >> discovered_extra.json
            fi
            
            echo "  {\"server\": \"$IP:$PORT\", \"name\": \"$CAM\"}" >> discovered_extra.json
        fi
    done
    echo "done."
done

echo "]" >> discovered_extra.json
echo "---------------------------------"
echo "🎯 Descoberta finalizada. Resultados salvos em discovered_extra.json"
