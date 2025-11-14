const { queryDB } = require("../../database/helper");
const {
  getFilesById,
  getSignedUrl,
  safeParseJSON,
  convertToCubicMeters,
  convertUnit,
} = require("../../utils/helpers");
const { generateResponseFromEmbeddings } = require("../../utils/pinecone");

function normalizeKey(key) {
  return key.replace(/_/g, "").toLowerCase();
}

module.exports = async (req, res, sql) => {
  const { id } = req.params;
  let { key, value } = req.body;
  if (!key || value === undefined || value === null || !id) {
    return res.status(400).json({
      success: false,
      message: "key, value, and id are required",
    });
  }

  const checkQuery = `SELECT * FROM ProcessedEmails WHERE Id = @id;`;
  const checkResult = await queryDB(checkQuery, sql, { id });

  if (!checkResult || checkResult.length === 0) {
    return res.status(404).json({
      success: false,
      message: "Email not found",
    });
  }
  let resultJSON = checkResult[0].ResultJSON;
  let parsedJSON = safeParseJSON(resultJSON);
  let newVolume = 0;

  if (key === "EmailCompany") {
    if (!parsedJSON.contact_person) parsedJSON.contact_person = {};
    parsedJSON.contact_person.company_name = value;
  } else if (key === "TransportType") {
    parsedJSON.transport_types = value;
  } else if (key === "Volume" || key === "VolumeUNIT") {
    if (!parsedJSON?.volume) parsedJSON.volume = {};
    if (key === "Volume") {
      if (parsedJSON?.volume?.unit != value.unit) {
        const convertedVolume = await convertUnit(
          value.volume,
          parsedJSON?.volume?.unit,
          value.unit
        );
        newVolume = +Number(convertedVolume).toFixed(3);
      } else {
        newVolume = value.volume;
      }
      parsedJSON.volume.value = newVolume;
      parsedJSON.volume.unit = value.unit;
    } else {
      parsedJSON.volume.value = value;
    }
  } else if (key === "DSPServices") {
    parsedJSON["DSP services"] = value;
  } else if (["Origin", "Destination"].includes(key)) {
    parsedJSON[key.toLowerCase()] =
      typeof value === "string" ? JSON.parse(value) : value;
    if (typeof value === "object") {
      value = JSON.stringify(value);
    }
  } else if (key === "IsVerified") {
    if (value == 1) {
      // ✅ Fetch related files from Azure
      const files = await getFilesById(id);
      let fileUrls = [];
      for (const file of files) {
        const signedUrl = await getSignedUrl(file.name);
        fileUrls.push(signedUrl);
      }

      // ✅ Extract email content from DB
      let rawEmailContent = checkResult[0].RawEmailContent;
      let parsedEmailContent;
      try {
        const unescapedContent = JSON.parse(rawEmailContent);
        parsedEmailContent =
          typeof unescapedContent === "string"
            ? JSON.parse(unescapedContent)
            : unescapedContent;
      } catch (err) {
        parsedEmailContent = {};
      }

      // ✅ Call AI
      const aiResponse = await generateResponseFromEmbeddings({
        fileUrls,
        emailContent: parsedEmailContent?.body || "",
      });

      // ✅ Save AI response back
      if (aiResponse?.success) {
        parsedJSON.ai_response = aiResponse.data; // embed AI output inside ResultJSON

        const updateQuery = `
        UPDATE ProcessedEmails
        SET ResultJSON = @resultJSON,
            AIRESPONSE = @aiResponse,
            ${key} = @value
        WHERE Id = @id;
      `;
        await queryDB(updateQuery, sql, {
          resultJSON: JSON.stringify(JSON.stringify(parsedJSON)),
          aiResponse: aiResponse.data,
          value,
          id,
        });
      } else {
        console.log("AI processing failed, keeping old AIResponse");
      }
    }
  } else if (key === "IsCompleted") {
    parsedJSON.is_completed = value;
  } else {
    const normalizedKey = normalizeKey(key);
    const jsonKey =
      Object.keys(parsedJSON).find((k) => normalizeKey(k) === normalizedKey) ||
      key;
    parsedJSON[jsonKey] = value;
  }

  if (key === "Priority") {
    let newValue = value === "Normal" ? 0 : 1;
    parsedJSON.priority = newValue;

    const updateQuery1 = `
    UPDATE ProcessedEmails
    SET ResultJSON = @resultJSON, ${key} = @newValue
    WHERE Id = @id;
  `;
    await queryDB(updateQuery1, sql, {
      resultJSON: JSON.stringify(JSON.stringify(parsedJSON)),
      newValue, // ✅ fix: must match @newValue
      id,
    });

    const updateQuery2 = `UPDATE ProcessedEmails SET ResultJSON = @resultJSON WHERE Id = @id;`;
    await queryDB(updateQuery2, sql, {
      resultJSON: JSON.stringify(JSON.stringify(parsedJSON)),
      id,
    });
  } else {
    if (key === "Volume") {
      const updateQuery = `UPDATE ProcessedEmails SET ResultJSON = @resultJSON, Volume = @volume, VolumeUNIT = @unit WHERE Id = @id; `;

      await queryDB(updateQuery, sql, {
        resultJSON: JSON.stringify(JSON.stringify(parsedJSON)),
        volume : newVolume,
        unit : value.unit,
        id,
      });
    } else {
      const updateQuery = `UPDATE ProcessedEmails SET ResultJSON = @resultJSON, ${key} = @value WHERE Id = @id;`;
      await queryDB(updateQuery, sql, {
        resultJSON: JSON.stringify(JSON.stringify(parsedJSON)),
        value,
        id,
      });
    }
  }

  const updated = await queryDB(
    `SELECT * FROM ProcessedEmails WHERE Id = @id;`,
    sql,
    { id }
  );

  res.status(200).json({
    success: true,
    message: "Email updated successfully",
    data: updated?.[0],
  });
};
