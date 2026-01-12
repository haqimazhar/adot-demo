#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REGION="${AWS_REGION:-$(aws configure get region)}"
if [[ -z "${REGION}" ]]; then
  echo "AWS region not set. Set AWS_REGION or configure a default region." >&2
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
APP_REPO="adot-demo-app"
COLLECTOR_REPO="adot-demo-collector"
ECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
STACK_NAME="${STACK_NAME:-ADOTDemo}"
TEMPLATE="${SCRIPT_DIR}/template.yaml"
APP_DIR="${SCRIPT_DIR}/services/app"
COLLECTOR_DIR="${SCRIPT_DIR}/collector"

echo "Region: ${REGION}"
echo "Account: ${ACCOUNT_ID}"

echo "Ensuring ECR repositories exist..."
aws ecr describe-repositories --repository-names "${APP_REPO}" --region "${REGION}" >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name "${APP_REPO}" --region "${REGION}" >/dev/null
aws ecr describe-repositories --repository-names "${COLLECTOR_REPO}" --region "${REGION}" >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name "${COLLECTOR_REPO}" --region "${REGION}" >/dev/null

echo "Logging in to ECR..."
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ECR}"

echo "Building and pushing app image..."
docker build --platform linux/amd64 -t "${APP_REPO}:latest" "${APP_DIR}"
docker tag "${APP_REPO}:latest" "${ECR}/${APP_REPO}:latest"
docker push "${ECR}/${APP_REPO}:latest"

echo "Building and pushing collector image..."
docker build --platform linux/amd64 -t "${COLLECTOR_REPO}:latest" "${COLLECTOR_DIR}"
docker tag "${COLLECTOR_REPO}:latest" "${ECR}/${COLLECTOR_REPO}:latest"
docker push "${ECR}/${COLLECTOR_REPO}:latest"

echo "Building SAM application..."
pushd "${SCRIPT_DIR}" >/dev/null
sam build --use-container --region "${REGION}"

echo "Deploying SAM stack: ${STACK_NAME}"
sam deploy \
  --stack-name "${STACK_NAME}" \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --parameter-overrides AppEnv=staging \
  --region "${REGION}"
popd >/dev/null

echo "Done. Outputs:"
aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs" --output table --region "${REGION}"


