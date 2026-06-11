import adLocationController from "./adLocation.controller.js";
import Router from 'express';
const router = Router();
//ad_Location routes
router.post('/create',adLocationController.AddLocation);
router.get('/get',adLocationController.getAllLocationData);
router.get('/get/:locationid',adLocationController.getLocationData);
router.patch('/update/:locationid',adLocationController.updateLocationData);
router.delete('/delete/:locationid',adLocationController.deleteLocationData);
export default router;