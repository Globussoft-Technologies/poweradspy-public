import Response from "./response.js";
import logger from "../resources/logs/logger.log.js";
import config from "config";
export default async function languageTranslation(title, res) {
  try {
    let payload = {
      title,
      text: "",
      newsfeed_description: "",
      call_to_action: "",
    };
    let response = await fetch(config.get("language_tanslation_api"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    response = await response.json();
    return response.language_name;
  } catch (error) {
    logger.error("Error in language translation api", error);
    // console.log(error);
    return res
      .status(500)
      .send(Response.userFailResp("Error in language translation API", error));
  }
}
