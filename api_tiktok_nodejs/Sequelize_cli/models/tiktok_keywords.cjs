'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tiktok_keywords extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  tiktok_keywords.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    keyword: {
      type: DataTypes.TEXT,
    },
    status: {
      type: DataTypes.INTEGER,
      comment:"0-Not_Processed, 1-Processed",
      defaultValue:0
    }
  }, {
    sequelize,
    modelName: 'tiktok_keywords',
    timestamps:true
  });
  return tiktok_keywords;
};