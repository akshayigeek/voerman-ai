const tf = require("@tensorflow/tfjs");
const dfd = require("danfojs");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const fs = require("fs");
const XLSX = require("xlsx");
const { OSA_MODEL_PATH } = require("../utils/helpers");

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

async function trainModel(FILE_URLS) {
  console.log("🧠 Starting model training...");
  let df = await loadAllData(FILE_URLS);

  const selectedCols = [
    "origin_location",
    "destination_location",
    "equipment_type",
    "trade_lane",
    "mode",
    "cost_base_rate_amount",
  ];

  df = df.loc({ columns: selectedCols });
  console.log(`📊 Selected columns: ${selectedCols.join(", ")}`);

  // Fill missing values
  df = df.fillNa({
    values: {
      cost_base_rate_amount: 0,
      origin_location: "UNKNOWN",
      destination_location: "UNKNOWN",
      equipment_type: "UNKNOWN",
      trade_lane: "DEFAULT",
      mode: "SEA",
    },
  });
  console.log("✅ Missing values filled");

  const y = df["cost_base_rate_amount"];
  const categoricalCols = [
    "origin_location",
    "destination_location",
    "equipment_type",
    "trade_lane",
    "mode",
  ];

  const X = df.loc({ columns: categoricalCols });

  console.log(X.values.slice(0, 5));

  const encoders = {};
  for (const col of categoricalCols) {
    const uniqueVals = Array.from(new Set(X[col].values));
    encoders[col] = uniqueVals;
    const encodedVals = X[col].values.map((v) => {
      const idx = uniqueVals.indexOf(v);
      return idx === -1 ? 0 : idx;
    });
    X.addColumn(col, encodedVals, { inplace: true });
    console.log(`🔢 Encoded column: ${col} (${uniqueVals.length} unique)`);
  }

  const X_values = X.values.map((row) => row.map((v) => (isNaN(v) ? 0 : v)));
  const y_values = y.values.map((v) => parseFloat(v) || 0);

  const X_tensor = tf.tensor2d(X_values);
  const y_tensor = tf.tensor2d(y_values, [y_values.length, 1]);
  console.log("📊 Converted data to tensors");

  const model = tf.sequential();
  model.add(
    tf.layers.dense({
      inputShape: [X.columns.length],
      units: 16,
      activation: "relu",
    })
  );
  model.add(tf.layers.dense({ units: 8, activation: "relu" }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({
    optimizer: tf.train.adam(0.01),
    loss: "meanSquaredError",
    metrics: ["mae"],
  });

  console.log("🧩 Model defined, starting training...");
  await model.fit(X_tensor, y_tensor, {
    epochs: 100,
    batchSize: 32,
    validationSplit: 0.2,
    verbose: 1,
  });

  // Evaluate metrics
  const preds = model.predict(X_tensor);
  const y_pred = await preds.array();
  const y_true = y_values;

  const mse =
    y_true.reduce((sum, val, i) => sum + Math.pow(val - y_pred[i][0], 2), 0) /
    y_true.length;
  const mae =
    y_true.reduce((sum, val, i) => sum + Math.abs(val - y_pred[i][0]), 0) /
    y_true.length;
  const mean_y = y_true.reduce((a, b) => a + b, 0) / y_true.length;
  const ss_res = y_true.reduce(
    (sum, val, i) => sum + Math.pow(val - y_pred[i][0], 2),
    0
  );
  const ss_tot = y_true.reduce(
    (sum, val) => sum + Math.pow(val - mean_y, 2),
    0
  );
  const r2 = 1 - ss_res / ss_tot;

  console.log(df["cost_base_rate_amount"].values.slice(0, 10));
//   console.log("Min:", Math.min(...df["cost_base_rate_amount"].values));
//   console.log("Max:", Math.max(...df["cost_base_rate_amount"].values));

  console.log(
    `📊 Training metrics: MSE=${mse.toFixed(2)}, MAE=${mae.toFixed(
      2
    )}, R²=${r2.toFixed(4)}`
  );

  // Save model + encoders
  fs.mkdirSync(OSA_MODEL_PATH, { recursive: true });
  const modelJSON = model.toJSON(null, false);
  const weights = model.getWeights().map((w) => w.arraySync());
  fs.writeFileSync(`${OSA_MODEL_PATH}/model.json`, JSON.stringify(modelJSON));
  fs.writeFileSync(`${OSA_MODEL_PATH}/weights.json`, JSON.stringify(weights));
  fs.writeFileSync(
    `${OSA_MODEL_PATH}/encoders.json`,
    JSON.stringify(encoders, null, 2)
  );
  console.log(`✅ Model and encoders saved at: ${OSA_MODEL_PATH}`);
}

// ------------------- Utilities ------------------- //
// Normalize strings for better matching
function normalizeStr(str) {
  return str.toLowerCase().replace(/[\.,]/g, "").replace(/\s+/g, " ").trim();
}

// Tokenize for city/word intersection
function tokenize(str) {
  return str.split(" ").filter((t) => t.length > 0);
}

// Levenshtein distance (simple implementation)
function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[a.length][b.length];
}

// ------------------- Prediction ------------------- //
async function predictRates(input) {
  console.log("📥 Loading model for prediction...");

  const raw = fs.readFileSync(`${OSA_MODEL_PATH}/model.json`, "utf8");
  const weightsRaw = fs.readFileSync(`${OSA_MODEL_PATH}/weights.json`, "utf8");
  const modelJSON = JSON.parse(raw);
  const weights = JSON.parse(weightsRaw);

  const model = await tf.models.modelFromJSON(modelJSON);
  const tensorWeights = weights.map((w) => tf.tensor(w));
  model.setWeights(tensorWeights);

  const encoders = JSON.parse(
    fs.readFileSync(`${OSA_MODEL_PATH}/encoders.json`, "utf8")
  );

  const {
    origin_location,
    destination_location,
    equipment_type,
    trade_lane = "DEFAULT",
    mode = "SEA",
  } = input;

  // Generic encoder with robust matching
  function encodeValueRobust(column, value) {
    const candidates = encoders[column] || [];
    if (!value) return { index: -1, suggestions: candidates.slice(0, 3) };
    const rawValue = String(value).trim();
    const norm = normalizeStr(rawValue);

    // Exact match
    for (let i = 0; i < candidates.length; i++) {
      if (normalizeStr(candidates[i]) === norm)
        return { index: i, matched: candidates[i], method: "exact" };
    }

    // Token intersection
    const valTokens = tokenize(norm);
    if (valTokens.length > 0) {
      let bestIdx = -1;
      let bestScore = 0;
      for (let i = 0; i < candidates.length; i++) {
        const candTokens = tokenize(normalizeStr(candidates[i]));
        const inter = candTokens.filter((t) => valTokens.includes(t)).length;
        if (inter > bestScore) {
          bestScore = inter;
          bestIdx = i;
        }
      }
      if (bestScore > 0)
        return {
          index: bestIdx,
          matched: candidates[bestIdx],
          method: `token-intersection(${bestScore})`,
        };
    }

    // Levenshtein distance fallback
    const distances = candidates.map((c, i) => ({
      i,
      dist: levenshtein(norm, normalizeStr(c)),
      cand: c,
    }));
    distances.sort((a, b) => a.dist - b.dist);
    const best = distances[0];
    if (
      best.dist / Math.max(norm.length, normalizeStr(best.cand).length) <=
      0.35
    ) {
      return {
        index: best.i,
        matched: best.cand,
        method: `levenshtein(${best.dist})`,
      };
    }

    // No match
    return { index: -1, suggestions: distances.slice(0, 3).map((d) => d.cand) };
  }

  try {
    const enc1 = encodeValueRobust("origin_location", origin_location);
    const enc2 = encodeValueRobust(
      "destination_location",
      destination_location
    );
    const enc3 = encodeValueRobust("equipment_type", equipment_type);
    const enc4 = encodeValueRobust("trade_lane", trade_lane);
    const enc5 = encodeValueRobust("mode", mode);

    // Only origin, destination, equipment are mandatory
    const mandatory = [enc1, enc2, enc3];
    const badMandatory = mandatory.find((e) => e.index === -1);
    if (badMandatory) {
      const names = [
        "origin_location",
        "destination_location",
        "equipment_type",
      ];
      const idx = mandatory.indexOf(badMandatory);
      throw new Error(
        `Unknown value for ${
          names[idx]
        }. Suggestions: ${badMandatory.suggestions.join(" | ")}`
      );
    }

    const encoded = [
      enc1.index,
      enc2.index,
      enc3.index,
      enc4.index === -1 ? 0 : enc4.index,
      enc5.index === -1 ? 0 : enc5.index,
    ];

    console.log(
      `🔢 Encoded input (methods): ${encoded
        .map((e, i) => `${e}:${[enc1, enc2, enc3, enc4, enc5][i].method}`)
        .join(", ")}`
    );
    console.log(
      `🔎 Matched values: ${[enc1, enc2, enc3, enc4, enc5]
        .map((e) => e.matched)
        .join(" || ")}`
    );

    const inputTensor = tf.tensor2d([encoded]);
    const prediction = model.predict(inputTensor);
    const cost = (await prediction.data())[0];

    console.log(`💰 Predicted cost: ${cost.toFixed(2)} EUR`);
    return { cost_rate: parseFloat(cost.toFixed(2)), currency: "EUR" };
  } catch (err) {
    console.error("⚠️ Prediction error:", err.message);
    return { error: err.message, cost_rate: null, currency: null };
  }
}

module.exports = { trainModel, predictRates };
