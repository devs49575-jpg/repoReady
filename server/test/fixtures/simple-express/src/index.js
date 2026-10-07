const express = require('express');
const { connect } = require('./db');

const app = express();
const secret = process.env.SECRET;
if (process.env.NODE_ENV !== 'production') console.log('dev mode');

app.get('/', (_req, res) => res.send(secret ? 'ok' : 'no secret'));
connect().then(() => app.listen(3000));
