// Load environment configuration first (will exit if required vars are missing).
const { port, mongodbUri, awsRegion, s3BucketName } = require('./config/env');
const { connectDb } = require('./config/db');
const app = require('./app');
const dns = require('dns');

// Use public DNS resolvers.
// This was required to reach MongoDB Atlas from certain network environments.
dns.setServers(['8.8.8.8', '1.1.1.1']);

async function start() {
  // Connect to MongoDB before accepting traffic so the first request does not
  // arrive before the DB is ready.  connectDb() exits the process on failure.
  await connectDb(mongodbUri);

  const server = app.listen(port, () => {
    console.log(`[server] VoiceScribe API listening on port ${port}`);
    console.log(`[server] AWS region : ${awsRegion}`);
    console.log(`[server] S3 bucket  : ${s3BucketName}`);
    console.log(`[server] CORS origin: ${process.env.CLIENT_ORIGIN || 'http://localhost:5174'}`);
  });

  // Graceful shutdown — allow in-flight requests to finish, then exit cleanly.
  // This is important for containers (ECS, App Runner) where SIGTERM is sent
  // before the instance is removed from the load-balancer target group.
  function shutdown(signal) {
    console.log(`[server] ${signal} received — shutting down gracefully`);
    server.close(() => {
      console.log('[server] HTTP server closed');
      process.exit(0);
    });

    // Force-exit if the server has not closed after 10 s.
    setTimeout(() => {
      console.error('[server] Forced exit after 10 s shutdown timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[server] Startup error:', err.message);
  process.exit(1);
});
