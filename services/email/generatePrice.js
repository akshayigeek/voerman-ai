const { queryDB } = require("../../database/helper");
const generatePriceDestination = require("../../utils/calculatePriceHelpers/generatePriceDestination");
const generatePriceOrigin = require("../../utils/calculatePriceHelpers/generatePriceOrigin");
const generatePriceTransport = require("../../utils/calculatePriceHelpers/generatePriceTransport");

module.exports = async (req, res, sql) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "id is required",
      });
    }

    const checkQuery = `SELECT * FROM ProcessedEmails WHERE Id = @id;`;
    const checkResult = await queryDB(checkQuery, sql, { id });

    if (!checkResult?.length) {
      return res.status(404).json({
        success: false,
        message: "No record found for given id",
      });
    }

    const dspServices = checkResult[0].DSPServices || "";
    const transport_required = dspServices.includes("transport_required");
    const origin_agent_required = dspServices.includes("origin_agent_required");
    const destination_agent_required = dspServices.includes(
      "destination_agent_required"
    );

    // ✅ Case 1: No DSP service selected
    if (
      !transport_required &&
      !origin_agent_required &&
      !destination_agent_required
    ) {
      return res.status(200).json({
        success: true,
        message: "Please select any one DSP service",
        data: {
          cost: 0,
          margin: 0,
          CostError: "Please select any one DSP service",
        },
      });
    }

    const costMessageArray = [];
    const allCosts = [];

    // ✅ Transport cost
    if (transport_required) {
      const cost = await generatePriceTransport(checkResult[0], sql);
      if (!cost.success) costMessageArray.push(cost);
      else allCosts.push(cost);
      console.log("--- generatePriceTransport ---", cost);
    }

    // ✅ Origin agent cost
    if (origin_agent_required) {
      const cost = await generatePriceOrigin(checkResult[0], sql);
      if (!cost.success) costMessageArray.push(cost);
      else allCosts.push(cost);
      console.log("--- generatePriceOrigin ---", cost);
    }

    // ✅ Destination agent cost
    if (destination_agent_required) {
      const cost = await generatePriceDestination(checkResult[0], sql);
      if (!cost.success) costMessageArray.push(cost);
      else allCosts.push(cost);
      console.log("--- generatePriceDestination ---", cost);
    }

    // ✅ Case 2: Any failure among cost generators
    if (costMessageArray.some((item) => item.success === false)) {
      const errorMessage = costMessageArray
        .filter((item) => item.success === false)
        .map((item) => item.message)
        .join(", ");

      return res.status(200).json({
        success: true,
        message: errorMessage,
        data: {
          cost: 0,
          margin: 0,
          CostError: errorMessage,
        },
      });
    }

    // ✅ Case 3: All cost generations succeeded
    const totalPrice = allCosts
      .filter((item) => item.success)
      .reduce((sum, item) => sum + (item.price || 0), 0);

    // ✅ Round to 2 decimal places
    const totalCost = Number(totalPrice.toFixed(2));

    await queryDB(
      `UPDATE ProcessedEmails SET CostPrice = @cost, Margin = @margin, CostError=@CostError WHERE Id = @id;`,
      sql,
      {
        cost: totalCost,
        margin: 20,
        id,
        CostError: null,
      }
    );

    const updated = await queryDB(
      `SELECT * FROM ProcessedEmails WHERE Id = @id;`,
      sql,
      { id }
    );

    return res.status(200).json({
      success: true,
      message: "Price generated successfully",
      data: updated?.[0],
    });
  } catch (error) {
    console.error("Error generating price:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
