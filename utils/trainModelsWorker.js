const { parentPort, workerData } = require("worker_threads");
const { trainModels } = require("../ml-models/ratesModel");
const { parseExcelFile } = require("./customFileParser");
const { trainPorts } = require("../ml-models/portCacheModel");
require("dotenv").config();
const CHUNK_SIZE = 5000;

(async () => {
  try {
    const { fileUrls, ratesDocType, fileIds } = workerData;
    console.log("Worker data received");

    if (ratesDocType === "general-rates") {
      // Fetch and parse all files
      let headers = null;
      let allData = [];

      for (const url of fileUrls) {
        console.log("Processing file URL:", url);

        let { headers: fileHeaders, rows } = await parseExcelFile(url);

        if (!rows?.length) {
          console.log(`Invalid or empty Excel file: ${url}`);
          continue;
        }

        if (!headers) headers = fileHeaders;

        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
          const chunk = rows.slice(i, i + CHUNK_SIZE);
          allData.push(...chunk);

          if (i === 0) {
            allData = allData.slice(1);
          }
        }
      }

      if (allData.length > 0 && headers) {
        console.log("If Training started in background...");
        await trainModels(allData, headers, null, fileIds);
      } else {
        console.log("No valid data found for training.");
      }
      console.log("Total rows collected:", allData.length, headers);
    } else {
      if (fileUrls.length > 0) {
        console.log("Else Training started in background...");
        await trainPorts(fileUrls);
      } else {
        console.log("No valid data found for training.");
      }
    }
    console.log("Training finished successfully");
    parentPort.postMessage({ success: true });
  } catch (err) {
    console.error("Worker error:", err);
    parentPort.postMessage({ success: false, error: err.message });
  }
})();
