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
    console.log(`📥 Loading data from: ${url}`);
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

  // Columns we need
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

  // Separate features and target
  const y = df["cost_base_rate_amount"];
  const categoricalCols = [
    "origin_location",
    "destination_location",
    "equipment_type",
    "trade_lane",
    "mode",
  ];

  // Encode categorical columns safely
  const X = df.loc({ columns: categoricalCols });
  const encoders = {};
  for (const col of categoricalCols) {
    const uniqueVals = Array.from(new Set(X[col].values));
    encoders[col] = uniqueVals;
    const encodedVals = X[col].values.map((v) => {
      if (!uniqueVals.includes(v)) return 0; // fallback for unknown values
      return uniqueVals.indexOf(v);
    });
    X.addColumn(col, encodedVals, { inplace: true });
    console.log(`🔢 Encoded column: ${col} (unique: ${uniqueVals.length})`);
  }

  // Ensure all values are numeric
  const X_values = X.values.map((row) => row.map((v) => (isNaN(v) ? 0 : v)));

  // Convert to tensors
  const X_tensor = tf.tensor2d(X_values, [X.shape[0], X.shape[1]]);
  const y_tensor = tf.tensor2d(
    y.values.map((v) => parseFloat(v)),
    [y.shape[0], 1]
  );
  console.log("📊 Converted data to tensors");

  // Define Linear Regression model
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [X.columns.length], units: 1 }));
  model.compile({ optimizer: tf.train.sgd(0.001), loss: "meanSquaredError" });
  console.log("🧩 Model defined, starting training...");

  // Train the model
  await model.fit(X_tensor, y_tensor, {
    epochs: 100,
    batchSize: 32,
    validationSplit: 0.2,
    verbose: 1,
  });

  // Compute metrics on training data
  const y_pred_tensor = model.predict(X_tensor);
  const y_pred_arr = await y_pred_tensor.array();
  const y_true_arr = await y_tensor.array();

  const y_pred_flat = y_pred_arr.map((v) => v[0]);
  const y_true_flat = y_true_arr.map((v) => v[0]);

  // Mean Squared Error (MSE)
  const mse =
    y_true_flat.reduce(
      (sum, val, i) => sum + Math.pow(val - y_pred_flat[i], 2),
      0
    ) / y_true_flat.length;

  // Mean Absolute Error (MAE)
  const mae =
    y_true_flat.reduce(
      (sum, val, i) => sum + Math.abs(val - y_pred_flat[i]),
      0
    ) / y_true_flat.length;

  // R² Score
  const mean_y =
    y_true_flat.reduce((sum, val) => sum + val, 0) / y_true_flat.length;
  const ss_res = y_true_flat.reduce(
    (sum, val, i) => sum + Math.pow(val - y_pred_flat[i], 2),
    0
  );
  const ss_tot = y_true_flat.reduce(
    (sum, val) => sum + Math.pow(val - mean_y, 2),
    0
  );
  const r2 = 1 - ss_res / ss_tot;

  console.log(
    `📊 Training metrics: MSE=${mse.toFixed(2)}, MAE=${mae.toFixed(
      2
    )}, R²=${r2.toFixed(4)}`
  );

  // Save model and encoders
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

// --------------------- PREDICT RATES (improved fuzzy matching) --------------------- //
function normalizeStr(s) {
  if (!s && s !== 0) return "";
  return String(s)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "") // smart quotes
    .replace(/[^\w\s,.-]/g, "") // remove odd punctuation but keep commas and dots
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  // simple JS implementation
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const v0 = new Array(bl + 1);
  const v1 = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) v0[j] = j;
  for (let i = 0; i < al; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < bl; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= bl; j++) v0[j] = v1[j];
  }
  return v1[bl];
}

// small country name → code map (extend as needed)
const countryMap = {
  netherlands: "nl",
  holland: "nl",
  china: "cn",
  prc: "cn",
  denmark: "dk",
  germany: "de",
  unitedkingdom: "uk",
  uk: "uk",
  unitedstates: "us",
  usa: "us",
};

function normalizeAndMapCountry(s) {
  let n = normalizeStr(s);
  // replace full country names with codes if present
  for (const full in countryMap) {
    if (n.includes(full)) {
      n = n.replace(full, countryMap[full]);
    }
  }
  return n;
}

function tokenize(s) {
  return s
    .split(/[\s,.-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

async function predictRates(input) {
  console.log("📥 Loading model for prediction...");

  // Load model and weights
  const raw = fs.readFileSync(`${OSA_MODEL_PATH}/model.json`, "utf8");
  const weightsRaw = fs.readFileSync(`${OSA_MODEL_PATH}/weights.json`, "utf8");
  const modelJSON = JSON.parse(raw);
  const weights = JSON.parse(weightsRaw);

  const model = await tf.models.modelFromJSON(modelJSON);
  const tensorWeights = weights.map((w) => tf.tensor(w));
  model.setWeights(tensorWeights);

  // Load encoders
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

  function encodeValueRobust(column, value) {
    const candidates = encoders[column] || [];
    const rawValue = value == null ? "" : String(value);

    const norm = normalizeAndMapCountry(rawValue);

    // 1️⃣ Exact match
    for (let i = 0; i < candidates.length; i++) {
      if (normalizeStr(candidates[i]) === normalizeStr(rawValue)) {
        return { index: i, matched: candidates[i], method: "exact" };
      }
    }

    // 2️⃣ Normalized match
    for (let i = 0; i < candidates.length; i++) {
      if (normalizeAndMapCountry(candidates[i]) === norm) {
        return { index: i, matched: candidates[i], method: "normalized" };
      }
    }

    // 3️⃣ Token intersection
    const valTokens = tokenize(norm);
    if (valTokens.length > 0) {
      let bestIdx = -1;
      let bestScore = 0;
      for (let i = 0; i < candidates.length; i++) {
        const candTokens = tokenize(normalizeAndMapCountry(candidates[i]));
        const inter = candTokens.filter((t) => valTokens.includes(t)).length;
        if (inter > bestScore) {
          bestScore = inter;
          bestIdx = i;
        }
      }
      if (bestScore > 0) {
        return {
          index: bestIdx,
          matched: candidates[bestIdx],
          method: `token-intersection(${bestScore})`,
        };
      }
    }

    // 4️⃣ Levenshtein fallback
    const normCandidates = candidates.map((c) => normalizeAndMapCountry(c));
    const distances = normCandidates.map((c, i) => ({
      i,
      dist: levenshtein(norm, c),
      cand: candidates[i],
      candNorm: c,
    }));
    distances.sort((a, b) => a.dist - b.dist);
    const best = distances[0];
    const len = Math.max(1, Math.max(norm.length, best.candNorm.length));
    if (best.dist / len <= 0.35) {
      return {
        index: best.i,
        matched: best.cand,
        method: `levenshtein(${best.dist})`,
      };
    }

    // ❌ No good match
    const top3 = distances.slice(0, 3).map((d) => d.cand);
    return { index: -1, suggestions: top3 };
  }

  try {
    const enc1 = encodeValueRobust("origin_location", origin_location);
    const enc2 = encodeValueRobust(
      "destination_location",
      destination_location
    );
    const enc3 = encodeValueRobust("equipment_type", equipment_type);

    console.log("enc3", enc3);

    const enc4 = encodeValueRobust("trade_lane", trade_lane);
    const enc5 = encodeValueRobust("mode", mode);

    // ✅ Trade lane / mode can be skipped
    const mandatoryEncoders = [enc1, enc2, enc3];
    const optionalEncoders = [enc4, enc5];

    const badMandatory = mandatoryEncoders.find((e) => e.index === -1);
    if (badMandatory) {
      const colNames = [
        "origin_location",
        "destination_location",
        "equipment_type",
      ];
      const idx = mandatoryEncoders.indexOf(badMandatory);
      throw new Error(
        `Unknown value for ${
          colNames[idx]
        }. No good match found. Top suggestions: ${badMandatory.suggestions.join(
          " | "
        )}`
      );
    }

    // Fallback for trade_lane/mode
    const enc4Index = enc4.index === -1 ? 0 : enc4.index;
    const enc5Index = enc5.index === -1 ? 0 : enc5.index;

    const encoded = [enc1.index, enc2.index, enc3.index, enc4Index, enc5Index];

    console.log(
      `🔢 Encoded input (method): ${encoded
        .map((e, i) => `${e}:${[enc1, enc2, enc3, enc4, enc5][i].method}`)
        .join(", ")}`
    );
    console.log(
      `🔎 Matched values: ${[enc1, enc2, enc3, enc4, enc5]
        .map((e) => (e.index === -1 ? "SKIPPED" : e.matched))
        .join(" || ")}`
    );

    const inputTensor = tf.tensor2d([encoded]);

    console.log("inputTensor", inputTensor);

    const prediction = model.predict(inputTensor);

    const predicted = await prediction.data();

    console.log("predicted", predicted);

    const cost = predicted[0];

    console.log(`💰 Predicted cost: ${cost.toFixed(2)} EUR`);
    return { cost_rate: parseFloat(cost.toFixed(2)), currency: "EUR" };
  } catch (err) {
    console.error("⚠️ Prediction error:", err.message);
    return { error: err.message, cost_rate: null, currency: null };
  }
}

module.exports = { predictRates, trainModel };
