// osamodel.js
const fs = require("fs");
const { RandomForestRegression: RFRegression } = require("ml-random-forest");
const { OSA_MODEL_PATH } = require("../utils/helpers");

// --------------------- GLOBAL CACHE --------------------- //
let cachedModels = null;
let cachedEncoders = null;

// --------------------- TRAIN MODEL --------------------- //
async function trainSeaRatesModel(rows, headers, fileIds = []) {
  console.log("⏳ [1/8] Loading dataset...");
  if (!rows.length) throw new Error("❌ Dataset is empty!");
  console.log(
    `✅ Loaded dataset with ${rows.length} rows and ${headers.length} columns.`
  );

  // --------------------- FEATURE SELECTION --------------------- //
  console.log("⏳ [2/8] Selecting features and target...");
  const originIdx = headers.indexOf("origin_location");
  const destIdx = headers.indexOf("destination_location");
  const equipIdx = headers.indexOf("equipment_type");
  const modeIdx = headers.indexOf("mode");
  const transitIdx = headers.indexOf("time_transit_duration");
  const sailingsIdx = headers.indexOf("number_of_sailings");
  const targetIdx = headers.indexOf("cost_base_rate_amount");

  if ([originIdx, destIdx, equipIdx, modeIdx, targetIdx].some((i) => i === -1))
    throw new Error("❌ Required columns missing in dataset!");

  const features = rows.map((r) => [
    r[originIdx], // origin
    r[destIdx], // destination
    r[equipIdx], // equipment type
    r[modeIdx], // transport mode
    Number(r[transitIdx]) || 0, // transit duration
    Number(r[sailingsIdx]) || 0, // number of sailings
  ]);

  const target = rows.map((r) => Number(r[targetIdx]) || 0);
  console.log("✅ Features and target selected.");

  // --------------------- ENCODING --------------------- //
  console.log("⏳ [3/8] Encoding categorical columns...");
  const makeLimitedMap = (values, max = 200) => {
    const freq = {};
    values.forEach((v) => (freq[v] = (freq[v] || 0) + 1));
    const top = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([v]) => v);
    const map = {};
    top.forEach((v, i) => (map[v] = i + 1));
    return map; // unseen => 0
  };

  const originMap = makeLimitedMap(features.map((f) => f[0]));
  const destMap = makeLimitedMap(features.map((f) => f[1]));
  const equipMap = makeLimitedMap(features.map((f) => f[2]));
  const modeMap = makeLimitedMap(features.map((f) => f[3]));

  const encoders = { originMap, destMap, equipMap, modeMap };

  const encode = (val, map) => (map[val] ? map[val] : 0);
  const encodedFeatures = features.map((f) => [
    encode(f[0], originMap),
    encode(f[1], destMap),
    encode(f[2], equipMap),
    encode(f[3], modeMap),
    f[4], // numeric: transit duration
    f[5], // numeric: number of sailings
  ]);
  console.log("✅ Categorical columns encoded.");

  // --------------------- SPLIT TRAIN/TEST --------------------- //
  console.log("⏳ [4/8] Splitting train/test...");
  const trainSize = Math.floor(0.8 * encodedFeatures.length);
  const X_train = encodedFeatures.slice(0, trainSize);
  const y_train = target.slice(0, trainSize);
  const X_test = encodedFeatures.slice(trainSize);
  const y_test = target.slice(trainSize);
  console.log(
    `   ✅ Train size: ${X_train.length}, Test size: ${X_test.length}`
  );

  // --------------------- TRAIN MODEL --------------------- //
  console.log("⏳ [5/8] Training Random Forest model in chunks...");
  const CHUNK_SIZE = 8000; // chunk size per sub-model
  const nChunks = Math.ceil(X_train.length / CHUNK_SIZE);
  const subModels = [];
  console.log("🌲 Model configuration:", {
    nEstimators: 50,
    maxDepth: 10,
    maxFeatures: encodedFeatures[0].length,
  });

  for (let i = 0; i < nChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min((i + 1) * CHUNK_SIZE, X_train.length);
    const X_chunk = X_train.slice(start, end);
    const y_chunk = y_train.slice(start, end);

    console.log(
      `🌲 Training chunk ${i + 1}/${nChunks} (${X_chunk.length} samples)...`
    );

    const rf = new RFRegression({
      nEstimators: 20,
      maxDepth: 10,
      maxFeatures: encodedFeatures[0].length,
    });
    console.time(`🌲 Chunk ${i + 1} Training Duration`);
    rf.train(X_chunk, y_chunk);
    console.timeEnd(`🌲 Chunk ${i + 1} Training Duration`);

    subModels.push(rf);
  }

  console.log("✅ All chunks trained. Total sub-models:", subModels.length);

  // --------------------- EVALUATE MODEL --------------------- //
  console.log("⏳ [6/8] Evaluating model...");
  const preds = X_test.map((x, idx) => {
    // average predictions from all sub-models
    const chunkPreds = subModels.map((m) => m.predict([x])[0]);
    return chunkPreds.reduce((a, b) => a + b, 0) / subModels.length;
  });

  const mse =
    preds.reduce((s, p, i) => s + Math.pow(p - y_test[i], 2), 0) / preds.length;
  const rmse = Math.sqrt(mse);
  const mae =
    preds.reduce((s, p, i) => s + Math.abs(p - y_test[i]), 0) / preds.length;
  const meanY = y_test.reduce((a, b) => a + b, 0) / y_test.length;
  const ssRes = preds.reduce((s, p, i) => s + Math.pow(p - y_test[i], 2), 0);
  const ssTot = y_test.reduce((s, y) => s + Math.pow(y - meanY, 2), 0);
  const r2 = 1 - ssRes / ssTot;

  console.log("\n📊 Model Evaluation:");
  console.log(`   RMSE : ${rmse.toFixed(2)}`);
  console.log(`   MAE  : ${mae.toFixed(2)}`);
  console.log(`   R²   : ${(r2 * 100).toFixed(2)}%`);

  // --------------------- SAVE MODEL --------------------- //
  console.log("⏳ [7/8] Saving models + encoders...");
  const payload = {
    models: subModels.map((m) => m.toJSON()), // save all sub-models
    encoders,
  };
  fs.writeFileSync(OSA_MODEL_PATH, JSON.stringify(payload, null, 2));
  console.log(`✅ Models + encoders saved to ${OSA_MODEL_PATH}`);

  cachedModels = subModels;
  cachedEncoders = encoders;

  console.log("✅ [8/8] Training process finished successfully.");
  return { rmse, mae, r2 };
}

// --------------------- LOAD / CACHE MODEL --------------------- //
function getTrainedModel() {
  if (!cachedModels || !cachedEncoders) {
    console.log("📦 Loading trained models + encoders from file...");

    console.log("OSA_MODEL_PATH", OSA_MODEL_PATH);

    const data = JSON.parse(fs.readFileSync(OSA_MODEL_PATH, "utf-8"));

    console.log("data", data);

    // FIX 1: Access the 'models' array from the data object
    const modelJSONs = data?.models;

    // FIX 2: Re-instantiate the RFRegression objects using .load()
    if (modelJSONs && Array.isArray(modelJSONs)) {
      // Use the imported RandomForestRegression class (RFRegression)
      cachedModels = modelJSONs.map((m) => RFRegression.load(m));
    } else {
      // Set to null if data is missing or invalid
      cachedModels = null;
    }

    cachedEncoders = data?.encoders;

    if (!cachedModels) {
      console.log("❌ Failed to load trained models from file.");
      // Throw error if models couldn't be loaded (new addition)
      throw new Error("❌ No trained models available for prediction.");
    }

    console.log(
      `✅ Models loaded and cached in memory. Total models: ${cachedModels.length}`
    );
  }
      return { models: cachedModels, encoders: cachedEncoders };
}
// --------------------- PREDICT COST --------------------- //
function predictSeaRatesCost(
  origin,
  destination,
  equipment,
  mode = "Seafreight",
  transit = 0,
  sailings = 0
) {
  const { models, encoders } = getTrainedModel();

  // New check that triggers the error message you received
  if (!models || models.length === 0) {
    throw new Error("❌ No trained models available for prediction.");
  }

  console.log("models, encoders => ", models, encoders);

  const encode = (val, map) => (val in map ? map[val] : 0);

  const X_new = [
    [
      encode(origin, encoders.originMap),
      encode(destination, encoders.destMap),
      encode(equipment, encoders.equipMap),
      encode(mode, encoders.modeMap),
      Number(transit) || 0,
      Number(sailings) || 0,
    ],
  ];

  // FIX: Iterate over all sub-models and average their predictions
  const predictions = models.map((m) => m.predict(X_new)[0]);

  console.log("predictions", predictions);

  const prediction = predictions.reduce((a, b) => a + b, 0) / models.length;

  console.log(
    `🔮 Predicted cost for ${origin} → ${destination} (${equipment}): ${prediction.toFixed(
      2
    )}`
  );
  return prediction;
}

module.exports = { trainSeaRatesModel, predictSeaRatesCost };
