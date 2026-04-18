#!/bin/bash
# Script de Deploy das Cloud Functions para Paineras Cam
# Este script faz o upload dos microserviços para o GCP.

PROJECT_ID="paineiras-cam"
REGION="southamerica-east1"
SA_EMAIL="monitor-sa@${PROJECT_ID}.iam.gserviceaccount.com"

echo "----------------------------------------------------------"
echo "📦 Iniciando Deploy dos Microserviços GCP"
echo "----------------------------------------------------------"

# Definir o diretório raiz do projeto (um nível acima da pasta scripts)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# Definir projeto padrão
gcloud config set project $PROJECT_ID

# 1. Deploy da API Control
echo "🚀 [1/3] Fazendo deploy da FUNCTION: api-control..."
gcloud functions deploy api-control \
    --gen2 \
    --runtime=nodejs20 \
    --region=$REGION \
    --source=./functions/api-control \
    --entry-point=apiControl \
    --trigger-http \
    --allow-unauthenticated \
    --service-account=$SA_EMAIL \
    --set-env-vars PROJECT_ID=$PROJECT_ID,REGION=$REGION \
    --memory=1024Mi \
    --timeout=120s \
    --quiet

# 2. Deploy do Proxy de Snapshots
echo "🚀 [2/3] Fazendo deploy da FUNCTION: proxy-snapshot..."
gcloud functions deploy proxy-snapshot \
    --gen2 \
    --runtime=nodejs20 \
    --region=$REGION \
    --source=./functions/proxy-snapshot \
    --entry-point=proxySnapshot \
    --trigger-http \
    --allow-unauthenticated \
    --service-account=$SA_EMAIL \
    --memory=1024Mi \
    --timeout=120s \
    --quiet

# 3. Deploy do Vigia de Preempção (Auto-Restart)
echo "🚀 [3/3] Fazendo deploy da FUNCTION: preemption-handler..."
gcloud functions deploy preemption-handler \
    --gen2 \
    --runtime=nodejs20 \
    --region=$REGION \
    --source=./functions/preemption-handler \
    --entry-point=preemptionHandler \
    --trigger-topic=spot-preemption \
    --service-account=$SA_EMAIL \
    --memory=1024Mi \
    --timeout=120s \
    --quiet

echo "----------------------------------------------------------"
echo "✅ Todos os microserviços foram publicados!"
echo "----------------------------------------------------------"

# Mostrar as URLs das funções para configurar no frontend
echo "🔗 URLs das APIs para configurar no index.html:"
gcloud functions describe api-control --region=$REGION --gen2 --format='value(serviceConfig.uri)'
gcloud functions describe proxy-snapshot --region=$REGION --gen2 --format='value(serviceConfig.uri)'
