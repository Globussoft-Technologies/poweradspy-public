import Router from "express";
import landerController from "./lander.controller.js";
import upload from "../../utils/multer.js";

const router = Router();

// routes
router.get("/getAdwithCountryCode", landerController.getAdwithCountryCode);
router.post(
  "/uploadFileToServer",
  upload.fields([
    { name: "image.png", maxCount: 1 },
    { name: "file.zip", maxCount: 1 },
  ]),
  landerController.uploadFileToServer
);
router.post("/insertLanderContent", landerController.insertLanderContent);

export default router;
