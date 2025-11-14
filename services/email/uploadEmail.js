const { BlobServiceClient } = require("@azure/storage-blob");
const { getFilesById, getSignedUrl } = require("../../utils/helpers");
const { queryDB } = require("../../database/helper");
const { generateResponseFromEmbeddings } = require("../../utils/pinecone");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || "";
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || "";

const blobServiceClient =
  BlobServiceClient.fromConnectionString(connectionString);

module.exports = async (req, res, sql) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }

  try {
    const { id } = req.params;
    const query = `SELECT RawEmailContent, AIResponse FROM ProcessedEmails WHERE Id = ${id};`;
    const emailContent = await sql.query(query);
    if (!emailContent || emailContent.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Email not found",
      });
    }

    const rawEmailContent = emailContent.recordset?.[0]?.RawEmailContent;
    const oldAIResponse = emailContent.recordset?.[0]?.AIResponse;

    const file = req.file;
    const containerClient = blobServiceClient.getContainerClient(containerName);

    await containerClient.createIfNotExists();

    const blobName = `${id}-${Date.now()}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.upload(file.buffer, file.buffer.length, {
      blobHTTPHeaders: {
        blobContentType: file.mimetype,
      },
    });

    

    const fileUrl = blockBlobClient.url;
    const files = await getFilesById(id);
    let fileUrls = [];
    let responseFiles = [];
    for (const file of files) {
      const signedUrl = await getSignedUrl(file.name);
      fileUrls.push(signedUrl);
      responseFiles.push({
        ...file,
        url: signedUrl,
      });
    }

    const unescapedContent = JSON.parse(rawEmailContent);
    const contentJSON =
      typeof unescapedContent === "string"
        ? JSON.parse(unescapedContent)
        : unescapedContent;

    const response = await generateResponseFromEmbeddings({
      fileUrls,
      emailContent: contentJSON?.body || "",
    });

    if (response?.success) {
      const updateQuery = `UPDATE ProcessedEmails SET AIRESPONSE = @airesponse WHERE Id = @id;`;
      await queryDB(updateQuery, sql, {
        airesponse: response?.data,
        id,
      });
    }
    res.status(200).json({
      message: "File uploaded successfully",
      fileUrl: fileUrl,
      files: responseFiles,
      aiResponse: response?.success ? response?.data : oldAIResponse,
      success: true,
    });
  } catch (error) {
    console.error("Error uploading file to Azure:", error);
    res.status(500).json({ message: "Error uploading file.", success: false });
  }
};
