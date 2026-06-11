import jwt from "jsonwebtoken";
import logger from "../../resources/logs/logger.log.js";
import response from "../../utils/response.js";
import config from "config";

class UsersService {
  async getUser(req, res, next) {
    try {
      const { token } = req.body;

      // Send error response if there is no token
      if (!token) {
        logger.error("Missing jwt token in body");
        return res.send(
          response.validationFailResp("Missing jwt token in body", "")
        );
      }

      // Verify the token
      jwt.verify(token, config.get("jwt_secret_key"), (err, decoded) => {
        // Throw an error if token is manipulated or expired
        if (err) {
          return res.status(401).json({ message: "Token expired!" });
        }

        // Else send decoded data to user
        return res.send(
          response.userSuccessResp("User details found", decoded)
        );
      });
    } catch (error) {
      logger.error("Error decoding data", error);
      return res.send(response.userFailResp("Error decoding data", error));
    }
  }
}

export default new UsersService();
