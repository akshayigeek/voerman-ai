const { queryDB } = require("../../database/helper");
const { getSignedUrl } = require("../../utils/helpers");

module.exports = async (req, res, sql) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res
        .status(400)
        .send({ success: false, message: "Document ID is required" });
    }

    const query = `SELECT * FROM Documents WHERE id = @id`;
    const result = await queryDB(query, sql, { id });

    if (result.length === 0) {
      return res
        .status(404)
        .send({ success: false, message: "Document not found" });
    }
    const fileUrl = await getSignedUrl(result[0].id);

    res.status(200).json({
      success: true,
      message: "OK",
      fileUrl,
    });
  } catch (error) {
    console.log("Error fetching documents:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
