const crypto = require('crypto');
const path = require('path');
const { DeleteObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
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

  console.log(`[S3] audio uploaded: ${objectKey}`);

  return objectKey;
}

/**
 * Delete a single audio object from S3 after the full pipeline has succeeded.
 *
 * Rules:
 *   - Only called after BOTH transcription AND Bedrock extraction succeed.
 *   - If deletion itself fails, the error is logged but never thrown —
 *     the completed clinical workflow is never disrupted.
 *   - Never called when Transcribe fails.
 *   - Never called when Bedrock fails.
 *   - Never called on Save Draft alone.
 *
 * @param {string} objectKey  S3 key to delete (e.g. "consultations/abc.webm")
 */
async function deleteAudioObject(objectKey) {
  if (!objectKey) {
    console.warn('[S3] deleteAudioObject called with empty key — skipping');
    return;
  }

  if (!s3BucketName) {
    console.warn('[S3] audio deletion skipped: S3 bucket is not configured');
    return;
  }

  console.log(`[S3] audio deletion requested: ${objectKey}`);

  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: s3BucketName,
        Key:    objectKey,
      })
    );
    console.log(`[S3] audio deleted: ${objectKey}`);
  } catch (err) {
    console.error(`[S3] audio deletion failed: ${objectKey} —`, err.message);
  }
}

module.exports = { uploadAudio, deleteAudioObject };
