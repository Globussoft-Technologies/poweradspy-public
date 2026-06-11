import builtWithAPIController from "./builtWithAPI.controller.js";
import Router from 'express';
const router = Router();

//built_with routes
router.post('/updateBuiltWithStatus',builtWithAPIController.updateBuiltWithStatus);

router.get('/getUrlsForBuiltWith',builtWithAPIController.getUrlsForBuiltWith);

export default router;