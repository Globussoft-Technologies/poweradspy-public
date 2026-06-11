import countryAgeController from "./countryAge.controller.js";
import Router from 'express';
const router = Router();

//country-Age routes
router.post('/create',countryAgeController.AddCountryAge);
router.get('/get',countryAgeController.getAllCountryAge);
router.get('/get/:ageid',countryAgeController.getCountryAge);
router.patch('/update/:ageid',countryAgeController.updateCountryAge);
router.delete('/delete/:ageid',countryAgeController.deleteCountryAge);

export default router;