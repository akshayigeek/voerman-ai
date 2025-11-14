const { queryDB } = require("../../database/helper");
const { generateUploadUrl } = require("../../utils/helpers");
const { v4: uuidv4 } = require("uuid");

module.exports = async (req, res, sql) => {
  const { fileName, fileSize, country, ratesDocType, type } = req.query;
  let id = uuidv4();
  id = id.replace(/-/g, "");
  const query = `INSERT INTO Documents (id, fileName, fileSize, uploaded_at, country, type, ratesDocType) VALUES (@id, @fileName, @fileSize, @uploaded_at, @country, @type, @ratesDocType)`;
  const params = {
    id,
    fileName: fileName,
    fileSize: fileSize,
    uploaded_at: new Date(),
    country: country || "NL",
    type,
    ratesDocType: ratesDocType,
  };
  await queryDB(query, sql, params);

  if (!fileName) {
    return res
      .status(400)
      .json({ success: false, message: "File name is required" });
  }

  try {
    const presignedUrl = await generateUploadUrl(id);
    return res.status(200).json({
      success: true,
      message: "Presigned URL generated successfully",
      presignedUrl,
      fileId: id,
    });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
