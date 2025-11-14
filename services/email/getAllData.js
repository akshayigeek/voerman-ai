const { queryDB } = require("../../database/helper");

module.exports = async (req, res, sql) => {
  const {
    page = 0,
    limit = 10,
    category = null,
    verified = null,
    transportType = null,
    priority = null,
    startDate,
    endDate,
    search = null,
    sortKey = "date",
    sortOrder = "DESC",
    type = "all",
  } = req.query;

  const sortMap = {
    date: "EmailTimestamp",
    email: "EmailAddress",
    category: "Category",
    company: "EmailCompany",
    volume: "Volume",
    priority: "Priority",
  };

  let conditions = [];
  // conditions.push(`RegionType = 'domestic'`);
  const statusCountConditions = [];

  if (type && type !== "all") {
    if (type === "new") {
      conditions.push(`IsVerified = 0`);
    } else if (type === "completed") {
      conditions.push(`IsVerified = 1`);
      conditions.push(`isCompleted = 1`);
    }
  }

  if (category) {
    conditions.push(`Category = '${category}'`);
  }
  if (verified) {
    conditions.push(`IsVerified = '${verified == "false" ? 0 : 1}'`);
  }
  if (transportType) {
    conditions.push(`TransportType = '${transportType}'`);
  }
  if (priority) {
    conditions.push(`Priority = '${priority == "Normal" ? 0 : 1}'`);
  }

  // Date range filter
  if (startDate && endDate) {
    conditions.push(
      `EmailTimestamp >= '${startDate}' AND EmailTimestamp <= '${endDate} 23:59:59'`
    );
    statusCountConditions.push(
      `EmailTimestamp >= '${startDate}' AND EmailTimestamp <= '${endDate} 23:59:59'`
    );
  }

  // Add search functionality
  if (search) {
    const searchTerm = search.replace(/'/g, "''"); // Escape single quotes for SQL safety
    const searchFields = [
      "EmailAddress",
      "ResultJSON",
      "EmailCompany",
      "Origin",
      "Destination",
    ];

    const searchConditions = searchFields
      .map((field) => `CAST(${field} AS NVARCHAR(MAX)) LIKE '%${searchTerm}%'`)
      .join(" OR ");

    conditions.push(`(${searchConditions})`);
  }

  let whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const query = `SELECT Id, EmailTimestamp, EmailAddress, Category, EmailCompany, TransportType, Volume, VolumeUNIT, ResultJSON, Origin, Destination, IsVerified, IsCompleted FROM ProcessedEmails ${whereClause} ORDER BY ${
    sortMap[sortKey]
  } ${sortOrder} OFFSET ${page * limit} ROWS FETCH NEXT ${limit} ROWS ONLY;`;

  const countQuery = `SELECT COUNT(*) FROM ProcessedEmails ${whereClause};`;

  const result = await queryDB(query, sql);

  const countResult = await queryDB(countQuery, sql);

  let statusWhereClause = statusCountConditions.length
    ? `WHERE ${statusCountConditions.join(" AND ")}`
    : "";
  const statusCountQuery = `
    SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN IsVerified = 0 THEN 1 ELSE 0 END) AS new,
      SUM(CASE WHEN IsVerified = 1 AND IsCompleted = 1 THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN IsVerified = 1 AND (IsCompleted IS NULL OR IsCompleted = 0) THEN 1 ELSE 0 END) AS ongoing
    FROM ProcessedEmails
    ${statusWhereClause};
  `;

  const statusCountsResult = await queryDB(statusCountQuery, sql);
  const statusCounts = statusCountsResult[0];

  res.status(200).json({
    success: true,
    message: "OK",
    data: result,
    totalCount: countResult[0][""],
    statusCounts: {
      total: statusCounts.total,
      new: statusCounts.new,
      ongoing: statusCounts.ongoing,
      completed: statusCounts.completed,
    },
  });
};
