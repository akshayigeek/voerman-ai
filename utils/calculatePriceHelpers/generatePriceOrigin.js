const {
  safeParseJSON,
  getSignedUrl,
  findNearestTown,
  haversine,
  convertToCubicMeters,
} = require("../helpers");
const { verifyOriginServices, verifyVolume } = require("./verifyDetails");
const { predictRate } = require("../../ml-models/ratesModel");
const { getCode } = require("country-list");
const { queryDB } = require("../../database/helper");
const { parseExcelFile } = require("../customFileParser");
const { getCoordinates } = require("../googleMapsApi");

module.exports = async (emailLead, sql) => {
  try {
    if (!emailLead) {
      return { success: false, message: "No data provided" };
    }
    let parsedJSON = safeParseJSON(emailLead.ResultJSON);

    // Further processing logic here
    const sourceJSON = safeParseJSON(emailLead?.Origin);
    const sourceAddress = `${
      sourceJSON.raw_input
        ? sourceJSON.raw_input
        : sourceJSON.address
        ? `${sourceJSON.address}, ${
            sourceJSON?.country ? sourceJSON?.country : ""
          }`
        : ""
    } `;

    const country_iso = sourceJSON.country_iso
      ? sourceJSON.country_iso
      : getCode(sourceJSON.country);

    const addressVerifyStatus = await verifyOriginServices(sourceAddress);

    if (!addressVerifyStatus.verified) {
      return {
        success: false,
        message: addressVerifyStatus.message,
      };
    }

    const volumeVerifyStatus = await verifyVolume(
      parsedJSON?.volume?.value,
      parsedJSON?.volume?.unit
    );

    if (!volumeVerifyStatus.verified) {
      return {
        success: false,
        message: volumeVerifyStatus.message,
      };
    }

    const rateQuery = `SELECT * FROM Documents WHERE type = 'rates' and ratesDocType = 'general-rates' and country LIKE @country_iso`;
    const fileResult = await queryDB(rateQuery, sql, {
      country_iso: `%${country_iso}%`,
    });

    if (!fileResult.length) {
      return {
        success: false,
        message: `No rates document found for country: ${country_iso}`,
      };
    }

    const fileUrls = await Promise.all(
      fileResult?.map(async (file) => {
        return await getSignedUrl(file.id);
      })
    );

    let uniqueTownsSet = new Set();

    for (const url of fileUrls) {
      const { headers: fileHeaders, rows } = await parseExcelFile(url);
      const indexOfTown = fileHeaders.findIndex((h) => h === "Operation");

      rows.forEach((row) => uniqueTownsSet.add(row[indexOfTown]));
    }

    // Convert Set → Array
    const uniqueTowns = [...uniqueTownsSet];

    console.log("Unique towns:", uniqueTowns); // Debug log

    const sourceCoord = await getCoordinates(sourceAddress);
    const nearestSourceTown = await findNearestTown(uniqueTowns, sourceCoord);

    const distance = await haversine(
      sourceCoord.lat,
      sourceCoord.lng,
      sourceAddress.lat,
      sourceAddress.lng
    );

    const volume = volumeVerifyStatus.verified
      ? volumeVerifyStatus.finalVolume
      : parsedJSON?.volume?.value;
    // const volume = await convertToCubicMeters(
    //   parsedJSON?.volume?.value,
    //   parsedJSON?.volume?.unit
    // );

    const cost = await predictRate(
      nearestSourceTown?.distance || 0,
      volume || 0,
      "ORIGIN",
      nearestSourceTown?.name
    );

    if (!cost || !cost.rate) {
      return {
        success: false,
        message: "Could not calculate cost with the provided details",
      };
    } else {
      return { success: true, price: cost.rate, rateType: cost.rateType };
    }
  } catch (error) {
    console.log("Error generating price:", error);
    return { success: false, message: "Error generating price", error };
  }
};
