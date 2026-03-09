require('dotenv').config();
const app = require('./app');

const port = process.env.UPSTREAM_PORT || 3000;
const failRate = process.env.UPSTREAM_FAIL_RATE || 0.2;

const server = app.listen(port, () => {
  console.log(`Mock upstream service listening on port ${port}`);
  console.log(`Simulating failures with ${(failRate * 100).toFixed(1)}% rate`);
});

module.exports = server;
