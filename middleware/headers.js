export function verifyHeaders(req, res, next) {
  const userAgent = req.headers["x-user-agent"];
  console.log("userAgent", userAgent);
  const EXPECTED_USER_AGENT =
    process.env.EXPECTED_USER_AGENT || "reedgeapp.app.n8n.cloud";

  if (!userAgent) {
    return res.status(400).json({
      error: "Missing required headers: x-user-agent",
    });
  }

  if (userAgent !== EXPECTED_USER_AGENT) {
    return res.status(403).json({
      error: "Invalid x-user-agent ",
    });
  }

  next();
}
