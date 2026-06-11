import Router from "express";
const router = Router();
import cron from "node-cron";
import userRequestController from "./userRequest.controller.js";
import userRequestService from "./userRequest.service.js";

//user-request routes
router.post("/create", userRequestController.createUserRequest);
router.get("/get-user-request-keyword/:userid", userRequestController.getUserReqKeywords)
router.patch("/update-user-request-status", userRequestController.updateUserRequestSentStatus);
router.delete(
  "/delete/:userrequestid",
  userRequestController.deleteUserRequestData
);

router.get(
  "/get-usersrequest-keyword",
  userRequestController.getUserRequestKeywords
);

router.get(
  "/send-requested-keyword-mail",
  userRequestController.sendRequestedKeywordMail
);

const fakeRes = {
  send: (data) => {
    // console.log("Response:", data);//we can reome the logs
  },
};
const fakeNext = () => {
  // console.log("Next middleware called");//we can reome the logs it is just for testing
};
//daily send mail
cron.schedule("0 0 * * *", () => {
  userRequestService.sendRequestedKeywordMail(null, fakeRes, fakeNext);
});
cron.schedule('0 0 * * *', () => {
  userRequestService.updateUserRequestStatus();
});
export default router;
