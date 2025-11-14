const {
  safeParseJSON,
  getSignedUrl,
  findNearestTown,
  haversine,
  convertToCubicMeters,
} = require("../helpers");
const { verifyTransportServices, verifyVolume } = require("./verifyDetails");
const { predictRate } = require("../../ml-models/ratesModel");
const { predictRates } = require("../../ml-models/parthModel");
const { getCode } = require("country-list");
const { queryDB } = require("../../database/helper");
const { parseExcelFile } = require("../customFileParser");
const { getCoordinates } = require("../googleMapsApi");
const { getCostFromModel } = require("../../ml-models/portCacheModel");

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

    const destinationJSON = safeParseJSON(emailLead?.Destination);
    const destAddress = `${
      destinationJSON.raw_input
        ? destinationJSON.raw_input
        : destinationJSON.address
        ? `${destinationJSON.address}, ${
            destinationJSON?.country ? destinationJSON?.country : ""
          }`
        : ""
    } `;

    const country_iso = sourceJSON.country_iso
      ? sourceJSON.country_iso
      : getCode(sourceJSON.country);

    const dest_country_iso = destinationJSON.country_iso
      ? destinationJSON.country_iso
      : getCode(destinationJSON.country);

    const addressVerifyStatus = await verifyTransportServices(
      sourceAddress,
      destAddress
    );

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

    const volume = volumeVerifyStatus.verified
      ? volumeVerifyStatus.finalVolume
      : parsedJSON?.volume?.value;
    // const volume = await convertToCubicMeters(
    //   parsedJSON?.volume?.value,
    //   parsedJSON?.volume?.unit
    // );

    if (emailLead.RegionType === "domestic") {
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
      const destCoord = await getCoordinates(destAddress);
      const nearestSourceTown = await findNearestTown(uniqueTowns, sourceCoord);

      const distance = await haversine(
        sourceCoord.lat,
        sourceCoord.lng,
        destCoord.lat,
        destCoord.lng
      );

      const cost = await predictRate(
        distance,
        volume || 0,
        "ORIGIN",
        nearestSourceTown?.name
      );

      console.log("--- cost generatePriceTransport.js [Line-no 140] ---", cost);

      if (!cost || !cost.rate) {
        return {
          success: false,
          message: "Could not calculate cost with the provided details",
        };
      } else {
        return { success: true, price: cost.rate, rateType: cost.rateType };
      }
    } else {
      const cost = await getCostFromModel(
        {
          origin_location: { lat: sourceJSON.lat, lng: sourceJSON.lng },
          destination_location: {
            lat: destinationJSON.lat,
            lng: destinationJSON.lng,
          },
          source_country_iso: country_iso,
          destination_country_iso: dest_country_iso,
          equipment_type: volume > 33 ? "40ft dry" : "20ft dry",
        },
        sql
      );

      console.log("--- cost generatePriceTransport.js [Line-no 162] ---", cost);

      if (!cost || !cost?.cost_rate) {
        return {
          success: false,
          message: "Could not calculate cost with the provided details",
        };
      }

      return {
        success: true,
        price: cost.cost_rate * volume,
        rateType: "freight",
      };
    }
  } catch (error) {
    console.log("Error generating price:", error);
    return { success: false, message: "Error generating price", error };
  }
};
