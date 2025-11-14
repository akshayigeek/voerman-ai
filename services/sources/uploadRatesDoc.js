const { Worker } = require("worker_threads");
const { queryDB } = require("../../database/helper");
const { getSignedUrl } = require("../../utils/helpers");
const path = require("path");

async function handleRatesUpload(req, res, sql) {
  const workerPath = path.resolve(
    __dirname,
    "../../utils/trainModelsWorker.js"
  );
  const { type, ratesDocType, id } = req.body;

  const fileQuery = `SELECT * FROM Documents WHERE type = @type AND ratesDocType = @ratesDocType;`;
  const fileResult = await queryDB(fileQuery, sql, { type, ratesDocType });

  console.log("Files fetched for processing:", fileResult);

  if (fileResult.length) {
    const fileUrls = await Promise.all(
      fileResult.map((file) => getSignedUrl(file.id))
    );

    const worker = new Worker(workerPath, {
      workerData: {
        fileUrls: fileUrls,
        ratesDocType,
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

  const [file] = await queryDB(`SELECT * FROM Documents WHERE id = @id;`, sql, {
    id,
  });

  return res.status(200).json({
    success: true,
    file: file || null,
    message:
      "Rates files processed successfully. Training started in background.",
  });
}

module.exports = async (req, res, sql) => {
  console.log("Upload Rates document request received", req.body);
  try {
    if (req.body.type === "rates" || req.body.type === "default-attachments") {
      await handleRatesUpload(req, res, sql);
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Invalid document type." });
    }
  } catch (error) {
    console.error("Error processing file upload:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
