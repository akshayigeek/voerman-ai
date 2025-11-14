const multer = require("multer");
const { checkToken } = require("../middleware/auth");
const getAllData = require("../services/email/getAllData");
const getEmailData = require("../services/email/getEmailData");
const updateEmailData = require("../services/email/updateEmailData");
const uploadEmail = require("../services/email/uploadEmail");
const { deleteBlob } = require("../utils/helpers");
const sendEmail = require("../services/email/sendEmail");
const proxyEmail = require("../services/email/proxyEmail");
const regenerateResponse = require("../services/email/regenerateResponse");
const generatePrice = require("../services/email/generatePrice");
const generatePDFEstimate = require("../services/email/generatePDFEstimate");
const downloadAndDeleteAttachment = require("../services/email/downloadAndDeleteAttachment");
const uploadingAttachment = require("../services/email/uploadingAttachment");
const getPriceFromLoaction = require("../services/email/getPriceFromLoaction");
const { verifyHeaders } = require("../middleware/headers");

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

module.exports = (router, sql) => {
  router.get("/all-emails", checkToken, (req, res) =>
    getAllData(req, res, sql)
  );

  router.get("/proxy-email", async (req, res) => proxyEmail(req, res, sql));

  router.get("/:id", checkToken, (req, res) => getEmailData(req, res, sql));
  router.put("/:id", checkToken, (req, res) => updateEmailData(req, res, sql));
  router.post("/upload/:id", checkToken, upload.single("emails"), (req, res) =>
    uploadEmail(req, res, sql)
  );

  router.delete("/:fileName", checkToken, async (req, res) => {
    const { fileName } = req.params;
    await deleteBlob(fileName);
    return res.status(200).json({
      success: true,
      message: "File deleted successfully",
    });
  });

  router.post("/send-email/:id", checkToken, async (req, res) => {
    sendEmail(req, res, sql);
  });

  router.get("/generate-price/:id", checkToken, async (req, res) => {
    await generatePrice(req, res, sql);
  });

  router.get("/generate-pdf/:id", checkToken, async (req, res) => {
    await generatePDFEstimate(req, res, sql);
  });

  router.post("/regerate-response", checkToken, async (req, res) =>
    regenerateResponse(req, res, sql)
  );

  router.post("/attachment-update", checkToken, async (req, res) => {
    downloadAndDeleteAttachment(req, res, sql);
  });
  router.post("/get-price-location", verifyHeaders, async (req, res) => {
    getPriceFromLoaction(req, res, sql);
  });

  router.post(
    "/upload-attachments/:id",
    checkToken,
    upload.array("file"),
    (req, res) => uploadingAttachment(req, res, sql)
  );

  return router;
};
