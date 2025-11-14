const { queryDB } = require("../../database/helper");
const {
  getFilesById,
  getSignedUrl,
  safeParseJSON,
} = require("../../utils/helpers");
const { generateResponseFromEmbeddings } = require("../../utils/pinecone");

module.exports = async (req, res, sql) => {
  try {
    const { id, suggestion = "" } = req.body;

    if (!id) {
      res.status(404).json({
        success: false,
        message: "id not found",
      });
    }

    const query = `SELECT * FROM ProcessedEmails WHERE Id=@id;`;

    const result = await queryDB(query, sql, { id });

    if (!result || result.length == 0) {
      res.status(404).json({
        success: false,
        message: "Email not found",
      });
    }

    const files = await getFilesById(id);

    let fileUrls = [];
    for (const file of files) {
      const signedUrl = await getSignedUrl(file.name);
      fileUrls.push(signedUrl);
    }

    // ✅ Extract email content from DB
    const emailData = result[0];
    let rawEmailContent = emailData.RawEmailContent;
    let parsedEmailContent;

    let resultJSON = emailData.ResultJSON;
    let parsedJSON = safeParseJSON(resultJSON);

    try {
      const unescapedContent = JSON.parse(rawEmailContent);
      parsedEmailContent =
        typeof unescapedContent === "string"
          ? JSON.parse(unescapedContent)
          : unescapedContent;
    } catch (err) {
      parsedEmailContent = {};
    }

    // ✅ Call AI
    const aiResponse = await generateResponseFromEmbeddings({
      fileUrls,
      emailContent: parsedEmailContent?.body || "",
      suggestion,
    });

    if (aiResponse?.success) {
      parsedJSON.ai_response = aiResponse.data; // embed AI output inside ResultJSON

      const updateQuery = `UPDATE ProcessedEmails SET ResultJSON=@resultJSON, AIRESPONSE=@aiResponse WHERE Id=@id;`;
      await queryDB(updateQuery, sql, {
        resultJSON: JSON.stringify(JSON.stringify(parsedJSON)),
        aiResponse: aiResponse.data,
        id,
      });
    } else {
      console.log("AI processing failed, keeping old AIResponse");
    }

    let attachments = [];
    try {
      attachments = JSON.parse(emailData.Attachments || "[]");
      if (!Array.isArray(attachments)) attachments = [];
    } catch (err) {
      console.error("Invalid attachments JSON:", err);
      attachments = [];
    }

    const dspServices = emailData.DSPServices || "";
    const shouldAddAttachments = dspServices.includes("customs_documents_requested");
    if (shouldAddAttachments) {
      const originData = JSON.parse(emailData.Origin || "{}");
      const destinationData = JSON.parse(emailData.Destination || "{}");
      const originCountryISO = originData.country_iso || null;
      const destinationCountryISO = destinationData.country_iso || null;
      const page = 0;
      const limit = 100;
      const offset = page * limit;
      const type = "default-attachments";
      let docQuery = `SELECT * FROM Documents WHERE type=@type`;

      if (originCountryISO || destinationCountryISO) {
        docQuery += " AND (";

        const conditions = [];
        if (originCountryISO)
          conditions.push(`country LIKE '%' + @originCountryISO + '%'`);
        if (destinationCountryISO)
          conditions.push(`country LIKE '%' + @destinationCountryISO + '%'`);

        docQuery += conditions.join(" OR ") + ")";
      }

      docQuery += ` ORDER BY Id DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;`;

      // ✅ Run query
      const docResult = await queryDB(docQuery, sql, {
        type,
        originCountryISO,
        destinationCountryISO,
      });

      // Create a Set of existing file names for fast lookup
      const existingNames = new Set(attachments.map((a) => a.name));

      docResult.forEach((element) => {
        // Skip if a file with the same name already exists
        if (existingNames.has(element.fileName)) return;

        attachments.push({
          name: element.fileName,
          originalName: element.fileName,
          size: element.fileSize ? Number(element.fileSize) : 0,
          type: element.type || "default-attachments",
        });

        // Add to the Set to prevent duplicates if multiple same names exist in docResult
        existingNames.add(element.fileName);
      });

      // ✅ Update DB with merged attachments
      const updateAttachmentsQuery = `UPDATE ProcessedEmails SET Attachments=@attachments WHERE Id=@id`;

      await queryDB(updateAttachmentsQuery, sql, {
        attachments: JSON.stringify(attachments),
        id,
      });
    }

    res.status(200).json({
      success: true,
      data: aiResponse.data || parsedJSON.ai_response,
      attachments: attachments,
    });
  } catch (error) {
    console.log("error", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
