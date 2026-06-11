import Router from "express";
import KeywordsController from "./keywordsAPI.controller.js";
const router = Router();


// Routes
router.post("/create", KeywordsController.addKeywords);
router.get("/get", KeywordsController.getKeywords);
router.get("/get-all-logs", KeywordsController.getLogFiles)
export default router;
