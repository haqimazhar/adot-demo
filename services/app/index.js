// Initialize OpenTelemetry BEFORE any other requires
const { init } = require('./otel-init');
init({
  serviceName: 'adot-demo-app',
  collectorEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-service.internal:4318'
});

const express = require('express');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { trace } = require('@opentelemetry/api');

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 80;

const region = process.env.AWS_REGION || 'ap-southeast-1';
const tableName = process.env.TABLE_NAME || 'Users';
const queueUrl = process.env.QUEUE_URL;

const sqs = new SQSClient({ region });
const ddb = new DynamoDBClient({ region });

app.use(express.json());

app.get('/', (_req, res) => {
  res.status(200).send('Application is up and running!');
});

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.get('/hello', (_req, res) => {
  res.status(200).send('Hello from ADOT demo!');
});

app.get('/user/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Add custom span attributes for filtering/searching traces
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes({
        'user.id': id,
        'operation': 'get_user',
        'http.route': '/user/:id'
      });
    }
    
    const cmd = new GetItemCommand({
      TableName: tableName,
      Key: { id: { S: id } }
    });
    const result = await ddb.send(cmd);
    
    // Add user name to span if found
    if (span && result.Item?.name?.S) {
      span.setAttributes({
        'user.name': result.Item.name.S,
        'user.found': true
      });
    } else if (span) {
      span.setAttribute('user.found', false);
    }
    
    console.log('[GET /user/:id] Success:', JSON.stringify({ id, result: result.Item || null }));
    res.status(200).json(result.Item ? result : { message: 'User not found' });
  } catch (err) {
    console.error('[GET /user/:id] Error:', err);
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes({
        'error': true,
        'error.message': err.message
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/user', async (req, res) => {
  try {
    if (!queueUrl) {
      return res.status(500).json({ error: 'QUEUE_URL not configured' });
    }
    const { name, age, metadata = {} } = req.body || {};
    if (!name || typeof age === 'undefined') {
      return res.status(400).json({ message: 'name and age are required' });
    }
    const user = {
      id: `user_${Date.now()}`,
      name,
      age,
      metadata
    };
    
    // Add custom span attributes for filtering/searching traces
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes({
        'user.name': user.name,
        'user.id': user.id,
        'user.age': user.age,
        'user.role': metadata?.role ?? 'unknown',
        'operation': 'create_user',
        'http.route': '/user'
      });
    }
    
    const send = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(user)
    });
    await sqs.send(send);
    console.log('[POST /user] Success:', JSON.stringify(user));
    res.status(202).json({ message: 'User queued for creation', id: user.id });
  } catch (err) {
    console.error('[POST /user] Error:', err);
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttributes({
        'error': true,
        'error.message': err.message
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`App listening on http://localhost:${port}`);
});


