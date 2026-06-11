import hideFavAddAPIController from "./hideFavAdAPI.controller.js";
import Router from 'express';
const router = Router();

//hideFavAds routes
router.post('/hide', hideFavAddAPIController.hideFavAd);
router.post('/un-hide', hideFavAddAPIController.unHideFavAd);
router.post('/get-ads', hideFavAddAPIController.getHideAds)
router.post('/get-fav-ads', hideFavAddAPIController.getHideFavAds)

export default router;