// otel-init.js
'use strict';
const path = require('path');

function detectRuntime() {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return 'lambda';
  }
  if (process.env.ECS_CONTAINER_METADATA_URI_V4 || process.env.ECS_CONTAINER_METADATA_URI) {
    return 'ecs';
  }
  return 'local';
}

function getServiceName(explicitName) {
  if (explicitName) return explicitName;
  try {
    const serviceName = require(path.join(process.cwd(), 'package.json')).name || 'node-service';
    return serviceName;
  } catch {
    return 'node-service';
  }
}

const init = ({
  serviceName,
  collectorEndpoint = 'http://otel-service.internal:4318'
} = {}) => {
  try {
    const runtime = detectRuntime();
    const svcName = process.env.OTEL_SERVICE_NAME || getServiceName(serviceName);

    if (runtime === 'ecs' || runtime === 'local') {
      // Set OTEL environment variables before requiring auto-instrumentation
      process.env.OTEL_SERVICE_NAME = svcName;
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = collectorEndpoint;
      process.env.OTEL_TRACES_SAMPLER = 'parentbased_traceidratio';
      process.env.OTEL_TRACES_SAMPLER_ARG = '1.0'; // Always sample 100%
      // Enable debug logging for troubleshooting
      process.env.OTEL_LOG_LEVEL = 'info';
      // Pre-load ADOT auto-instrumentation
      require('@aws/aws-distro-opentelemetry-node-autoinstrumentation/register');
      
      console.log(`[OTEL] Initialized (${runtime}) for service: ${svcName}`);
      console.log(`[OTEL] Exporting traces to: ${collectorEndpoint}`);
    }
  } catch (err) {
    console.error('[OTEL] Initialization failed:', err);
  }
};

module.exports = { init };

