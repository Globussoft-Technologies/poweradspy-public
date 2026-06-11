'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tiktok_ad_country_gender extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      tiktok_ad_country_gender.belongsTo(models.tiktok_ads, { as: 'ads', foreignKey: 'ad_id', onDelete: 'CASCADE', onUpdate: 'CASCADE'});

    }
  }
  tiktok_ad_country_gender.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    ad_id: {
      type: DataTypes.INTEGER,
      references: {
        model: 'tiktok_ads',
        key: 'id',
      }
    },
    country_name: {
      type: DataTypes.STRING
    },
    gender_details:{
      type: DataTypes.JSON,
      validate: {
        isObject(value) {
          if (typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('gender field must be an object');
          }
        },
      },
    }
  }, {
    sequelize,
    modelName: 'tiktok_ad_country_gender',
    timestamps:true
  });
  return tiktok_ad_country_gender;
};