import Router from "express";
import guestUserController from "../guestUser/guestUser.controller.js";
const router = Router();


// Routes
router.get("/landing/:id", guestUserController.getAdDetails);
router.post("/landing/getAds", guestUserController.guestUserSearchAds);
router.post("/get-video-url", guestUserController.getVideoURL);
router.post("/tiktok-ads-count", guestUserController.getAdsCount);
router.post("/tiktok-ads-count-graph", guestUserController.getAdsCountGraph);
router.post("/tiktok-ads-countries", guestUserController.getAdsCountCountries);
export default router;
