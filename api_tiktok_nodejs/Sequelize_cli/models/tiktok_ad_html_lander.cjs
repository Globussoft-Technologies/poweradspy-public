"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class tiktok_ad_html_lander extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      tiktok_ad_html_lander.belongsTo(models.tiktok_ads, {
        as: "ads",
        foreignKey: "ad_id",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      });
    }
  }
  tiktok_ad_html_lander.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      ad_id: {
        type: DataTypes.INTEGER,
        references: {
          model: "tiktok_ads",
          key: "id",
        },
      },
      redirects: {
        type: DataTypes.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error("redirects field must be an array");
            }
          },
        },
      },
      outgoing_url: {
        type: DataTypes.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error("outgoing_url field must be an array");
            }
          },
        },
      },
      destinations: {
        type: DataTypes.STRING,
      },
      country_iso: {
        type: DataTypes.STRING,
      },
      html_path: {
        type: DataTypes.STRING,
      },
      html_content: {
        type: DataTypes.STRING,
      },
      screen_shot: {
        type: DataTypes.STRING,
      },
      status: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      domain_age: {
        type: DataTypes.INTEGER,
      },
      domain_registered_date: {
        type: DataTypes.STRING,
      },
      IsDataCenterProxy: {
        type: DataTypes.INTEGER,
      },
      crawled_by: {
        type: DataTypes.STRING,
      },
      ad_category: {
        type: DataTypes.JSON,
        defaultValue: [],
        validate: {
          isArray(value) {
            if (!Array.isArray(value)) {
              throw new Error("ad_category field must be an array");
            }
          },
        },
      },
    },
    {
      sequelize,
      modelName: "tiktok_ad_html_lander",
      timestamps: true,
    }
  );
  return tiktok_ad_html_lander;
};
