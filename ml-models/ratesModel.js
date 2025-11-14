const {
  RandomForestRegression: RFRegression,
  RandomForestClassifier,
} = require("ml-random-forest");
const fs = require("fs");
const { MODEL_PATH } = require("../utils/helpers");

// ---------------- HELPERS ----------------
function encodeRateType(type) {
  if (!type) return -1;
  const val = type.toString().toUpperCase();
  if (val === "FLAT") return 0;
  if (val === "VARIABEL") return 1;
  return -1;
}

function encodeType(type) {
  if (!type) return -1;
  const val = type.toString().toUpperCase();
  if (val === "DESTINATION") return 0;
  if (val === "ORIGIN") return 1;
  return -1;
}

function encodeOperation(operation, operations) {
  const idx = operations.findIndex(
    (op) => op.name.toLowerCase() === operation.toLowerCase()
  );
  return idx === -1 ? -1 : idx;
}

// ---------------- TRAIN MODELS (Actually Cache Excel) ----------------
async function trainModels(rows, headers, fileIds = []) {
  console.log("⏳ Caching Excel data for exact lookup...");

  const idxDistanceStart = headers.indexOf("Distance start");
  const idxDistanceEnd = headers.indexOf("Distance end");
  const idxMinValue = headers.indexOf("Min. Value");
  const idxMaxValue = headers.indexOf("Max. Value");
  const idxRateType = headers.indexOf("Rate type");
  const idxType = headers.indexOf("Type");
  const idxOperation = headers.indexOf("Operation");
  const idxFlatRate = headers.indexOf("Flat rate in EUR");
  const idxFlexRate = headers.indexOf("Flexibel( rate per cbm)");

  const structuredData = rows.map((r) => ({
    operation: r[idxOperation]?.trim(),
    type: r[idxType]?.trim(),
    distanceStart: Number(r[idxDistanceStart]) || 0,
    distanceEnd: Number(r[idxDistanceEnd]) || 0,
    minValue: Number(r[idxMinValue]) || 0,
    maxValue: Number(r[idxMaxValue]) || 0,
    rateType: r[idxRateType]?.trim()?.toUpperCase() || "",
    flatRate: Number(r[idxFlatRate]) || 0,
    flexRate: Number(r[idxFlexRate]) || 0,
  }));

  // Save structured data (not ML)
  fs.writeFileSync(
    MODEL_PATH,
    JSON.stringify({ rates: structuredData }, null, 2)
  );
  console.log("✅ Excel data cached at:", MODEL_PATH);
  return structuredData;
}

// ---------------- LOAD CACHED MODEL ----------------
function loadModels() {
  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error("No cached data found. Train first.");
  }
  const data = JSON.parse(fs.readFileSync(MODEL_PATH, "utf-8"));
  return data.rates;
}

// ---------------- PREDICT EXACT VALUE ----------------
async function predictRate(distance, volume, type, operation) {
  const data = loadModels();

  const match = data.find((r) => {
    return (
      r.operation.toLowerCase() === operation.toLowerCase() &&
      r.type.toLowerCase() === type.toLowerCase() &&
      distance >= r.distanceStart &&
      distance <= r.distanceEnd &&
      volume >= r.minValue &&
      volume <= r.maxValue
    );
  });

  if (!match) {
    console.warn("⚠️ No matching range found for given inputs.");
    return { rateType: "UNKNOWN", rate: 0 };
  }

  if (match.rateType === "FLAT") {
    return { rateType: "FLAT", rate: match.flatRate };
  } else if (match.rateType === "VARIABEL") {
    const rate = match.flexRate * volume;
    return { rateType: "VARIABEL", ratePerCbm: match.flexRate, rate };
  }

  return { rateType: "UNKNOWN", rate: 0 };
}

module.exports = {
  trainModels,
  loadModels,
  predictRate,
};
