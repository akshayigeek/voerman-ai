const fs = require("fs");
const dfd = require("danfojs-node");
const XLSX = require("xlsx");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const { RATES_MODEL_PATH, extractCountryISO } = require("../utils/helpers");
const { getCoordinates } = require("../utils/googleMapsApi");
const { queryDB } = require("../database/helper");
const connactDB = require("../database/connect");

// ---------------- DOWNLOAD + READ EXCEL ----------------

async function loadExcelFromAzure(url) {
  console.log(`📥 Fetching Excel from Azure: ${url}`);
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  console.log(`📥 Downloaded ${buffer.byteLength} bytes`);

  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.SheetNames[0];
  console.log(`📄 Parsing sheet: ${sheet}`);
  const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheet]);
  console.log(`📄 Loaded ${json.length} rows`);
  return new dfd.DataFrame(json);
}

async function loadAllData(FILE_URLS) {
  const dfs = [];
  for (const url of FILE_URLS) {
    const df = await loadExcelFromAzure(url);
    dfs.push(df);
  }
  const combined = dfd.concat({ dfList: dfs });
  console.log(`📊 Combined dataframe shape: [${combined.shape}]`);
  return combined;
}

// ---------------- TRAIN (CACHE) PORT LOCATIONS ----------------
// async function trainPorts(fileUrls = []) {
//   console.log("🧠 Starting model training...");
//   let df = await loadAllData(fileUrls);

//   const selectedCols = [
//     "origin_location",
//     "destination_location",
//     "cost_base_rate_amount",
//   ];

//   df = df.loc({ columns: selectedCols });
//   console.log(`📊 Selected columns: ${selectedCols.join(", ")}`);

//   // Fill missing values
//   df = df.fillNa({
//     values: {
//       cost_base_rate_amount: 0,
//       origin_location: "UNKNOWN",
//       destination_location: "UNKNOWN",
//     },
//   });
//   console.log("✅ Missing values filled");

//   // ---------------- SAVE COST DATA ----------------
//   const rateRecords = df.values.map((row) => ({
//     origin: row[0],
//     destination: row[1],
//     cost: parseFloat(row[2]) || 0,
//   }));

//   fs.writeFileSync(RATES_MODEL_PATH, JSON.stringify(rateRecords, null, 2));
//   console.log(
//     `💾 Saved ${rateRecords.length} rate records to ${RATES_MODEL_PATH}`
//   );

//   // ---------------- EXTRACT UNIQUE PORTS ----------------
//   const uniqueOrigins = [...new Set(rateRecords.map((r) => r.origin))];
//   const uniqueDestinations = [
//     ...new Set(rateRecords.map((r) => r.destination)),
//   ];

//   console.log(
//     `🧭 Found ${uniqueOrigins.length} unique origins and ${uniqueDestinations.length} destinations`
//   );

//   const origin_location = [];
//   const destination_location = [];

//   // Fetch coordinates for each unique port
//   for (const origin of uniqueOrigins) {
//     const coords = await getCoordinates(origin);
//     if (coords) {
//       origin_location.push({
//         port_name: origin,
//         lat: coords.lat,
//         lng: coords.lng,
//       });
//     }
//     await sleep(300); // small delay to avoid API rate limit
//   }

//   for (const destination of uniqueDestinations) {
//     const coords = await getCoordinates(destination);
//     if (coords) {
//       destination_location.push({
//         port_name: destination,
//         lat: coords.lat,
//         lng: coords.lng,
//       });
//     }
//     await sleep(300);
//   }

//   // ---------------- SAVE PORT DATA ----------------
//   const portData = { origin_location, destination_location };

//   fs.writeFileSync(PORT_MODEL_PATH, JSON.stringify(portData, null, 2));
//   console.log(`🗺️ Saved port metadata to ${PORT_MODEL_PATH}`);
// }

// ---------------- SCHEMA ----------------
// const RatesLocationSchema = new mongoose.Schema({
//   location: { type: String, required: true },
//   country: { type: String, required: true },
//   latitude: Number,
//   longitude: Number,
//   rateType: { type: String, enum: ["freight", "domestic"], default: "freight" },
// });

// const RatesLocation = mongoose.model("RatesLocation", RatesLocationSchema);

// ---------------- TRAIN FUNCTION ----------------
async function trainPorts(fileUrls = [], rateType = "freight") {
  const sql = await connactDB(); // ensure DB connection is ready

  console.log("🧠 Starting model training...");

  // Load and prepare dataset
  let df = await loadAllData(fileUrls);

  // Store data into json file for rate lookup
  const rateRecords = df.values.map((row) => ({
    origin: row[df.columns.indexOf("origin_location")],
    destination: row[df.columns.indexOf("destination_location")],
    cost: parseFloat(row[df.columns.indexOf("cost_base_rate_amount")]) || 0,
    equipment_type: row[df.columns.indexOf("equipment_type")] || "20ft dry",
  }));

  fs.writeFileSync(RATES_MODEL_PATH, JSON.stringify(rateRecords, null, 2));
  console.log(
    `💾 Saved ${rateRecords.length} rate records to ${RATES_MODEL_PATH}`
  );

  // Store data into RatesLocation table
  const selectedCols = ["origin_location", "destination_location"];
  df = df.loc({ columns: selectedCols });

  console.log(`📊 Selected columns: ${selectedCols.join(", ")}`);

  df = df.fillNa({
    values: { origin_location: "UNKNOWN", destination_location: "UNKNOWN" },
  });

  // Collect unique port names
  const allPorts = new Set([
    ...df["origin_location"].values,
    ...df["destination_location"].values,
  ]);
  console.log(`🧭 Found ${allPorts.size} unique port locations`);

  let insertedCount = 0;
  let skippedCount = 0;

  for (const port of allPorts) {
    if (!port || port === "UNKNOWN") continue;

    // ✅ Check if this port already exists in DB
    const checkQuery = `
      SELECT COUNT(*) AS count 
      FROM RatesLocation 
      WHERE location = @location AND rateType = @rateType;
    `;
    const checkParams = { location: port, rateType };
    const checkResult = await queryDB(checkQuery, sql, checkParams);

    if (checkResult?.[0]?.count > 0) {
      console.log(`⚠️ Skipping ${port} — already exists`);
      skippedCount++;
      continue;
    }

    const coords = await getCoordinates(port);
    if (!coords) {
      console.warn(`⚠️ Skipping ${port} — coordinates not found`);
      continue;
    }

    const country = extractCountryISO(port) || "UNK";

    const insertQuery = `
      INSERT INTO RatesLocation (location, country, latitude, longitude, rateType)
      VALUES (@location, @country, @latitude, @longitude, @rateType);
    `;

    const params = {
      location: port,
      country,
      latitude: coords.lat,
      longitude: coords.lng,
      rateType,
    };

    try {
      await queryDB(insertQuery, sql, params);
      insertedCount++;
      console.log(`✅ Saved: ${port} (${country})`);
    } catch (err) {
      console.error(`❌ Failed to insert ${port}:`, err.message);
    }

    await sleep(300); // Avoid API rate limits
  }

  // Summary
  const queryget = `SELECT COUNT(*) AS count FROM RatesLocation WHERE rateType = @rateType`;
  const paramsget = { rateType };
  const result = await queryDB(queryget, sql, paramsget);
  const totalCount = result?.[0]?.count || 0;

  console.log("💾 Training complete.");
  console.log(`➕ Inserted: ${insertedCount}`);
  console.log(`⚠️ Skipped (duplicates): ${skippedCount}`);
  console.log(`📦 Total in DB: ${totalCount}`);
}

// ---------------- UTILS ----------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Utility: Haversine distance (in kilometers)
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371; // Earth's radius in km

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// --- Main: find nearest town
async function findNearestTownFromCoords(towns, source) {
  let nearestTown = null;
  let minDistance = Infinity;

  for (const town of towns) {
    // Ensure numbers (since you have them as strings)
    const lat = parseFloat(town.latitude);
    const lng = parseFloat(town.longitude);

    const distToSource = haversine(lat, lng, source.lat, source.lng);

    if (distToSource < minDistance) {
      minDistance = distToSource;
      nearestTown = {
        name: town.location,
        country: town.country,
        latitude: lat,
        longitude: lng,
        rateType: town.rateType,
        nearestTo: "SOURCE",
        distance: minDistance,
      };
    }
  }

  return nearestTown;
}

async function getCostFromModel(input, sql) {
  console.log("--- input portCacheModel.js [Line-no 289] ---", input);
  if (!fs.existsSync(RATES_MODEL_PATH)) {
    throw new Error(`Rates model not found at: ${RATES_MODEL_PATH}`);
  }

  const rates = JSON.parse(fs.readFileSync(RATES_MODEL_PATH, "utf-8"));

  const {
    origin_location,
    destination_location,
    source_country_iso,
    destination_country_iso,
    equipment_type
  } = input;

  const sourceLocationResult = await queryDB(
    "SELECT * FROM RatesLocation WHERE country = @country",
    sql,
    { country: source_country_iso }
  );

  const sourceNearest = await findNearestTownFromCoords(
    sourceLocationResult,
    origin_location
  );

  const destinationLocationResult = await queryDB(
    "SELECT * FROM RatesLocation WHERE country = @country",
    sql,
    { country: destination_country_iso }
  );

  const destinationNearest = await findNearestTownFromCoords(
    destinationLocationResult,
    destination_location
  );

  // Try to find exact match (case-insensitive)
  const match = rates.find(
    (r) =>
      r.origin.toLowerCase().trim() ===
        sourceNearest.name.toLowerCase().trim() &&
      r.destination.toLowerCase().trim() ===
        destinationNearest.name.toLowerCase().trim() &&
      r.equipment_type === equipment_type
  );

  if (match) {
    console.log(`✅ Found cost : ${match.cost}`);
    return { cost_rate: parseFloat(match.cost.toFixed(2)), currency: "EUR" };
  }

  console.warn(`⚠️ No exact match found `);
  return null;
}

module.exports = {
  trainPorts,
  getCostFromModel,
};
