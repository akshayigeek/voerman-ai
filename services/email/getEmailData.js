const { queryDB } = require("../../database/helper");
const { getFilesById, getSignedUrl } = require("../../utils/helpers");

module.exports = async (req, res, sql) => {
  const { id } = req.params;

  const files = await getFilesById(id);

  let fileUrls = [];
  for (const file of files) {
    const signedUrl = await getSignedUrl(file.name);
    fileUrls.push({
      ...file,
      url: signedUrl,
    });
  }

  const query = `SELECT * FROM ProcessedEmails WHERE Id = ${id};`;

  const result = await queryDB(query, sql);

  if (!result || result.length === 0) {
    res.status(404).json({
      success: false,
      message: "Email not found",
    });
  }

  res.status(200).json({
    success: true,
    message: "OK",
    data: result?.[0],
    files: fileUrls,
  });
};
