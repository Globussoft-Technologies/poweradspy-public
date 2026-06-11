'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tiktok_ad_urls extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      tiktok_ad_urls.belongsTo(models.tiktok_ads, { as: 'ads', foreignKey: 'ad_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    }
  }
  tiktok_ad_urls.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    ad_id: {
      type: DataTypes.INTEGER,
      references: {
        model: 'tiktok_ads',
        key: 'id'
      }
    },
    url_type: {
      type:
        DataTypes.ENUM('D','R','S','O'),
        comment:"D-Destination_url, R-Redirecting_url S-Side_column_url O-Outgoing_url"
    },
    url: {
      type:
        DataTypes.STRING
    },
    proxy_lander_status:
    {
      type:
        DataTypes.INTEGER
    },
    type:{
      type:
      DataTypes.STRING
    },
    built_with_id:{
    type:
    DataTypes.STRING
    },
    built_with_cms_id:{
    type:
    DataTypes.STRING
    },
    built_with_tracking_id:
    {
      type:
      DataTypes.STRING
      },
     built_with:
     {
      type:
      DataTypes.ENUM('Shopify','WooCommerce','Magento')
      },
      built_with_cms:
      {
        type:
      DataTypes.STRING
      },
      built_with_analytics_tracking:{
        type:
        DataTypes.STRING
      }
  }, {
    sequelize,
    modelName: 'tiktok_ad_urls',
    timestamps:true
  });
  return tiktok_ad_urls;
};