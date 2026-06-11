import Router from "express";
import lcsController from "./lcs.controller.js";
const router = Router();

// route
router.patch("/update", lcsController.update);
router.get("/getLCS/:id", lcsController.getLCS);

export default router;
