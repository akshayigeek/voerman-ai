const { queryDB } = require("../../database/helper");

module.exports = async (req, res, sql) => {
  try {
    const { id } = req.params;
    const { country, docType } = req.body;

    if (!id || !country || !docType) {
      return res.status(400).json({
        success: false,
        message: "id,docType and country details both are necessary",
      });
    }

    const query = `SELECT * FROM Documents WHERE id=@id`;
    const result = await queryDB(query, sql, { id });

    if (!result || result?.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No such source document found with that id",
      });
    }

    const updateQuery = `UPDATE Documents SET country=@country, ratesDocType=@ratesDocType WHERE id=@id`;
    await queryDB(updateQuery, sql, {
      id,
      country,
      ratesDocType: docType,
    });

    const final = await queryDB(query, sql, { id });

    return res.status(200).json({
      success: true,
      message: "Updated data successfully",
      data: final,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
