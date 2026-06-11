import tiktok from "../../core/tiktok/tiktok.routes.js";
import lcs from "../../core/lcs/lcs.routes.js";
import lander from "../../core/destinationLander/lander.routes.js";
import dashBoard from '../../core/dashboard/dashboard.routes.js'
import countryInfo from "../../core/countryData/countryData.routes.js";
import adLocation from "../../core/adLocation/adLocation.routes.js";
import countryAge from "../../core/countryAge/countryAge.routes.js";
import countryGender from "../../core/countryGender/countryGender.routes.js";
import metaData from "../../core/metaData/metaData.routes.js";
import hideFavAdAPI from "../../core/hideFavAdAPI/hideFavAdAPI.routes.js";
import userRequest from "../../core/userRequest/userRequest.route.js";
import subscribedKeywords from "../../core/keywordNotification/keywordNotification.routes.js";
import builtWithAPI from "../../core/builtWithAPI/builtWithAPI.routes.js";
import postOwner from "../../core/postOwner/postOwner.router.js";
import variants from "../../core/variants/variants.route.js";
import users from "../../core/users/users.routes.js"
import guestUser from "../../core/guestUser/guestUser.routes.js"
import keywordsAPI from "../../core/keywordsAPI/keywordsAPI.routes.js"
import userACtionAPI from "../../core/userAction/userActionAPI.routes.js"
import cors from "cors";
import { verifyToken } from "../../utils/authentication.js";

class Routes {
  constructor(app) {
    this.configureCors(app);
    app.options("*", cors());
    app.use("/v1/users", users)
    app.use("/v1/tiktok-guest", guestUser)
    app.use("/v1/tiktok-keyword",keywordsAPI)
    app.use(verifyToken);
    app.use("/v1/tiktok", tiktok);
    app.use("/v1/lcs", lcs);
    app.use("/v1/lander", lander);
    app.use("/v1/dashboard", dashBoard);
    app.use("/v1/country", countryInfo);
    app.use("/v1/adLocation", adLocation);
    app.use("/v1/adCountryage", countryAge);
    app.use("/v1/countryGender", countryGender);
    app.use("/v1/metadata", metaData);
    app.use("/v1/owner", postOwner);
    app.use("/v1/hideFavourite", hideFavAdAPI);
    app.use("/v1/userRequest", userRequest);
    app.use("/v1/builtwith", builtWithAPI);
    app.use("/v1/subscribedKeywords", subscribedKeywords);
    app.use("/v1/variants", variants);
    app.use("/v1/user-action", userACtionAPI);
  }

  configureCors(app) {
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "localhost");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "POST, PUT, PATCH, DELETE, GET"
      );
      res.setHeader("Cache-Control", "no-cache");
      next();
    });
  }
}
export default Routes;
