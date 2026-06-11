import Router from "express";
const router = Router();
import usersController from "./users.controller.js";

// Routes
router.post("/login", usersController.login);
router.post("/get-user-details", usersController.getUser);

export default router;
