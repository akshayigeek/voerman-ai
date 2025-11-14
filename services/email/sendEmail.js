const { default: axios } = require("axios");
const { queryDB } = require("../../database/helper");
const { getSignedUrl } = require("../../utils/helpers");
const sendEmailViaSendGrid = require("../../utils/sendEmailViaSendGrid");

module.exports = async (req, res, sql) => {
  try {
    const leadId = req.params.id;
    const { to, cc, subject, body, replyToMessageId } = req.body;

    // ✅ Validate required fields
    if (!leadId) {
      return res
        .status(400)
        .json({ success: false, message: "leadId is required" });
    }

    if (!to || !subject || !body) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    // ✅ Fetch lead data
    const lead = await queryDB(
      `SELECT * FROM ProcessedEmails WHERE Id = @id`,
      sql,
      { id: leadId }
    );

    if (!lead || lead.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No such lead found" });
    }

    const resultJSON = lead[0];

    // ✅ Parse attachments safely
    let attachments = [];
    try {
      const parsed = JSON.parse(resultJSON.Attachments || "[]");
      attachments = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error("Invalid Attachments JSON:", err);
    }

    // ✅ Generate signed URLs for attachments (if needed)
    const fileUrls = await Promise.all(
      attachments.map((it) => getSignedUrl(it.name))
    );

    const sgAttachments = await Promise.all(
      fileUrls.map(async (url, index) => {
        const name = attachments[index].name || `file-${index + 1}`;
        const response = await axios.get(url, { responseType: "arraybuffer" });
        const buffer = Buffer.from(response.data);
        return {
          name,
          url,
          base64: buffer.toString("base64"),
          type: "application/pdf", // or detect dynamically if needed
        };
      })
    );

    // ✅ Send email
    const result = await sendEmailViaSendGrid({
      to,
      cc,
      subject,
      body,
      leadId,
      replyToMessageId,
      attachments: sgAttachments, // optional if sendEmail uses it
    });

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    // ✅ Success response
    return res.json({
      success: true,
      message: "Email sent successfully",
      fileName: result.fileName,
      emlUrl: result.emlUrl, // Azure URL
      size: result.size,
    });
  } catch (error) {
    console.error("Error sending email:", error);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error" });
  }
};
