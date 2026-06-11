'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tiktok_users extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  tiktok_users.init({
    id: {
      type: DataTypes.INTEGER,
      unique: true,
      primaryKey: true,
      autoIncrement: true,
    },
    tiktok_account_id:{
      type: DataTypes.STRING,
      unique: true,
    },
    tiktok_account_name:{
      type: DataTypes.STRING
    },
    system_id: {
      type: DataTypes.STRING,
    },
  }, {
    sequelize,
    modelName: 'tiktok_users',
    timestamps:true
  });
  return tiktok_users;
};