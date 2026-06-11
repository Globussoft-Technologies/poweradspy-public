import Router from "express";
const router = Router();
import tikTokController from "./tiktok.controller.js";
import cron from "node-cron";
import db from "../../Sequelize_cli/models/index.js";
import logger from "../../resources/logs/logger.log.js";
const { tiktok_ad_meta_data: META_DATA,} = db;
// Routes
router.post("/create", tikTokController.create);
router.put("/update", tikTokController.update);
router.get("/analytics/:id", tikTokController.getAnalytics);
router.get("/advertiserAds/:postOwner", tikTokController.getAdvertiserAds);
router.get('/getAds', tikTokController.getAds);
router.delete("/delete/:id", tikTokController.deleteAd);
router.delete("/delete-sql-ads", tikTokController.deleteSQLAd);

router.post("/get-video-url", tikTokController.getVideoURL);
router.get("/get-ad-url", tikTokController.getAdURL);
router.put("/update-thumb-nail", tikTokController.updateThumbNail);

//Run the cron job to update the status for every day at 12 am
cron.schedule("0 0 * * *", async () => {
    try {
      const [updatedRows] = await META_DATA.update(
        { thumb_nail_status: 0 }, 
        { where: { thumb_nail_status: 2 } } 
      );
      logger.info("thumb_nail_status updated from cron job", {updatedRows});
    } catch (error) {
    //   console.error("Error updating thumbnail status:", error);
    logger.error("Error in data updation in cronjob", error);
    }
  });
export default router;
