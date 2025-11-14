const path = require("path");
const { queryDB } = require("../../database/helper");
const { parseExcelFile } = require("../../utils/customFileParser");
const { deleteBlob, getSignedUrl } = require("../../utils/helpers");
const { deleteFromPinecone } = require("../../utils/pinecone");
const { Worker } = require("worker_threads");

// Helper to parse Excel file

async function handleFaqDelete(doc) {
  // Delete from Pinecone
  if (doc.PineconeKey) {
    await deleteFromPinecone(doc.PineconeKey, doc.totalChunks);
  }
}

async function handleRatesDelete(doc, sql) {
  const workerPath = path.resolve(
    __dirname,
    "../../utils/trainModelsWorker.js"
  );

  const fileQuery = `SELECT * FROM Documents WHERE type = @type and ratesDocType = @ratesDocType and id != @id`;
  const fileResult = await queryDB(fileQuery, sql, {
    type: doc.type,
    ratesDocType: doc.ratesDocType,
    id: doc.id,
  });

  if (fileResult.length) {
    const fileUrls = await Promise.all(
      fileResult.map((file) => getSignedUrl(file.id))
    );

    const worker = new Worker(workerPath, {
      workerData: {
        fileUrls: fileUrls,
        ratesDocType: doc.ratesDocType,
        fileIds: fileResult.map((file) => file.id),
      },
    });

    worker.on("message", (message) => {
      console.log("Worker message:", message);
    });

    worker.on("error", (error) => {
      console.error("Worker error:", error);
    });
  }

  // if (fileResult.length) {
  //   const fileUrls = await Promise.all(
  //     fileResult.map((file) => getSignedUrl(file.id))
  //   );

  //   let headers = null;
  //   let allData = [];

  //   for (const url of fileUrls) {
  //     console.log("Processing file URL:", url);

  //     let { headers: fileHeaders, rows } = await parseExcelFile(url);

  //     if (!rows?.length) {
  //       console.log(`Invalid or empty Excel file: ${url}`);
  //       continue;
  //     }

  //     if (!headers) headers = fileHeaders;

  //     const CHUNK_SIZE = 5000;
  //     for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
  //       const chunk = rows.slice(i, i + CHUNK_SIZE);
  //       allData.push(...chunk);
  //     }
  //   }

  //   console.log("Total rows collected:", allData.length);

  //   if (allData.length > 0 && headers) {
  //     console.log("Training started in background...");

  //     const worker = new Worker(workerPath, {
  //       workerData: {
  //         allData: allData.slice(1),
  //         headers,
  //         ratesDocType: doc.ratesDocType,
  //         fileIds: fileResult.map((file) => file.id),
  //       },
  //     });

  //     worker.on("message", (msg) => {
  //       if (msg.success) console.log("Training finished successfully");
  //       else console.error("Training failed:", msg.error);
  //     });

  //     worker.on("error", (err) => console.error("Worker error:", err));
  //   }
  // }
}

module.exports = async (req, res, sql) => {
  try {
    const { id } = req.query;

    if (!id) {
      return res
        .status(400)
        .send({ success: false, message: "Document ID is required" });
    }

    // Fetch the document
    const query = `SELECT * FROM Documents WHERE id = @id`;
    const result = await queryDB(query, sql, { id });

    if (!result || result.length === 0) {
      return res
        .status(404)
        .send({ success: false, message: "Document not found" });
    }

    const doc = result[0];

    // Delete the associated blob from Azure Blob Storage
    await deleteBlob(doc.id);

    // Delete from DB
    await queryDB(`DELETE FROM Documents WHERE id = @id`, sql, { id });
    console.log("here");

    if (doc.type === "faq") {
      await handleFaqDelete(doc);
    } else {
      await handleRatesDelete(doc, sql);
    }

    console.log("Document deleted successfully:", id);

    return res.status(200).json({
      success: true,
      message: "Document deleted successfully",
      data: doc,
    });
  } catch (error) {
    console.log("Error deleting document:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
