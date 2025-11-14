const login = require("../services/auth/login");

module.exports = (router, sql) => {
  router.post("/login", (req, res) => login(req, res, sql));

  return router;
};
