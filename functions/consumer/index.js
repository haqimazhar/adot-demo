const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const region = process.env.AWS_REGION || 'ap-southeast-1';
const tableName = process.env.TABLE_NAME || 'Users';
const bucketName = process.env.S3_BUCKET;

const ddb = new DynamoDBClient({ region });
const s3 = new S3Client({ region });

function toCsvLine(user) {
  const role = user?.metadata?.role ?? '';
  const esc = (v) => String(v).replace(/"/g, '""');
  return `id,name,age,role\n"${esc(user.id)}","${esc(user.name)}","${esc(user.age)}","${esc(role)}"\n`;
}

exports.handler = async (event) => {
  const errors = [];
  const processed = [];
  
  for (const record of event.Records) {
    try {
      const user = JSON.parse(record.body);
      
      console.log(`[Lambda] Processing user: ${user.id}`);
      
      // Write to DynamoDB
      const put = new PutItemCommand({
        TableName: tableName,
        Item: {
          id: { S: user.id },
          name: { S: user.name },
          age: { N: user.age.toString() },
          metadata: { M: { role: { S: user?.metadata?.role ?? '' } } }
        }
      });
      await ddb.send(put);
      console.log(`[Lambda] DynamoDB write success: ${user.id}`);

      // Write to S3
      if (bucketName) {
        const csv = toCsvLine(user);
        const key = `users/${user.id}.csv`;
        const putObj = new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: csv,
          ContentType: 'text/csv'
        });
        await s3.send(putObj);
        console.log(`[Lambda] S3 write success: ${key}`);
      }
      
      console.log(`[Lambda] Successfully processed user: ${user.id}`);
      processed.push(user.id);
    } catch (err) {
      console.error(`[Lambda] ❌ ERROR processing record ${record.messageId}:`, err);
      errors.push({
        messageId: record.messageId,
        error: err.message,
        stack: err.stack
      });
    }
  }
  
  // If ANY record failed, throw error to fail the Lambda
  // This makes errors visible in AppSignals/CloudWatch
  // SQS will retry the ENTIRE batch
  if (errors.length > 0) {
    console.error(`[Lambda] ❌ BATCH FAILED - ${errors.length} of ${event.Records.length} records failed`);
    console.error('[Lambda] Failed records:', JSON.stringify(errors, null, 2));
    throw new Error(`Batch processing failed: ${errors.length} records failed. First error: ${errors[0].error}`);
  }
  
  console.log(`[Lambda] ✅ SUCCESS - All ${processed.length} records processed`);
  return {
    statusCode: 200,
    body: JSON.stringify({ processed: processed.length })
  };
};


