const { BlobServiceClient } = require("@azure/storage-blob");
const { queryDB } = require("../../database/helper");
const { storeFileInPinecone } = require("../../utils/pinecone");
const { v4: uuidv4 } = require("uuid");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || "";
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || "";

const blobServiceClient =
  BlobServiceClient.fromConnectionString(connectionString);

async function handleFaqUpload(req, res, sql) {
  try {
    const file = req.file;
    const { country, type } = req.body;

    let { id } = req.body;

    if (!file) {
      return res.status(400).send("No file uploaded.");
    }

    const { originalname, size, mimetype, buffer } = file;
    id = uuidv4().replace(/-/g, "");

    // Embedding and storing in Pinecone
    const { fileKey, totalChunks } = await storeFileInPinecone(
      buffer,
      originalname
    );

    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();

    // Upload file to Azure Blob Storage
    const blockBlobClient = containerClient.getBlockBlobClient(id);
    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: {
        blobContentType: mimetype,
      },
    });

    const query = `INSERT INTO Documents (id, fileName, fileSize, PineconeKey, uploaded_at, country, totalChunks, type) VALUES (@id, @fileName, @fileSize, @PineconeKey, @uploaded_at, @country, @totalChunks, @type)`;
    const params = {
      id,
      fileName: originalname,
      fileSize: size,
      PineconeKey: fileKey,
      totalChunks,
      uploaded_at: new Date(),
      country: country || "NL",
      type,
    };
    await queryDB(query, sql, params);

    const fileResult = await queryDB(
      `SELECT * FROM Documents WHERE id = @id;`,
      sql,
      { id }
    );

    return res.status(200).json({
      success: true,
      message: "FAQ file uploaded and record created successfully.",
      file: fileResult[0],
    });
  } catch (error) {
    console.error("Error handling FAQ upload:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

module.exports = async (req, res, sql) => {
  console.log("Upload document request received", req.file, req.body);

  const { type } = req.body;

  try {
    if (type === "faq") {
      await handleFaqUpload(req, res, sql);
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid document type.",
      });
    }
  } catch (error) {
    console.error("Error processing file upload:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
