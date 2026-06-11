'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tiktok_ad_analytics extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      tiktok_ad_analytics.belongsTo(models.tiktok_ads, { as: 'ads', foreignKey: 'ad_id', onDelete: 'CASCADE', onUpdate: 'CASCADE'});

    }
  }
  tiktok_ad_analytics.init({
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
    likes:{
      type:DataTypes.INTEGER,
       defaultValue:0
    },
    comments:{
      type:DataTypes.INTEGER,
     defaultValue:0
    },
   shares:{
      type:DataTypes.INTEGER,
      defaultValue:0
    },
    popularity:{
      type:DataTypes.INTEGER,
      comment:"%"
      
    },
    impression :{
      type:DataTypes.INTEGER,
      
    }
  }, {
    sequelize,
    modelName: 'tiktok_ad_analytics',
    timestamps:true
  });
  return tiktok_ad_analytics;
};