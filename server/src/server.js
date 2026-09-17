const app = require('./app');
const { port, mongodbUri } = require('./config/env');
const { connectDb } = require('./config/db');

app.listen(port, () => {
  console.log(`VoiceScribe server listening on port ${port}`);
});

connectDb(mongodbUri);
