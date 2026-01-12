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
  const results = [];
  for (const record of event.Records) {
    try {
      const user = JSON.parse(record.body);
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
      }
      results.push({ messageId: record.messageId, status: 'ok' });
    } catch (err) {
      console.error('Record failed:', record.messageId, err);
      results.push({ messageId: record.messageId, status: 'failed', error: err.message });
    }
  }
  return { statusCode: 200, results };
};


