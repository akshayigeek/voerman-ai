const multer = require("multer");
const { checkToken } = require("../middleware/auth");
const getAllDocument = require("../services/sources/getAllDocument");
const uploadDocument = require("../services/sources/uploadDocument");
const deleteDocument = require("../services/sources/deleteDocument");
const downloadDocument = require("../services/sources/downloadDocument");
const getPresignedUrl = require("../services/sources/getPresignedUrl");
const { queryDB } = require("../database/helper");
const { getSignedUrl } = require("../utils/helpers");

const uploadRatesDoc = require("../services/sources/uploadRatesDoc");
const { trainModel } = require("../ml-models/parthModel");
const updateSourceDocument = require("../services/sources/updateSourceDocument");

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
}); // 50MB limit

module.exports = (router, sql) => {
  router.get("/all-documents", checkToken, (req, res) =>
    getAllDocument(req, res, sql)
  );

  router.get("/get-presigned-url", checkToken, (req, res) =>
    getPresignedUrl(req, res, sql)
  );

  router.get("/train-models", checkToken, async (req, res) => {
    const rateQuery = `SELECT * FROM Documents WHERE type = 'rates' and ratesDocType = 'freight-rates'`;
    const fileResult = await queryDB(rateQuery, sql);

    if (fileResult.length) {
      const fileUrls = await Promise.all(
        fileResult?.map(async (file) => {
          return await getSignedUrl(file.id);
        })
      );

      console.log("File URLs to process:", fileUrls); // Debug log
      await trainModel(fileUrls);
    }
  });

  router.post(
    "/upload-document",
    checkToken,
    upload.single("file"),
    (req, res) => uploadDocument(req, res, sql)
  );

  router.post("/upload-rates-doc", checkToken, (req, res) =>
    uploadRatesDoc(req, res, sql)
  );

  router.delete("/delete-document", checkToken, (req, res) =>
    deleteDocument(req, res, sql)
  );

  router.get("/download-document", checkToken, (req, res) =>
    downloadDocument(req, res, sql)
  );

  router.put("/:id", checkToken, (req, res) =>
    updateSourceDocument(req, res, sql)
  );

  return router;
};
