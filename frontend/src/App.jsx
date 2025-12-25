import axios from "axios";

const API_URL = "http://localhost:3000/api/routes/tomtom";

export const getTomTomRoute = async (origin, destination, travelMode = "car") => {
  try {
    const response = await axios.post(API_URL, {
      origin,
      destination,
      travelMode
    });
    return response.data; // contiendra distance, durée, trafic, coordonnées
  } catch (error) {
    console.error("Erreur API TomTom:", error.response?.data || error.message);
    throw error;
  }
};
