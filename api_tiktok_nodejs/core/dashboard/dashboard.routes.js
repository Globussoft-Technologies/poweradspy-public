import Router from "express";
const router = Router();
import dashBoardController from "./dashboard.controller.js";


router.post("/searchFilter", dashBoardController.searchFilter);
router.post("/get-ads-count", dashBoardController.getAdsCountDetails);
router.get('/get-industries',dashBoardController.getIndustries)

export default router;
