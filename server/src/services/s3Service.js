const crypto = require('crypto');
const path = require('path');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { awsRegion, s3BucketName } = require('../config/env');

const s3Client = new S3Client({ region: awsRegion });

const MIME_EXTENSIONS = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

function getExtension(file) {
  const fromName = path.extname(file.originalname || '').replace('.', '').toLowerCase();

  if (fromName && fromName.length <= 5) {
    return fromName;
  }

  const mime = (file.mimetype || '').split(';')[0].trim();
  return MIME_EXTENSIONS[mime] || 'webm';
}

function createObjectKey(file) {
  const randomId = crypto.randomBytes(6).toString('hex');
  return `consultations/${Date.now()}-${randomId}.${getExtension(file)}`;
}

async function uploadAudio(file) {
  if (!s3BucketName) {
    throw new Error('S3 bucket is not configured');
  }

  const objectKey = createObjectKey(file);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3BucketName,
      Key: objectKey,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  return objectKey;
}

module.exports = { uploadAudio };
