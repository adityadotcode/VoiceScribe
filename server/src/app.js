const express = require('express');
const cors = require('cors');
const { clientOrigin } = require('./config/env');
const apiRoutes = require('./routes');

const app = express();

app.use(cors({ origin: clientOrigin }));
app.use(express.json());
app.use('/api', apiRoutes);

module.exports = app;
