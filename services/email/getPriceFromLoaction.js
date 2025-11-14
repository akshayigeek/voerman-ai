const { queryDB } = require("../../database/helper");
const { predictRates } = require("../../ml-models/parthModel");
const { predictRate } = require("../../ml-models/ratesModel");
const { parseExcelFile } = require("../../utils/customFileParser");
const { getCoordinates } = require("../../utils/googleMapsApi");
const {
  haversine,
  getSignedUrl,
  findNearestTown,
  convertToCubicMeters,
} = require("../../utils/helpers");

module.exports = async (req, res, sql) => {
  try {
    const {
      origin_raw = "",
      destination_raw = "",
      origin_address = "",
      destination_address = "",
      origin_country = "",
      country_iso = "",
      destination_country = "",
      volume_value,
      volume_unit,
      region_type = "domestic",
    } = req.body;

    const sourceAddress = `${
      origin_raw
        ? origin_raw
        : origin_address
        ? `${origin_address}, ${origin_country ? origin_country : ""}`
        : ""
    } `;

    const destAddress = `${
      destination_raw
        ? destination_raw
        : destination_address
        ? `${destination_address}, ${
            destination_country ? destination_country : ""
          }`
        : ""
    } `;

    if (country_iso?.trim()?.length < 1) {
      res.status(202).json({
        success: false,
        messgae: "Country iso not present",
        CostError: "Failed to add a price as Country iso is not present",
        CostPrice: 0,
        Margin: 0,
      });
      return;
    }

    if (sourceAddress?.trim()?.length < 1) {
      res.status(202).json({
        success: false,
        messgae: "Source Address not present",
        CostError: "Failed to add a price as Source Address is not present",
        CostPrice: 0,
        Margin: 0,
      });
      return;
    }

    if (destAddress?.trim()?.length < 1) {
      res.status(202).json({
        success: false,
        messgae: "Destination Address not present",
        CostError:
          "Failed to add a price as Destination Address is not present",
        CostPrice: 0,
        Margin: 0,
      });
      return;
    }

    if (!volume_value || isNaN(volume_value)) {
      res.status(202).json({
        success: false,
        messgae: "Volume not present",
        CostError: "Failed to add a price as Volume is not present",
        CostPrice: 0,
        Margin: 0,
      });
      return;
    }

    if (!volume_unit) {
      res.status(202).json({
        success: false,
        messgae: "Volume unit not present",
        CostError: "Failed to add a price as Volume unit is not present",
        CostPrice: 0,
        Margin: 0,
      });
    }

    const sourceCoord = await getCoordinates(sourceAddress);
    const destCoord = await getCoordinates(destAddress);

    if (!sourceCoord || !destCoord) {
      res.status(202).json({
        success: false,
        messgae: "Volume unit not present",
        CostError: "Failed to fetch coordinates for source or destination.",
        CostPrice: 0,
        Margin: 0,
      });
      return;
    }

    const distance = await haversine(
      sourceCoord.lat,
      sourceCoord.lng,
      destCoord.lat,
      destCoord.lng
    );

    if (!distance || isNaN(distance)) {
      console.log(
        "Unable to calculate distance between source and destination."
      );

      res.status(202).json({
        success: false,
        messgae: "Unable to calculate distance between source and destination.",
        CostError:
          "Unable to calculate distance between source and destination.",
        CostPrice: 0,
        Margin: 0,
      });
      return;
    }

    const volume = convertToCubicMeters(volume_value, volume_unit);

    if (region_type === "domestic") {
      const rateQuery = `SELECT * FROM Documents WHERE type = 'rates' and ratesDocType = 'general-rates' `;
      const fileResult = await queryDB(
        rateQuery,
        sql
        //     {
        //     country: country_iso,
        //   }
      );

      if (fileResult.length) {
        const fileUrls = await Promise.all(
          fileResult?.map(async (file) => {
            return await getSignedUrl(file.id);
          })
        );

        console.log("File URLs to process:", fileUrls); // Debug log

        let uniqueTownsSet = new Set();

        for (const url of fileUrls) {
          const { headers: fileHeaders, rows } = await parseExcelFile(url);
          const indexOfTown = fileHeaders.findIndex((h) => h === "Operation");

          rows.forEach((row) => uniqueTownsSet.add(row[indexOfTown]));
        }

        // Convert Set → Array
        const uniqueTowns = [...uniqueTownsSet];
        const nearestSourceTown = await findNearestTown(
          uniqueTowns,
          sourceCoord
        );

        cost = await predictRate(
          distance,
          volume || 0,
          "Source",
          nearestSourceTown?.name
        );

        if (!cost || !cost?.rate) {
          console.log("Rate prediction failed for domestic region.");
          res.status(202).json({
            success: false,
            messgae: "Rate prediction failed for domestic region.",
            CostError: "Rate prediction failed for domestic region.",
            CostPrice: 0,
            Margin: 0,
          });
          return;
        } else {
          res.status(200).json({
            success: false,
            messgae: "Rate prediction successfull",
            CostError: "",
            CostPrice: cost,
            Margin: 20,
          });
          return;
        }
      } else {
        res.status(202).json({
          success: false,
          messgae: "No general rates document are present in sources",
          CostError: "No general rates document are present in sources",
          CostPrice: 0,
          Margin: 0,
        });
        return;
      }
    } else {
      const rateQuery = `SELECT * FROM Documents WHERE type = 'rates' and ratesDocType = 'freight-rates'`;
      const fileResult = await queryDB(
        rateQuery,
        sql
        //     {
        //     country: country_iso,
        //   }
      );

      if (fileResult && fileResult.length) {
        cost = await predictRates({
          origin_location: sourceAddress,
          destination_location: destAddress,
          equipment_type: volume > 33 ? "40ft dry" : "20ft dry",
        });

        if (cost?.cost_rate) {
          res.status(200).json({
            success: false,
            messgae: "Rate prediction calculated successfully",
            CostPrice: cost?.cost_rate,
            Margin: 20,
            CostError: "",
          });
          return;
        } else {
          res.status(202).json({
            success: false,
            messgae:
              "Sea rates prediction failed, as they are not present in rates document",
            CostError:
              "Sea rates prediction failed, as they are not present in rates document",
            CostPrice: 0,
            Margin: 0,
          });
          return;
        }
      } else {
        res.status(202).json({
          success: false,
          messgae: "No freight rate file found for international region.",
          CostError: "No freight rate file found for international region.",
          CostPrice: 0,
          Margin: 0,
        });
        return;
      }
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
      CostError: "Failed to generate price from server",
    });
    return;
  }
};
