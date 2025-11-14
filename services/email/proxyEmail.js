const { simpleParser } = require("mailparser");

module.exports = async (req, res, sql) => {
  const emlUrl = req.query.url;
  try {
    const response = await fetch(emlUrl);
    const eml = await response.text();

    const parsed = await simpleParser(eml);
    return res.json({
      success: true,
      message: "Email file get successfully",
      file: {
        subject: parsed.subject,
        from: parsed.from?.text,
        to: parsed.to?.text,
        html: parsed.html || parsed.textAsHtml,
        text: parsed.text,
        date: parsed.date,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to parse email" });
  }
};
