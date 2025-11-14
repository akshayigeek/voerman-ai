const puppeteer = require("puppeteer");
const { BlobServiceClient } = require("@azure/storage-blob");
const { queryDB } = require("../../database/helper");
const { generateTemplate } = require("../../utils/transport-template");
const { PDFDocument } = require("pdf-lib");
const { getSignedUrl } = require("../../utils/helpers");

let browser;
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || "";
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || "";

const blobServiceClient =
  BlobServiceClient.fromConnectionString(connectionString);

module.exports = async (req, res, sql) => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: "id is required",
      });
    }

    const query = `SELECT * FROM ProcessedEmails WHERE Id = @id`;
    const result = await queryDB(query, sql, { id });

    if (!result || result.length <= 0) {
      res.status(400).json({
        success: false,
        message: "No such email found with that id",
      });
    }

    const resultJSON = result?.[0];

    const {
      EmailContactName,
      EmailAddress,
      EmailCompany,
      IsVerified,
      TransportType,
      Category,
      Volume,
      VolumeUNIT,
      RegionType,
      SourceType,
      DSPServices,
      Origin,
      Destination,
      CostPrice,
      Margin,
    } = resultJSON;

    const org = Origin ? JSON.parse(Origin) : {};
    const dest = Destination ? JSON.parse(Destination) : {};

    const org_add = org.raw_input
      ? org.raw_input
      : org.address
      ? org.address
      : "";

    const org_country = `${org.country ?? ""} ${
      org?.country_iso ? `(${org?.country_iso})` : ""
    }`;

    const dest_add = dest.raw_input
      ? dest.raw_input
      : dest.address
      ? dest.address
      : "";

    const dest_country = `${dest.country ?? ""} ${
      dest?.country_iso ? `(${dest?.country_iso})` : ""
    }`;

    const org_address = `${org_add} <br/> ${org_country}`;
    const dest_address = `${dest_add} <br/> ${dest_country}`;
    const price = (CostPrice || 0) + ((CostPrice || 0) * Margin) / 100;

    const cp = `€ ${(CostPrice || 0)?.toFixed(2)}`;
    const margin = `${Margin || 0} %`;
    const sp = `€ ${(price || 0)?.toFixed(2)}`;

    const payload = {
      EmailContactName,
      EmailAddress,
      EmailCompany,
      IsVerified: IsVerified
        ? `<span class="badge">Verified</span>`
        : `<span class="badge unverified">Unverified</span>`,
      TransportType,
      Category,
      Volume: `${Volume} ${VolumeUNIT}`,
      RegionType,
      SourceType,
      DSPServices,
      Origin: org_address,
      Destination: dest_address,
      CostPrice: cp,
      Margin: margin,
      SellingPrice: sp,
    };

    const pdfTemplate = generateTemplate({ data: payload });

    // 🧠 Use Puppeteer to generate both PDFs and merge
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();

    await page.setContent(pdfTemplate, {
      waitUntil: "domcontentloaded",
      timeout: 0,
    });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

    const blobName = `quote-${id}.pdf`;

    const containerClient = blobServiceClient.getContainerClient(containerName);
    await containerClient.createIfNotExists();
    // Upload file to Azure Blob Storage
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Delete existing blob if exists
    await blockBlobClient.deleteIfExists();
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const compressedPdfBuffer = await pdfDoc.save({
      useObjectStreams: true, // enables object streams
      compress: true, // compress content streams
    });

    await blockBlobClient.upload(
      compressedPdfBuffer,
      compressedPdfBuffer.length,
      {
        blobHTTPHeaders: { blobContentType: "application/pdf" },
      }
    );

    const blobUrl = await getSignedUrl(blobName);

    let attachments = [];
    try {
      attachments = JSON.parse(resultJSON.Attachments || "[]");
      if (!Array.isArray(attachments)) attachments = [];
    } catch (err) {
      console.error("Invalid Attachments JSON:", err);
      attachments = [];
    }

    if (!attachments.some((item) => (item.name = blobName))) {
      attachments.push({
        name: blobName,
        originalName: blobName,
        size: compressedPdfBuffer.length,
        type: "application/pdf",
      });
    }

    const updateQuery = `Update ProcessedEmails SET Attachments=@Attachments WHERE Id=@id`;
    await queryDB(updateQuery, sql, {
      Attachments: JSON.stringify(attachments),
      id,
    });

    res.status(200).json({
      success: true,
      message: "Generated PDF successfully",
      data: blobUrl,
      attachments: attachments,
    });
  } catch (error) {
    console.log("error ====", error);
    res.status(500).json({
      success: false,
      message: "Internal Server error",
      error: error 
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
