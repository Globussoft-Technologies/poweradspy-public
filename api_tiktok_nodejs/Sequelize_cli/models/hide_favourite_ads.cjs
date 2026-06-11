'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class hide_favourite_ads extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here

    }
  }
  hide_favourite_ads.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    ad_id: {
      type: DataTypes.STRING,
    },
    post_owner_id: {
      type: DataTypes.INTEGER,
    },
    type:{
      type:
      DataTypes.INTEGER
    },
    status:{
      type: DataTypes.INTEGER(1),
      allowNull: false,
      defaultValue: 0
    },
    is_notified: {
      type: DataTypes.TEXT
    },
    is_requested: {
      type: DataTypes.TEXT
    },
    lcs_status: {
      type: DataTypes.TEXT
    },
  }, {
    sequelize,
    modelName: 'hide_favourite_ads',
    timestamps:true
  });
  return hide_favourite_ads;
};