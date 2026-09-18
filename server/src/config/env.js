const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  port: process.env.PORT || 5000,
  mongodbUri: process.env.MONGODB_URI || '',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5174',
  awsRegion: process.env.AWS_REGION || 'ap-south-1',
  s3BucketName: process.env.S3_BUCKET_NAME || '',
  maxAudioFileBytes: Number(process.env.MAX_AUDIO_FILE_BYTES) || 25 * 1024 * 1024,
};
