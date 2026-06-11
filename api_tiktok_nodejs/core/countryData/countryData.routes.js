import countryDataController from "./countryData.controller.js";
import Router from 'express';
const router = Router();

//country-data routes
router.post('/create',countryDataController.AddData);
router.get('/get',countryDataController.getAllCountry);
router.get('/get/:countryid',countryDataController.getCountry);
router.patch('/update/:countryid',countryDataController.updateCountryData);
router.delete('/delete/:countryid',countryDataController.deleteCountryData);
export default router;