#!/bin/bash

IP="177.8.172.52"
PORTS=(6600 6601 7600 7601 8600 8601 9600 9601)
AUTH="AuthUser=associados&AuthPass=socios2013"

echo "🔍 Iniciando VARREDURA PROFUNDA no IP $IP..."

echo "[" > discovered_deep.json
FIRST=true

# Funcao para testar
test_cam() {
    local port=$1
    local name=$2
    local url="http://$IP:$port/Interface/Cameras/GetSnapshot?Camera=$name&$AUTH&Width=32&Height=24&Quality=10"
    
    local response=$(curl -s -I "$url" --connect-timeout 1)
    if echo "$response" | grep -qi "Content-Type: image"; then
        echo -n "✅ $name found on $port! "
        if [ "$FIRST" = true ]; then FIRST=false; else echo "," >> discovered_deep.json; fi
        echo "  {\"server\": \"$IP:$port\", \"name\": \"$name\"}" >> discovered_deep.json
        return 0
    fi
    return 1
}

# 1. Testar os alvos específicos com vários sufixos
TARGET_IDS=("064" "027" "006" "007")
SUFFIXES=("svr1" "%20svr2" "svr3" "svr2" "-svr1" "-svr2" "-svr3")

echo "--- Testando Câmeras Alvo ---"
for PORT in "${PORTS[@]}"; do
    for ID in "${TARGET_IDS[@]}"; do
        for SUF in "${SUFFIXES[@]}"; do
            test_cam "$PORT" "CAM${ID}-${SUF}"
            test_cam "$PORT" "CAM${ID}${SUF}"
        done
    done
done

# 2. Varredura sequencial (Bônus)
echo -e "\n--- Varredura Sequencial (CAM001-CAM090) ---"
for PORT in 7601 8601 9601; do
    echo "Scanning port $PORT..."
    SUF=""
    [ "$PORT" == "8601" ] && SUF="-svr1"
    [ "$PORT" == "9601" ] && SUF="-%20svr2"
    [ "$PORT" == "7601" ] && SUF="-svr3"

    for i in $(seq -f "%03g" 1 90); do
        test_cam "$PORT" "CAM${i}${SUF}"
    done
done

echo "]" >> discovered_deep.json
echo "---------------------------------"
echo "🎯 Varredura finalizada. Resultados em discovered_deep.json"
