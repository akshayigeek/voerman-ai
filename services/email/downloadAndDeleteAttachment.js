const { queryDB } = require("../../database/helper");
const { deleteBlob, getSignedUrl } = require("../../utils/helpers");

module.exports = async (req, res, sql) => {
  try {
    const { id, attachment, isDelete } = req.body;

    if (!id || !attachment || typeof isDelete === "undefined") {
      return res.status(400).json({
        success: false,
        message: "id, attachment, and isDelete are required",
      });
    }

    const query = `SELECT * FROM ProcessedEmails WHERE Id=@id`;
    const result = await queryDB(query, sql, { id });

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No such email found by the id",
      });
    }

    const resultJSON = result[0];

    let attachments = [];

    try {
      attachments = JSON.parse(resultJSON.Attachments || "[]");
      if (!Array.isArray(attachments)) attachments = [];
    } catch (err) {
      console.error("Invalid Attachments JSON:", err);
      attachments = [];
    }

    if (!attachments.some((item) => item.name === attachment)) {
      return res.status(400).json({
        success: false,
        message: "No such attachment found",
      });
    }

    if (isDelete === true) {
      // Delete from Azure blob
      await deleteBlob(attachment);

      // Remove attachment from array and update DB
      const updatedAttachments = attachments.filter(
        (item) => item.name !== attachment
      );
      const updateQuery = `
       UPDATE ProcessedEmails SET Attachments = @attachments WHERE Id = @id
      `;
      await queryDB(updateQuery, sql, {
        attachments: JSON.stringify(updatedAttachments),
        id,
      });

      return res.status(200).json({
        success: true,
        message: "Deleted attachment successfully",
        attachments: updatedAttachments,
      });
    } else {
      // ✅ use different variable name to avoid shadowing Express res
      const signedUrl = await getSignedUrl(attachment);

      return res.status(200).json({
        success: true,
        message: "Downloaded attachment successfully",
        data: signedUrl,
      });
    }
  } catch (error) {
    console.error("Error in delete-download-attachment:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
