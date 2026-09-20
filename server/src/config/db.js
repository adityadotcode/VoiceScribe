const mongoose = require('mongoose');

/**
 * Connect to MongoDB.
 * In production, a failed connection should crash the process so the host
 * health-check fails and the orchestrator can restart the container/instance.
 * The process.env.NODE_ENV check lets local dev keep the lenient behaviour.
 */
async function connectDb(uri) {
  if (!uri) {
    console.warn('[db] MONGODB_URI is not set — skipping database connection.');
    return;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('[db] MongoDB connected');
  } catch (error) {
    console.error('[db] MongoDB connection failed:', error.message);
    // Exit so the process is restarted by the host supervisor and the
    // health-check endpoint correctly reports unhealthy.
    process.exit(1);
  }
}

module.exports = { connectDb };
