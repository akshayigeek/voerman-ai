// /services/email/uploadAttachments.js
const { queryDB } = require("../../database/helper");
const { uploadBlob } = require("../../utils/helpers");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");

// Allowed MIME types
const allowedTypes = [
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/bmp",
  "application/zip",
  "application/x-rar-compressed",
];

// Compress files: PDFs and images
async function compressFile(file) {
  if (file.mimetype === "application/pdf") {
    const pdfDoc = await PDFDocument.load(file.buffer);
    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    return Buffer.from(pdfBytes);
  } else if (file.mimetype.startsWith("image/")) {
    return await sharp(file.buffer)
      .jpeg({ quality: 70 }) // adjust compression quality here
      .toBuffer();
  } else {
    return file.buffer; // leave other file types as-is
  }
}

module.exports = async function uploadAttachments(req, res, sql) {
  const { id } = req.params;

  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: "Email id is required" });
  }
  console.log("req.files", req.files);

  if (!req.files || req.files.length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "No files uploaded" });
  }

  try {
    // Fetch existing email record
    const query = `SELECT * FROM ProcessedEmails WHERE Id=@id`;
    const result = await queryDB(query, sql, { id });

    if (!result || result.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No email found with this id" });
    }

    let attachments = [];
    try {
      attachments = JSON.parse(result[0].Attachments || "[]");
      if (!Array.isArray(attachments)) attachments = [];
    } catch (err) {
      console.error("Invalid attachments JSON:", err);
      attachments = [];
    }

    // Process each uploaded file
    for (const file of req.files) {
      if (!allowedTypes.includes(file.mimetype)) continue; // skip invalid types

      const compressedBuffer = await compressFile(file);
      const fileName = `${Date.now()}-${file.originalname}`;

      // Upload to Azure Blob Storage
      await uploadBlob(fileName, compressedBuffer, file.mimetype);

      // Save attachment info
      attachments.push({
        name: fileName,
        originalName: file.originalname,
        size: compressedBuffer.length, // store compressed size
        type: file.mimetype,
      });
    }

    // Update DB
    const updateQuery = `UPDATE ProcessedEmails SET Attachments=@attachments WHERE Id=@id`;
    await queryDB(updateQuery, sql, {
      attachments: JSON.stringify(attachments),
      id,
    });

    return res.status(200).json({
      success: true,
      message: "Attachments uploaded successfully",
      attachments,
    });
  } catch (err) {
    console.error("Error uploading attachments:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
