import Router from 'express';
const router = Router();
import variantsController from './veriants.controller.js';

//ad_variants routes
router.post('/create', variantsController.createVariants);
router.get('/get', variantsController.getAllVariants);
router.get('/get/:variantsid', variantsController.getVariants);
router.patch('/update/:variantsid', variantsController.updateVariants);
router.delete('/delete/:variantsid', variantsController.deleteVariants);

export default router;
