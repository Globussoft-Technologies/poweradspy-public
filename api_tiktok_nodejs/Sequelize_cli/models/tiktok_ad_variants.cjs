'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tiktok_ad_variants extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      tiktok_ad_variants.belongsTo(models.tiktok_ads, { as: 'ads', foreignKey: 'ad_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    }
  }
  tiktok_ad_variants.init({
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
      },
    },
    ad_title: {
      type: DataTypes.STRING
    },
    newsfeed_description: {
      type: DataTypes.TEXT
    },
    video_url_original: {
      type: DataTypes.TEXT
    },
    video_url: {
      type: DataTypes.TEXT
    },
  }, {
    sequelize,
    modelName: 'tiktok_ad_variants',
    timestamps:true
  });
  return tiktok_ad_variants;
};