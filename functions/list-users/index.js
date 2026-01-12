const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

const region = process.env.AWS_REGION || 'ap-southeast-1';
const tableName = process.env.TABLE_NAME || 'Users';

const ddb = new DynamoDBClient({ region });

exports.handler = async (event) => {
  try {
    console.log('Fetching all users from DynamoDB');
    
    const command = new ScanCommand({
      TableName: tableName,
      ProjectionExpression: 'id, #n',
      ExpressionAttributeNames: {
        '#n': 'name'
      }
    });
    
    const result = await ddb.send(command);
    
    // Transform DynamoDB format to simple objects
    const users = result.Items.map(item => ({
      id: item.id.S,
      name: item.name.S
    }));
    
    console.log(`Found ${users.length} users`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        count: users.length,
        users: users
      })
    };
  } catch (error) {
    console.error('Error fetching users:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        message: 'Internal server error',
        error: error.message 
      })
    };
  }
};

