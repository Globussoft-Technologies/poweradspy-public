import Router from 'express';
const router = Router();
import metaDataController from './metaData.controller.js';

//meta_data routes
router.post('/create', metaDataController.createMetaData);
router.get('/get', metaDataController.getAllMetaData);
router.get('/get/:metadataid', metaDataController.getMetaData);
router.patch('/update/:metadataid', metaDataController.updateMetaData);
router.delete('/delete/:metadataid', metaDataController.deleteMetaData);

export default router;
