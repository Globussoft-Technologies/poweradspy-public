import userActionAPIController from "./userActionAPI.controller.js";
import Router from 'express';
const router = Router();

//user-action routes
router.post('/update',userActionAPIController.insertAdsCountDetails);
router.get('/action/:email',userActionAPIController.updateAdsCount)


export default router;