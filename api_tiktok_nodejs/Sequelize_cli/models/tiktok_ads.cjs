"use strict";
const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
  class tiktok_ads extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      tiktok_ads.belongsTo(models.tiktok_ad_post_owners, {
        as: "postOwner",
        foreignKey: "post_owner_id",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      });
    }
  }
  tiktok_ads.init(
    {
      id: {
        type: DataTypes.INTEGER,
        unique: true,
        primaryKey: true,
        autoIncrement: true,
      },
      ad_id: {
        type: DataTypes.STRING,
        unique: true,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      unique_users: {
        type: DataTypes.STRING,
      },
      target_users: {
        type: DataTypes.STRING,
      },
      source: {
        type: DataTypes.STRING,
      },
      first_seen: {
        type: DataTypes.DATE,
      },
      last_seen: {
        type: DataTypes.DATE,
      },
      days_running: {
        type: DataTypes.INTEGER,
      },
      post_owner_id: {
        type: DataTypes.INTEGER,
        references: {
          model: "tiktok_ad_post_owners",
          key: "id",
        },
      },
      language:{
        type: DataTypes.STRING
      },
      tiktok_account_id:{
        type: DataTypes.STRING,
        allowNull: false,
      },
      system_id: {
        type: DataTypes.STRING,
      },  
    },
    {
      sequelize,
      modelName: "tiktok_ads",
      timestamps: true,
    }
  );
  return tiktok_ads;
};