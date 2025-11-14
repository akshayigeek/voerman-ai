const { convertToCubicMeters, haversine } = require("../helpers");
const { getCoordinates } = require("../googleMapsApi");

const verifyOriginServices = async (originAddress) => {
  if (!originAddress || originAddress?.trim()?.length === 0) {
    return {
      verified: false,
      message: "Origin address is required",
    };
  }
  const sourceCoord = await getCoordinates(originAddress);

  if (!sourceCoord) {
    return {
      verified: false,
      message: "Origin address is invalid",
    };
  }

  return { verified: true, sourceCoord };
};

const verifyDestinationServices = async (destinationAddress) => {
  if (!destinationAddress || destinationAddress?.trim()?.length === 0) {
    return {
      verified: false,
      message: "Destination address is required",
    };
  }
  const destCoord = await getCoordinates(destinationAddress);

  if (!destCoord) {
    return {
      verified: false,
      message: "Destination address is invalid",
    };
  }

  return { verified: true, destCoord };
};

const verifyVolume = (volume, unit) => {
  const numVolume = parseFloat(volume); // convert first

  if (!numVolume || !unit) {
    return {
      verified: false,
      message:
        !numVolume && !unit
          ? "Volume and Unit is required"
          : !numVolume
          ? "Volume is required"
          : "Unit is required",
    };
  }

  if (numVolume <= 0) {
    return {
      verified: false,
      message: "Volume must be a positive number",
    };
  }

  const validUnits = [
    "kg",
    "lb",
    "m3",
    "m³",
    "ft3",
    "ft³",
    "l",
    "liter",
    "litre",
    "ml",
    "in3",
    "in³",
    "yd3",
    "yd³",
    "gal",
    "lbs"
  ];
  if (!validUnits.includes(unit)) {
    return {
      verified: false,
      message: "Invalid unit",
    };
  }

  const finalVolume = convertToCubicMeters(numVolume, unit);
  if (finalVolume <= 0) {
    return {
      verified: false,
      message: "Converted volume must be a positive number",
    };
  }

  return { verified: true, finalVolume };
};

const verifyTransportServices = async (originAddress, destinationAddress) => {
  if (!originAddress && !destinationAddress) {
    return {
      verified: false,
      message: "Origin and Destination addresses are required",
    };
  }
  const originVerification = await verifyOriginServices(originAddress);
  const destinationVerification = await verifyDestinationServices(
    destinationAddress
  );

  if (!originVerification.verified && !destinationVerification.verified) {
    return {
      verified: false,
      message: "Origin and Destination addresses are invalid",
    };
  }

  if (!originVerification.verified) {
    return {
      verified: false,
      message: originVerification.message,
    };
  }

  if (!destinationVerification.verified) {
    return {
      verified: false,
      message: destinationVerification.message,
    };
  }
  const { lat: source_lat, lng: source_lng } = originVerification.sourceCoord;
  const { lat: dest_lat, lng: dest_lng } = destinationVerification.destCoord;

  const distance = haversine(source_lat, source_lng, dest_lat, dest_lng);

  if (distance <= 0 || !distance || isNaN(distance)) {
    return {
      verified: false,
      message: "Calculated distance is invalid",
    };
  }

  return {
    verified: true,
    originCoord: originVerification.sourceCoord,
    destCoord: destinationVerification.destCoord,
    distance,
  };
};

module.exports = {
  verifyOriginServices,
  verifyDestinationServices,
  verifyVolume,
  verifyTransportServices,
};
