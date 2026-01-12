#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}/services/app"
COLLECTOR_DIR="${SCRIPT_DIR}/collector"

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

# Generate unique tag
IMAGE_TAG="$(date +%Y%m%d-%H%M%S)"

echo "Region: ${REGION}"
echo "Account: ${ACCOUNT_ID}"
echo "Image Tag: ${IMAGE_TAG}"

echo "Logging in to ECR..."
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ECR}"

echo "Building and pushing app image..."
docker build --platform linux/amd64 -t "${APP_REPO}:${IMAGE_TAG}" "${APP_DIR}"
docker tag "${APP_REPO}:${IMAGE_TAG}" "${ECR}/${APP_REPO}:latest"
docker tag "${APP_REPO}:${IMAGE_TAG}" "${ECR}/${APP_REPO}:${IMAGE_TAG}"
docker push "${ECR}/${APP_REPO}:latest"
docker push "${ECR}/${APP_REPO}:${IMAGE_TAG}"

echo "Building and pushing collector image..."
docker build --platform linux/amd64 -t "${COLLECTOR_REPO}:${IMAGE_TAG}" "${COLLECTOR_DIR}"
docker tag "${COLLECTOR_REPO}:${IMAGE_TAG}" "${ECR}/${COLLECTOR_REPO}:latest"
docker tag "${COLLECTOR_REPO}:${IMAGE_TAG}" "${ECR}/${COLLECTOR_REPO}:${IMAGE_TAG}"
docker push "${ECR}/${COLLECTOR_REPO}:latest"
docker push "${ECR}/${COLLECTOR_REPO}:${IMAGE_TAG}"

echo "Images pushed successfully!"

# Hardcoded cluster name
CLUSTER="adot-demo-cluster"

echo "Updating ECS task definitions and services..."
  
  # Update app task definition
  APP_TASK_DEF=$(aws ecs describe-services \
    --cluster "${CLUSTER}" \
    --services adot-demo-app \
    --query "services[0].taskDefinition" \
    --output text --region "${REGION}" 2>/dev/null)
  
  if [[ -n "${APP_TASK_DEF}" && "${APP_TASK_DEF}" != "None" ]]; then
    # Get current task definition and update image
    TASK_FILE=$(mktemp)
    aws ecs describe-task-definition \
      --task-definition "${APP_TASK_DEF}" \
      --query "taskDefinition" \
      --region "${REGION}" | \
      jq --arg img "${ECR}/${APP_REPO}:${IMAGE_TAG}" \
        'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy) | 
         .containerDefinitions[0].image = $img' > "${TASK_FILE}"
    
    aws ecs register-task-definition \
      --cli-input-json "file://${TASK_FILE}" \
      --region "${REGION}" >/dev/null
    rm -f "${TASK_FILE}"
    
    # Update service with new task definition
    aws ecs update-service \
      --cluster "${CLUSTER}" \
      --service adot-demo-app \
      --force-new-deployment \
      --region "${REGION}" >/dev/null
    
    echo "  ✓ App service updated with new image (${IMAGE_TAG})"
  fi
  
  # Update collector task definition
  COLLECTOR_TASK_DEF=$(aws ecs describe-services \
    --cluster "${CLUSTER}" \
    --services adot-demo-collector \
    --query "services[0].taskDefinition" \
    --output text --region "${REGION}" 2>/dev/null)
  
  if [[ -n "${COLLECTOR_TASK_DEF}" && "${COLLECTOR_TASK_DEF}" != "None" ]]; then
    # Get current task definition and update image
    TASK_FILE=$(mktemp)
    aws ecs describe-task-definition \
      --task-definition "${COLLECTOR_TASK_DEF}" \
      --query "taskDefinition" \
      --region "${REGION}" | \
      jq --arg img "${ECR}/${COLLECTOR_REPO}:${IMAGE_TAG}" \
        'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy) | 
         .containerDefinitions[0].image = $img' > "${TASK_FILE}"
    
    aws ecs register-task-definition \
      --cli-input-json "file://${TASK_FILE}" \
      --region "${REGION}" >/dev/null
    rm -f "${TASK_FILE}"
    
    # Update service with new task definition
    aws ecs update-service \
      --cluster "${CLUSTER}" \
      --service adot-demo-collector \
      --force-new-deployment \
      --region "${REGION}" >/dev/null
    
    echo "  ✓ Collector service updated with new image (${IMAGE_TAG})"
  fi
  
echo ""
echo "Done! ECS is deploying tasks with new images."
echo "Monitor: aws ecs describe-services --cluster ${CLUSTER} --services adot-demo-app adot-demo-collector --region ${REGION}"

