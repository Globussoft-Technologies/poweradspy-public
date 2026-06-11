'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tiktok_ad_post_owners extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  tiktok_ad_post_owners.init({
    id: {
      type: DataTypes.INTEGER,
      unique: true,
      primaryKey: true,
      autoIncrement:true
    },
    post_owner: {
      type: DataTypes.STRING,
      allowNull: false
    },
    ads_count: {
      type:
       
        DataTypes.INTEGER,
        defaultValue:1
    },
  }, {
    sequelize,
    modelName: 'tiktok_ad_post_owners',
    timestamps:true
  });
  return tiktok_ad_post_owners;
};