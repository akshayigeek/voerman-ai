const { default: axios } = require("axios");

require("dotenv").config();
const baseURL = "https://maps.googleapis.com/maps/api";

const getCoordinates = async (address) => {
  const url = `${baseURL}/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

  try {
    let config = {
      method: "GET",
      maxBodyLength: Infinity,
      url: url,
      headers: {},
    };

    let res = await axios.request(config);

    if (res.status === 200 && res.data.status === "OK") {
      return res.data.results[0].geometry.location;
    } else {
      return null;
    }
  } catch (error) {
    console.log("getCoordinates", error);
  }
};

module.exports = { getCoordinates };
