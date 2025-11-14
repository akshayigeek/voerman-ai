const sgMail = require("@sendgrid/mail");
const MailComposer = require("nodemailer/lib/mail-composer");
const fs = require("fs");
const path = require("path");
const { BlobServiceClient } = require("@azure/storage-blob");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
const blobServiceClient =
  BlobServiceClient.fromConnectionString(connectionString);

function textToHtml(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.trim().replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

async function sendEmailViaSendGrid({
  to,
  cc,
  subject,
  body,
  attachments,
  leadId,
  replyToMessageId,
}) {
  try {
    let fileName = null;
    let emlUrl = null;

    const htmlContent = textToHtml(body);

    const headers = {};
    if (replyToMessageId) {
      headers["In-Reply-To"] = replyToMessageId;
      headers["References"] = replyToMessageId;
    }

    // ✅ Correct SendGrid-compatible attachments
    const mailOptions = {
      from: process.env.SENDGRID_FROM_EMAIL,
      to,
      cc,
      subject,
      html: htmlContent,
      headers,
      attachments: attachments?.map((att) => ({
        content: att.base64,
        filename: att.name,
        type: att.type || "application/octet-stream",
        disposition: "attachment",
      })),
    };

    // 1️⃣ Generate raw EML
    const mail = new MailComposer(mailOptions);
    const rawEmail = await new Promise((resolve, reject) => {
      mail.compile().build((err, message) => {
        if (err) return reject(err);
        resolve(message);
      });
    });

    console.log(rawEmail, "rawEmail");

    // 2️⃣ Save temporarily
    const emlDir = path.join(__dirname, "emails");
    if (!fs.existsSync(emlDir)) {
      fs.mkdirSync(emlDir, { recursive: true });
    }

    fileName = `${leadId}-${Date.now()}.eml`;
    const filePath = path.join(emlDir, fileName);
    fs.writeFileSync(filePath, rawEmail);

    // 3️⃣ Upload to Azure
    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    await blockBlobClient.uploadData(rawEmail, {
      blobHTTPHeaders: { blobContentType: "message/rfc822" },
    });

    emlUrl = blockBlobClient.url;

    // 4️⃣ Delete local copy
    fs.unlinkSync(filePath);

    // 5️⃣ Send via SendGrid
    await sgMail.send({
      from: process.env.SENDGRID_FROM_EMAIL,
      to,
      cc,
      subject,
      html: htmlContent,
      attachments: mailOptions.attachments, // ✅ same array
      headers,
    });

    console.log("✅ Reply sent in same thread & EML uploaded to Azure");
    const fileSize = Buffer.byteLength(rawEmail);

    return { success: true, fileName, emlUrl, size: fileSize };
  } catch (error) {
    console.error("❌ Error sending reply:", error);
    return { success: false, error: error.message };
  }
}

module.exports = sendEmailViaSendGrid;
