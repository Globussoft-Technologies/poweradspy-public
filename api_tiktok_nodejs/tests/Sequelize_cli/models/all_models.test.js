import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Each .cjs model factory follows the same shape:
//   module.exports = (sequelize, DataTypes) => {
//     class M extends Model { static associate(models) { ... } }
//     M.init({...}, { sequelize, modelName, ... });
//     return M;
//   };
//
// To run them, we substitute the real sequelize Model.init with a spy so the
// model class is defined without contacting a live database. Then we patch
// belongsTo/hasMany on the class so associate() runs without real Sequelize
// validation.
const realSequelize = require("sequelize");

// Proxy that returns a callable stub for every DataType lookup. The stub
// returns itself when called (so DataTypes.INTEGER(11), DataTypes.CHAR(2),
// DataTypes.STRING(255) all work). Each stub is also a primitive-coercible
// string for direct use.
function makeCallableType(name) {
  const fn = function (...args) { return fn; };
  fn._name = name;
  fn.toString = () => name;
  return fn;
}
const DT = new Proxy({}, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    if (!target[prop]) target[prop] = makeCallableType(prop);
    return target[prop];
  },
});

const fakeModels = new Proxy({}, {
  get: () => ({}),
});

function runFactory(relPath) {
  const factory = require(relPath);
  let capturedAttrs;
  const initSpy = vi.fn(function (attrs) { capturedAttrs = attrs; });
  const origInit = realSequelize.Model.init;
  realSequelize.Model.init = initSpy;
  let cls;
  try {
    cls = factory({}, DT);
    cls.belongsTo = vi.fn();
    cls.hasMany = vi.fn();
    cls.hasOne = vi.fn();
    cls.belongsToMany = vi.fn();
    cls.associate(fakeModels);
  } finally {
    realSequelize.Model.init = origInit;
  }
  return { cls, attrs: capturedAttrs };
}

function exerciseValidators(attrs) {
  for (const v of Object.values(attrs)) {
    if (!v || !v.validate) continue;
    // isArray: array passes, non-array throws
    if (typeof v.validate.isArray === "function") {
      v.validate.isArray([]);
      expect(() => v.validate.isArray("nope")).toThrow();
    }
    // isObject: plain object passes, array/non-object throws
    if (typeof v.validate.isObject === "function") {
      v.validate.isObject({});
      expect(() => v.validate.isObject([])).toThrow();
      expect(() => v.validate.isObject("str")).toThrow();
    }
  }
}

describe("Sequelize_cli/models — factory + associate coverage", () => {
  const models = [
    "amember_user_action",
    "hide_favourite_ads",
    "keyword_notification",
    "mail_subscription",
    "tiktok_ad_analytics",
    "tiktok_ad_country_ages",
    "tiktok_ad_country_gender",
    "tiktok_ad_country_info",
    "tiktok_ad_html_lander",
    "tiktok_ad_location",
    "tiktok_ad_meta_data",
    "tiktok_ad_post_owners",
    "tiktok_ad_urls",
    "tiktok_ad_variants",
    "tiktok_ads",
    "tiktok_keywords",
    "tiktok_users",
    "user_requests",
  ];

  for (const name of models) {
    it(`${name}.cjs: factory builds Model class + associate() runs + validators cover both sides`, () => {
      const { cls, attrs } = runFactory(`../../../Sequelize_cli/models/${name}.cjs`);
      expect(typeof cls).toBe("function");
      expect(typeof cls.associate).toBe("function");
      // Exercise any isArray/isObject validators
      exerciseValidators(attrs);
    });
  }
});
