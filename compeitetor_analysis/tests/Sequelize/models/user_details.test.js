import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Load the .cjs model factory directly and invoke it with mock sequelize +
// DataTypes. The model uses ESM-incompatible top-level require('sequelize'),
// so we let the real module load with a default Model class — we never call
// .init for real, just verify the returned class.
const userDetailsFactory = require("../../../Sequelize/models/user_details.cjs");

describe("Sequelize/models/user_details.cjs", () => {
  it("factory returns a user_details Model class with associate() defined", () => {
    const initSpy = vi.fn();
    const sequelize = {};
    const DataTypes = {
      INTEGER: "INTEGER",
      DATE: "DATE",
      STRING: "STRING",
    };
    // Substitute Model.init at the prototype chain so calling user_details.init
    // doesn't try to talk to a real Sequelize instance.
    const realSequelize = require("sequelize");
    const origInit = realSequelize.Model.init;
    realSequelize.Model.init = initSpy;
    try {
      const ModelClass = userDetailsFactory(sequelize, DataTypes);
      expect(typeof ModelClass).toBe("function");
      expect(ModelClass.name).toBe("user_details");
      expect(typeof ModelClass.associate).toBe("function");
      // associate() is a no-op but must be callable
      ModelClass.associate({});
      // init was called with the expected attribute shape
      expect(initSpy).toHaveBeenCalled();
      const initArgs = initSpy.mock.calls[0];
      expect(initArgs[0]).toEqual({
        amember_id: "INTEGER",
        plan_id: "INTEGER",
        plan_expiry_date: "DATE",
        company_name: "STRING",
        email: "STRING",
        url: "STRING",
        phone_number: "STRING",
      });
      expect(initArgs[1].modelName).toBe("user_details");
      expect(initArgs[1].sequelize).toBe(sequelize);
    } finally {
      realSequelize.Model.init = origInit;
    }
  });
});
