const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const emailRoutes = require("./routes/emali");
const authRoutes = require("./routes/auth");
const sourcesRoutes = require("./routes/sources");
const connactDB = require("./database/connect");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(morgan("dev"));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

connactDB().then((sql) => {
  app.use("/email", emailRoutes(express.Router(), sql));
});

connactDB().then((sql) => {
  app.use("/sources", sourcesRoutes(express.Router(), sql));
});


connactDB().then((sql) => {
  app.use("/auth", authRoutes(express.Router(), sql));
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "OK",
  });
});

app.listen(PORT, () => {
  console.log("server listening on port 🚀🚀  ===== ", PORT);
});
