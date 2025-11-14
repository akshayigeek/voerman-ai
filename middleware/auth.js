const { auth } = require("express-oauth2-jwt-bearer");
require("dotenv").config();

const checkToken = auth({
  issuerBaseURL: `https://${process.env.DOMAIN}`,
  audience: `https://${process.env.DOMAIN}/api/v2/`,
});

module.exports = { checkToken };
