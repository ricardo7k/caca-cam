#!/bin/bash
# Script para rodar o Dashboard Caça-Cam localmente no seu Mac
# Isso permite carregar as câmeras via HTTP direto sem bloqueios de segurança.

echo "----------------------------------------------------------"
echo "🖥️ Iniciando Dashboard Caça-Cam Local (Modo Híbrido)"
echo "----------------------------------------------------------"

# Verificar se o diretório existe
if [ ! -d "streamer/public" ]; then
    echo "❌ Erro: Pasta 'streamer/public' não encontrada."
    exit 1
fi

echo "🚀 Abrindo servidor local em http://localhost:5000"
echo "💡 Os comandos de Transmitir (Nuvem) continuarão funcionando!"
echo "----------------------------------------------------------"

# Rodar o servidor e abrir no navegador padrão (Safari/Chrome)
npx serve -s streamer/public -l 5000 &
sleep 2
open "http://localhost:5000"

echo "✅ Painel aberto. Para fechar, aperte CTRL+C neste terminal."
wait
