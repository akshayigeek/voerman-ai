const { queryDB } = require("../../database/helper");

module.exports = async (req, res, sql) => {
  const { page = 0, limit = 10, type } = req.query;

  const offset = page * limit;
  const query = `SELECT * FROM Documents WHERE type=@type ORDER BY Id DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;`;
  const countQuery = `SELECT COUNT(*) FROM Documents;`;

  const result = await queryDB(query, sql, { type });
  const totalCount = await queryDB(countQuery, sql);

  res.status(200).json({
    success: true,
    message: "OK",
    data: result,
    totalCount: totalCount[0][""],
  });
};
