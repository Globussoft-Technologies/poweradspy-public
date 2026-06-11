import { describe, it, expect, vi, beforeEach } from "vitest";

// Sentinel routers — each test verifies a specific path mounts the
// expected sentinel. Using objects (not functions) makes the dispatch
// table assertions trivial.
const {
  ttRouter, lcsRouter, landerRouter, dashRouter, countryRouter, adLocRouter,
  ageRouter, genderRouter, metaRouter, hideFavRouter, userReqRouter,
  subKwRouter, builtWithRouter, postOwnerRouter, variantsRouter, usersRouter,
  guestRouter, kwApiRouter, userActionRouter, corsMw, verifyTokenFn,
} = vi.hoisted(() => ({
  ttRouter: { _id: "tiktok" },
  lcsRouter: { _id: "lcs" },
  landerRouter: { _id: "lander" },
  dashRouter: { _id: "dashboard" },
  countryRouter: { _id: "country" },
  adLocRouter: { _id: "adLocation" },
  ageRouter: { _id: "countryAge" },
  genderRouter: { _id: "countryGender" },
  metaRouter: { _id: "metaData" },
  hideFavRouter: { _id: "hideFav" },
  userReqRouter: { _id: "userRequest" },
  subKwRouter: { _id: "subKw" },
  builtWithRouter: { _id: "builtWith" },
  postOwnerRouter: { _id: "postOwner" },
  variantsRouter: { _id: "variants" },
  usersRouter: { _id: "users" },
  guestRouter: { _id: "guest" },
  kwApiRouter: { _id: "kwApi" },
  userActionRouter: { _id: "userAction" },
  corsMw: vi.fn(() => "cors-middleware"),
  verifyTokenFn: vi.fn(),
}));

vi.mock("../../../core/tiktok/tiktok.routes.js", () => ({ default: ttRouter }));
vi.mock("../../../core/lcs/lcs.routes.js", () => ({ default: lcsRouter }));
vi.mock("../../../core/destinationLander/lander.routes.js", () => ({ default: landerRouter }));
vi.mock("../../../core/dashboard/dashboard.routes.js", () => ({ default: dashRouter }));
vi.mock("../../../core/countryData/countryData.routes.js", () => ({ default: countryRouter }));
vi.mock("../../../core/adLocation/adLocation.routes.js", () => ({ default: adLocRouter }));
vi.mock("../../../core/countryAge/countryAge.routes.js", () => ({ default: ageRouter }));
vi.mock("../../../core/countryGender/countryGender.routes.js", () => ({ default: genderRouter }));
vi.mock("../../../core/metaData/metaData.routes.js", () => ({ default: metaRouter }));
vi.mock("../../../core/hideFavAdAPI/hideFavAdAPI.routes.js", () => ({ default: hideFavRouter }));
vi.mock("../../../core/userRequest/userRequest.route.js", () => ({ default: userReqRouter }));
vi.mock("../../../core/keywordNotification/keywordNotification.routes.js", () => ({ default: subKwRouter }));
vi.mock("../../../core/builtWithAPI/builtWithAPI.routes.js", () => ({ default: builtWithRouter }));
vi.mock("../../../core/postOwner/postOwner.router.js", () => ({ default: postOwnerRouter }));
vi.mock("../../../core/variants/variants.route.js", () => ({ default: variantsRouter }));
vi.mock("../../../core/users/users.routes.js", () => ({ default: usersRouter }));
vi.mock("../../../core/guestUser/guestUser.routes.js", () => ({ default: guestRouter }));
vi.mock("../../../core/keywordsAPI/keywordsAPI.routes.js", () => ({ default: kwApiRouter }));
vi.mock("../../../core/userAction/userActionAPI.routes.js", () => ({ default: userActionRouter }));
vi.mock("cors", () => ({ default: corsMw }));
vi.mock("../../../utils/authentication.js", () => ({ verifyToken: verifyTokenFn }));

let Routes;

beforeEach(async () => {
  vi.resetModules();
  corsMw.mockClear();
  verifyTokenFn.mockClear();
  ({ default: Routes } = await import(
    "../../../resources/routes/public.routes.js"
  ));
});

function makeApp() {
  return {
    options: vi.fn(),
    use: vi.fn(),
  };
}

describe("resources/routes/public.routes > Routes class wiring", () => {
  it("mounts every sub-router under its expected /v1/<name> prefix in the right order", () => {
    const app = makeApp();
    new Routes(app);

    // app.options('*', cors())
    expect(app.options).toHaveBeenCalledWith("*", "cors-middleware");

    // Public routes (before verifyToken middleware)
    const useCalls = app.use.mock.calls;

    // configureCors registered the first use() call (anonymous middleware)
    expect(typeof useCalls[0][0]).toBe("function");

    // Public mounts: users, guestUser, keywordsAPI
    expect(useCalls).toContainEqual(["/v1/users", usersRouter]);
    expect(useCalls).toContainEqual(["/v1/tiktok-guest", guestRouter]);
    expect(useCalls).toContainEqual(["/v1/tiktok-keyword", kwApiRouter]);

    // verifyToken middleware mounted after public routes
    expect(useCalls).toContainEqual([verifyTokenFn]);

    // Authenticated mounts
    expect(useCalls).toContainEqual(["/v1/tiktok", ttRouter]);
    expect(useCalls).toContainEqual(["/v1/lcs", lcsRouter]);
    expect(useCalls).toContainEqual(["/v1/lander", landerRouter]);
    expect(useCalls).toContainEqual(["/v1/dashboard", dashRouter]);
    expect(useCalls).toContainEqual(["/v1/country", countryRouter]);
    expect(useCalls).toContainEqual(["/v1/adLocation", adLocRouter]);
    expect(useCalls).toContainEqual(["/v1/adCountryage", ageRouter]);
    expect(useCalls).toContainEqual(["/v1/countryGender", genderRouter]);
    expect(useCalls).toContainEqual(["/v1/metadata", metaRouter]);
    expect(useCalls).toContainEqual(["/v1/owner", postOwnerRouter]);
    expect(useCalls).toContainEqual(["/v1/hideFavourite", hideFavRouter]);
    expect(useCalls).toContainEqual(["/v1/userRequest", userReqRouter]);
    expect(useCalls).toContainEqual(["/v1/builtwith", builtWithRouter]);
    expect(useCalls).toContainEqual(["/v1/subscribedKeywords", subKwRouter]);
    expect(useCalls).toContainEqual(["/v1/variants", variantsRouter]);
    expect(useCalls).toContainEqual(["/v1/user-action", userActionRouter]);
  });

  it("calls cors() once (for app.options('*', cors()))", () => {
    const app = makeApp();
    new Routes(app);
    expect(corsMw).toHaveBeenCalledTimes(1);
  });
});

describe("resources/routes/public.routes > configureCors middleware", () => {
  it("sets CORS + Cache-Control headers and calls next()", () => {
    const app = makeApp();
    new Routes(app);
    // The first use() call is the configureCors anonymous middleware
    const middleware = app.use.mock.calls[0][0];
    expect(typeof middleware).toBe("function");

    const res = { setHeader: vi.fn() };
    const next = vi.fn();
    middleware({}, res, next);

    // Last value of each header wins; assert the final calls happened
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "localhost"
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Origin",
      "*"
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Headers",
      "Content-Type"
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Headers",
      "*"
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Methods",
      "POST, PUT, PATCH, DELETE, GET"
    );
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
    expect(next).toHaveBeenCalledTimes(1);
  });
});
