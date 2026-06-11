import countryGenderController from "./countryGender.controller.js";
import Router from 'express';
const router = Router();

//country-Gender routes
router.post('/create',countryGenderController.AddCountryGender);
router.get('/get',countryGenderController.getAllCountryGender);
router.get('/get/:genderid',countryGenderController.getCountryGender);
router.patch('/update/:genderid',countryGenderController.updateCountryGender);
router.delete('/delete/:genderid',countryGenderController.deleteCountryGender);
export default router;