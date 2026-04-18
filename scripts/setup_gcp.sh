#!/bin/bash
# Script de Configuração Inicial da Infraestrutura GCP para Paineras Cam
# Este script deve ser executado com permissões de Owner no projeto.

PROJECT_ID="paineiras-cam"
REGION="us-west1"
SA_NAME="monitor-sa"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "----------------------------------------------------------"
echo "🚀 Iniciando configuração do projeto GCP: $PROJECT_ID"
echo "----------------------------------------------------------"

# Definir projeto padrão
gcloud config set project $PROJECT_ID

# 1. Habilitar APIs Necessárias
echo "📦 Habilitando APIs (isso pode levar alguns minutos)..."
gcloud services enable \
    compute.googleapis.com \
    cloudfunctions.googleapis.com \
    firestore.googleapis.com \
    pubsub.googleapis.com \
    logging.googleapis.com \
    iam.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    identitytoolkit.googleapis.com \
    firebase.googleapis.com \
    eventarc.googleapis.com \
    eventarcpublishing.googleapis.com

# 2. Criar Service Account (se não existir)
echo "👤 Criando Service Account: $SA_NAME..."
gcloud iam service-accounts create $SA_NAME \
    --display-name="Service Account para Monitoramento de Câmeras" \
    --project $PROJECT_ID \
    --quiet || echo "⚠️ Service account já existe."

# Aguardar propagação (GCP IAM tem delay de consistência eventual)
echo "⏳ Aguardando 10 segundos para propagação da conta de serviço..."
sleep 10

# 3. Atribuir Roles Essenciais
echo "🔐 Atribuindo permissões IAM..."
ROLES=(
    "roles/compute.instanceAdmin.v1"
    "roles/datastore.user"
    "roles/iam.serviceAccountUser"
    "roles/pubsub.publisher"
    "roles/logging.logWriter"
    "roles/logging.configWriter"
    "roles/cloudfunctions.admin"
    "roles/firebase.admin"
    "roles/eventarc.eventReceiver"
    "roles/run.admin"
)

for ROLE in "${ROLES[@]}"; do
    echo "  - Adicionando $ROLE..."
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:$SA_EMAIL" \
        --role="$ROLE" \
        --quiet > /dev/null
done

# 4. Tópico Pub/Sub para Resiliência
echo "🔔 Criando tópico Pub/Sub para preempção..."
gcloud pubsub topics create spot-preemption --project $PROJECT_ID || echo "⚠️ Tópico já existe."

# 5. Configurar Sink de Logs para detectar queda da Spot VM
echo "👁️ Configurando Sink de Logs (Vigia de Preempção)..."
gcloud logging sinks create spot-preemption-sink \
    pubsub.googleapis.com/projects/$PROJECT_ID/topics/spot-preemption \
    --log-filter='resource.type="gce_instance" AND operation.producer="compute.instances.preempted"' \
    --project $PROJECT_ID || echo "⚠️ Sink já existe."

# 6. Dar permissão para o Sink publicar no Tópico
SINK_SA=$(gcloud logging sinks describe spot-preemption-sink --project $PROJECT_ID --format='value(writerIdentity)')
gcloud pubsub topics add-iam-policy-binding spot-preemption \
    --member=$SINK_SA \
    --role="roles/pubsub.publisher" \
    --project $PROJECT_ID

echo "----------------------------------------------------------"
echo "✅ Configuração de base concluída!"
echo "👉 Próximo passo: Deploy das Cloud Functions."
echo "----------------------------------------------------------"
