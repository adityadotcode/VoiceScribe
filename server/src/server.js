const app = require('./app');
const { port, mongodbUri } = require('./config/env');
const { connectDb } = require('./config/db');
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

app.listen(port, () => {
  console.log(`VoiceScribe server listening on port ${port}`);
});

connectDb(mongodbUri);
