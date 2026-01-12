ADOT Demo - Single Template

What this deploys:
- VPC with 2 public and 2 private subnets (NAT for private egress)
- Public ALB for the app (ECS tasks run in private subnets)
- Internal ALB for ADOT collector, Route53 alias otel-service.internal
- ECS Cluster, TaskDefs (app, collector), Services
- SQS queue, DynamoDB table, S3 bucket
- Lambda consumer (SAM builds from folder)

Prereqs:
- AWS CLI and Docker installed/configured

Quick deploy (full stack):

```bash
chmod +x adot-demo/deploy.sh
./adot-demo/deploy.sh
```

Quick update (images only - for code changes):

```bash
chmod +x adot-demo/push-images.sh
./adot-demo/push-images.sh
```

This rebuilds/pushes Docker images and forces ECS to redeploy without touching the CloudFormation stack.

Manual steps (if preferred):
1) Build and push app image
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-$(aws configure get region)}
ECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

aws ecr describe-repositories --repository-names adot-demo-app --region "$REGION" >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name adot-demo-app --region "$REGION"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR"
docker build -t adot-demo-app:latest adot-demo/services/app
docker tag adot-demo-app:latest "$ECR/adot-demo-app:latest"
docker push "$ECR/adot-demo-app:latest"
```

2) Build and push collector image
```bash
aws ecr describe-repositories --repository-names adot-demo-collector --region "$REGION" >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name adot-demo-collector --region "$REGION"
docker build -t adot-demo-collector:latest adot-demo/collector
docker tag adot-demo-collector:latest "$ECR/adot-demo-collector:latest"
docker push "$ECR/adot-demo-collector:latest"
```

3) Build SAM (packages Lambda automatically)
```bash
cd adot-demo
sam build --use-container
```

4) Deploy the stack
```bash
sam deploy \
  --stack-name ADOTDemo \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset \
  --parameter-overrides AppEnv=staging
```

Outputs:
- ALBEndpoint: app URL
- QueueUrl, UsersBucketName, UsersTableName


5) Test the deployment

Get your ALB URL:
```bash
aws cloudformation describe-stacks \
  --stack-name ADOTDemo \
  --query "Stacks[0].Outputs[?OutputKey=='ALBEndpoint'].OutputValue" \
  --output text
```

Create a user:
```bash
# Replace with your actual ALB URL
curl -X POST http://YOUR-ALB-URL/user \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "age": 30,
    "metadata": {
      "role": "admin"
    }
  }'
```

Get a user:
```bash
curl http://YOUR-ALB-URL/user/USER_ID
```

View traces in AWS X-Ray Console.

