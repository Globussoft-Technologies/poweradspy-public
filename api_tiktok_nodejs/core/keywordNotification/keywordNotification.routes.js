import keywordNotificationController from "./keywordNotification.controller.js";
import Router from "express";
import cron from "node-cron";
import keywordNotificationService from "./keywordNotification.service.js";

const router = Router();

//subscribed  keywords routes
router.post("/insert_keyword", keywordNotificationController.addKeywords);
router.get("/get-subscribed-keyword/:userid", keywordNotificationController.getKeywords);
router.delete("/delete-keyword/:keywordid", keywordNotificationController.deleteKeywords);

router.get(
  "/get-keywords",
  keywordNotificationController.getSubscribedKeywords
);

router.get(
  "/sendKeywordMailDaily",
  keywordNotificationController.sendKeywordMailDaily
);
router.get(
  "/sendKeywordMailWeekly",
  keywordNotificationController.sendKeywordMailWeekly
);
router.get(
  "/sendKeywordMailMonthly",
  keywordNotificationController.sendKeywordMailMonthly
);

const fakeRes = {
  send: (data) => {
    // console.log("Response:", data); //we can reome the logs
  },
};
const fakeNext = () => {
//   console.log("Next middleware called"); //we can reome the logs it is just for testing
};
//evry one minute
// cron.schedule('* * * * *', () => {
//      keywordNotificationService.sendKeywordMailDaily(null,fakeRes,fakeNext);
// });

//this is for 12am send mail
cron.schedule("0 0 * * *", () => {
  keywordNotificationService.sendKeywordMailDaily(null, fakeRes, fakeNext);
});

//this is for send mail every week on monday at 12am
cron.schedule("0 0 * * 1", () => {
  keywordNotificationService.sendKeywordMailWeekly(null, fakeRes, fakeNext);
});

// This will run on the 1st day of every month at midnight (00:00)
cron.schedule("0 0 1 * *", () => {
  keywordNotificationService.sendKeywordMailMonthly(null, fakeRes, fakeNext);
});

export default router;
