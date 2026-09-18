#!/usr/bin/env bash
# Build the image on Cloud Build and deploy the facilitator to Cloud Run.
#
#   deploy/cloud-run.sh            build + deploy
#   SKIP_BUILD=1 deploy/cloud-run.sh   deploy the latest built image
#
# Prerequisites (one time): the secret named by KEY_SECRET holds the settlement
# wallet's private key, and the runtime service account can read it:
#   gcloud secrets add-iam-policy-binding $KEY_SECRET --project $PROJECT \
#     --member=serviceAccount:$RUNTIME_SA --role=roles/secretmanager.secretAccessor
set -euo pipefail

PROJECT="${PROJECT:-aerial-vehicle-466722-p5}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-sperax-x402-facilitator}"
IMAGE="${IMAGE:-us-central1-docker.pkg.dev/$PROJECT/containers/sperax-x402-facilitator}"
RUNTIME_SA="${RUNTIME_SA:-three-ws@$PROJECT.iam.gserviceaccount.com}"
KEY_SECRET="${KEY_SECRET:-sperax-x402-facilitator-key}"
ARBITRUM_RPC_URL="${ARBITRUM_RPC_URL:-https://arb1.arbitrum.io/rpc}"
TAG="$(git rev-parse --short HEAD)"
IMAGE_TAG="$TAG"
[ -n "${SKIP_BUILD:-}" ] && IMAGE_TAG=latest

cd "$(dirname "$0")/.."

if [ -z "${SKIP_BUILD:-}" ]; then
  gcloud builds submit --project "$PROJECT" --region "$REGION" \
    --config deploy/cloudbuild.yaml --substitutions "_IMAGE=$IMAGE,_TAG=$TAG" .
fi

# One instance: pending settlements are tracked in memory, and a single
# signer keeps nonces sequential. Raise max-instances only after moving the
# pending-settlement store to shared storage.
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE:$IMAGE_TAG" \
  --service-account "$RUNTIME_SA" \
  --allow-unauthenticated \
  --min-instances 1 --max-instances 1 \
  --cpu 1 --memory 512Mi --timeout 120 \
  --set-secrets "FACILITATOR_PRIVATE_KEY=$KEY_SECRET:latest" \
  --update-env-vars "^|^ARBITRUM_RPC_URL=$ARBITRUM_RPC_URL|LOG_LEVEL=info|CONFIRMATION_TIMEOUT_MS=60000${DEMO_PAY_TO:+|DEMO_PAY_TO=$DEMO_PAY_TO}"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo "Deployed: $URL"
curl -fsS "$URL/supported" && echo
curl -sS "$URL/ready" && echo
