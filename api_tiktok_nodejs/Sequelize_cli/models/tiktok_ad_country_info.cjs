'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tiktok_ad_country_info extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  tiktok_ad_country_info.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    iso: {
      type: DataTypes.CHAR(2),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    nicename: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    iso3: {
      type: DataTypes.CHAR(3),
      allowNull: false,
    },
    numcode: {
      type: DataTypes.SMALLINT,
      allowNull: false,
    },
    phonecode: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  }, {
    sequelize,
    modelName: 'tiktok_ad_country_info',
    timestamps:true
  });
  return tiktok_ad_country_info;
};