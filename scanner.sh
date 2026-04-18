#!/bin/bash

# Configuration
# Verificando os intervalos 46XX, 56XX, 66XX, 76XX, 86XX, 96XX
PORTS=$(for i in {4,5,6,7,8,9}; do seq ${i}600 ${i}699; done)
TIMEOUT=5
THREADS=200
OUTPUT="streamer/public/active_ips.txt"

# Colors
GREEN='\033[1;32m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m'

echo -e "${BLUE}=== Iniciando Varredura de Câmeras ===${NC}"
> $OUTPUT

scan_node() {
    ip=$1
    port=$2
    
    if nc -z -w $TIMEOUT $ip $port 2>/dev/null; then
        # Limpa a linha atual e imprime o resultado fixo
        echo -e "\r\033[K${GREEN}[+] ENCONTRADO: $ip:$port está ABERTO!${NC}"
        echo "$ip:$port" >> $OUTPUT
    fi
}

export -f scan_node
export TIMEOUT OUTPUT GREEN NC GRAY

count=0
if [ -f "ips.txt" ]; then
    while read ip; do
        if [ -z "$ip" ]; then continue; fi
        for port in $PORTS; do
            # Mostra o progresso na mesma linha (\r)
            # \033[K limpa o resto da linha para não sobrar rastro
            printf "\r${GRAY}[Verificando] $ip:$port...${NC}\033[K"
            
            # Controle de threads
            ((i=i%THREADS)); ((i++==0)) && wait
            scan_node "$ip" "$port" &
        done
    done < ips.txt
    wait
else
    echo -e "\n${BLUE}Erro: Crie o arquivo 'ips.txt' com os IPs desejados.${NC}"
fi

echo -e "\n${BLUE}=== Varredura Completa! ===${NC}"
echo -e "${BLUE}Resultados salvos em: $OUTPUT${NC}"
