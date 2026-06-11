'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tiktok_ad_country_ages extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      tiktok_ad_country_ages.belongsTo(models.tiktok_ads, { as: 'ads', foreignKey: 'ad_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    }
  }
  tiktok_ad_country_ages.init({
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER
    },
    ad_id: {
      type: DataTypes.INTEGER,
      references: {
        model: 'tiktok_ads',
        key: 'id',
      }
    },
    country_name:{
      type: DataTypes.STRING,
    
    },
    age_details:{
      type: DataTypes.JSON,
      validate: {
        isObject(value) {
          if (typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('age field must be an object');
          }
        },
      },
    }
 
  }, {
    sequelize,
    modelName: 'tiktok_ad_country_ages',
    timestamps:true
  });
  return tiktok_ad_country_ages;
};