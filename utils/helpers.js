require("dotenv").config();
const {
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  BlobServiceClient,
  StorageSharedKeyCredential,
} = require("@azure/storage-blob");
const { simpleParser } = require("mailparser");
const { default: axios } = require("axios");
const { extractEmlContent } = require("./customFileParser");
const { getCoordinates } = require("./googleMapsApi");

const AZURE_STORAGE_CONNECTION_STRING =
  process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || "";

if (!AZURE_STORAGE_CONNECTION_STRING) {
  throw new Error(
    "AZURE_STORAGE_CONNECTION_STRING environment variable is not set."
  );
}

const blobServiceClient = BlobServiceClient.fromConnectionString(
  AZURE_STORAGE_CONNECTION_STRING
);
const containerClient = blobServiceClient.getContainerClient(containerName);

const regex = /AccountName=([^;]+);AccountKey=([^;]+);/;
const match = AZURE_STORAGE_CONNECTION_STRING.match(regex);
const accountName = match[1];
const accountKey = match[2];

const sharedKeyCredential = new StorageSharedKeyCredential(
  accountName,
  accountKey
);

async function getSignedUrl(blobName) {
  const blobClient = containerClient.getBlobClient(blobName);
  const sharedKeyCredential = blobClient.credential;

  if (!sharedKeyCredential) {
    throw new Error(
      "Could not retrieve shared key credential from the connection string."
    );
  }

  const sasOptions = {
    blobName: blobClient.name,
    containerName: blobClient.containerName,
    permissions: BlobSASPermissions.parse("r"),
    expiresOn: new Date(new Date().valueOf() + 120 * 60 * 1000),
  };

  const sasToken = generateBlobSASQueryParameters(
    sasOptions,
    sharedKeyCredential
  ).toString();

  const signedUrl = `${blobClient.url}?${sasToken}`;

  return signedUrl;
}

async function getFilesById(id) {
  const searchPrefix = `${id}-`;

  const files = [];

  for await (const blob of containerClient.listBlobsFlat({
    prefix: searchPrefix,
  })) {
    const blobClient = await containerClient.getBlobClient(blob.name);
    const properties = await blobClient.getProperties();

    files.push({
      name: blob.name,
      url: blobClient.url,
      size: properties.contentLength,
      uploadedAt: properties.lastModified.toISOString(),
    });
  }

  return files;
}

async function deleteBlob(blobName) {
  try {
    const blobClient = containerClient.getBlobClient(blobName);

    // The deleteIfExists method is safe and returns true if a blob was deleted.
    const response = await blobClient.deleteIfExists();

    if (response) {
      console.log(`Blob '${blobName}' was successfully deleted.`);
    } else {
      console.log(`Blob '${blobName}' was not found, nothing to delete.`);
    }

    return response;
  } catch (error) {
    console.error(
      `An error occurred while deleting blob '${blobName}':`,
      error
    );
    return false;
  }
}

async function uploadBlob(blobName, buffer, mimeType) {
  try {
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Upload buffer
    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: {
        blobContentType: mimeType,
      },
    });
    return blobName; // you can return blob URL if needed
  } catch (err) {
    console.error("Error uploading to Azure Blob:", err);
    throw err;
  }
}

async function extractEmlText(buffer) {
  const parsed = await simpleParser(buffer);
  return {
    subject: parsed.subject || "",
    from: parsed.from?.text || "",
    to: parsed.to?.text || "",
    date: parsed.date || "",
    text: parsed.text || parsed.html || "",
  };
}

const generateUploadUrl = async (fileName) => {
  const containerClient = blobServiceClient.getContainerClient(containerName);

  const blobClient = containerClient.getBlockBlobClient(fileName);

  const ONE_HOUR = 60;
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: fileName,
      permissions: BlobSASPermissions.parse("cwr"), // create, write, read
      startsOn: new Date(),
      expiresOn: new Date(new Date().valueOf() + ONE_HOUR * 60 * 1000),
    },
    sharedKeyCredential
  ).toString();

  return `${blobClient.url}?${sasToken}`;
};

async function getAllFilesContent(fileUrls) {
  try {
    const downloadPromises = fileUrls.map((url, index) =>
      axios
        .get(url, { responseType: "text" })
        .then((response) => ({ index, content: response.data }))
        .catch((error) => {
          console.error(
            `Error downloading file from URL ${url}:`,
            error.message
          );
          return {
            success: false,
            data: null,
          };
        })
    );

    const downloadedFiles = await Promise.all(downloadPromises);
    const validFiles = downloadedFiles.filter((file) => file !== null);

    if (validFiles.length === 0) {
      console.log("No files were successfully downloaded. Exiting.");
    }

    let combinedContent = "";
    for (const file of validFiles) {
      const content = await extractEmlContent(file.content);
      combinedContent += `--- Email #${file.index + 1} ---\n\n${content}\n\n`;
    }

    return combinedContent;
  } catch (error) {
    console.error("Error in getAllFilesContent:", error);
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

async function findNearestTown(towns, source) {
  let nearestTown = null;
  let minDistance = Infinity;

  for (const town of towns) {
    const locationData = await getCoordinates(town);
    if (!locationData) continue;

    console.log("locationData", locationData);

    const distToSource = await haversine(
      locationData.lat,
      locationData.lng,
      source.lat,
      source.lng
    );

    if (distToSource < minDistance) {
      minDistance = distToSource;
      nearestTown = {
        name: town,
        nearestTo: "SOURCE",
        distance: minDistance,
      };
    }
  }

  return nearestTown;
}

function safeParseJSON(resultJSON) {
  try {
    let parsedJSON =
      typeof resultJSON === "string" ? JSON.parse(resultJSON) : resultJSON;

    if (typeof parsedJSON === "string") {
      parsedJSON = JSON.parse(parsedJSON);
    }
    if (
      !parsedJSON ||
      typeof parsedJSON !== "object" ||
      Array.isArray(parsedJSON)
    ) {
      throw new Error("ResultJSON is not a valid object");
    } else {
      return parsedJSON;
    }
  } catch (error) {
    throw new Error("ResultJSON is not a valid object");
  }
}

function convertToCubicMeters(volume, unit) {
  if (volume == null) return 0;
  if (!unit) return 0;

  const u = unit.toLowerCase().trim();
  const conversions = {
    // Metric
    m3: 1,
    "m³": 1,
    cm3: 1e-6,
    "cm³": 1e-6,
    mm3: 1e-9,
    "mm³": 1e-9,
    l: 0.001,
    liter: 0.001,
    litre: 0.001,
    ml: 0.000001,

    // Imperial / US customary
    ft3: 0.0283168,
    "ft³": 0.0283168,
    in3: 0.0000163871,
    "in³": 0.0000163871,
    yd3: 0.764555,
    "yd³": 0.764555,
    gal: 0.00378541, // US gallon
    "us gal": 0.00378541,
    "imp gal": 0.00454609, // UK imperial gallon
  };

  const factor = conversions[u];
  if (!factor) return volume;

  return volume * factor;
}

function convertUnit(value, fromUnit, toUnit) {
  if (!fromUnit) {
    return value;
  }
  value = parseFloat(value);
  const R = {
    M3_TO_LBS: 230,
    LBS_TO_M3: 0.00434782608,
    M3_TO_KG: 100,
    KG_TO_M3: 0.01,
    FT3_TO_LBS: 6.5,
    LBS_TO_FT3: 0.1535,
    M3_TO_FT3: 35.315,
    FT3_TO_M3: 1 / 35.315,
  };

  if (fromUnit === toUnit) return value;

  // Convert everything via a base (m3)
  let valueInM3;

  switch (fromUnit) {
    case "m3":
      valueInM3 = value;
      break;
    case "kg":
      valueInM3 = value * R.KG_TO_M3;
      break;
    case "lbs":
      valueInM3 = value * R.LBS_TO_M3;
      break;
    case "ft3":
      valueInM3 = value * R.FT3_TO_M3;
      break;
    default:
      throw new Error("Unknown fromUnit");
  }

  // Now convert from m3 to target unit
  switch (toUnit) {
    case "m3":
      return valueInM3;
    case "kg":
      return valueInM3 * R.M3_TO_KG;
    case "lbs":
      return valueInM3 * R.M3_TO_LBS;
    case "ft3":
      return valueInM3 * R.M3_TO_FT3;
    default:
      throw new Error("Unknown toUnit");
  }
}

function extractCountryISO(locationStr = "") {
  // Example input: "Rotterdam, ZH, NL" → returns "NL"
  const parts = locationStr.split(",").map((p) => p.trim());
  const iso = parts[parts.length - 1];
  if (iso && iso.length === 2) return iso.toUpperCase();
  return "UNK"; // Unknown
}

const OSA_MODEL_PATH = "./train-models/osa_linear_model";
const MODEL_PATH = "./train-models/model.json";
const PORT_MODEL_PATH = "./train-models/portsCache.json"; // new port cache file
const RATES_MODEL_PATH = "./train-models/ratesCache.json"; // new rates cache file

module.exports = {
  getSignedUrl,
  getFilesById,
  deleteBlob,
  uploadBlob,
  extractEmlText,
  getAllFilesContent,
  OSA_MODEL_PATH,
  MODEL_PATH,
  PORT_MODEL_PATH,
  RATES_MODEL_PATH,
  generateUploadUrl,
  haversine,
  findNearestTown,
  safeParseJSON,
  convertToCubicMeters,
  convertUnit,
  extractCountryISO,
};
