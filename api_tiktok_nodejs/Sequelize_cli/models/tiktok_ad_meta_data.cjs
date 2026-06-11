'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tiktok_ad_meta_data extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      tiktok_ad_meta_data.belongsTo(models.tiktok_ads, { as: 'ads', foreignKey: 'ad_id', onDelete: 'CASCADE', onUpdate: 'CASCADE' });

    }
  }
  tiktok_ad_meta_data.init({
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
    video_url: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    video_duration: {
      type: DataTypes.STRING,
    },
    video_cover: {
      type: DataTypes.TEXT,
    },
    platform: {
      type: DataTypes.INTEGER,
    },
    destination_url: {
      type: DataTypes.STRING,
    },
    source: {
      type: DataTypes.STRING,
    },
    cost: {
      type: DataTypes.FLOAT,
    },
    ctr: {
      type: DataTypes.FLOAT,
    },
    library_url: {
      type: DataTypes.STRING,
    },
    ad_paid_for: {
      type: DataTypes.STRING,
    },
    audience: {
      type: DataTypes.STRING,
    },
    interest: {
      type: DataTypes.STRING,
    },
    video_interection: {
      type: DataTypes.STRING,
    },
    creator_interactions: {
      type: DataTypes.STRING,
    },
    published_countries_count: {
      type: DataTypes.INTEGER,
    },
    target_users: {
      type: DataTypes.STRING,
    },
    top_clicks: {
      type: DataTypes.STRING,
    },
    objectives: {
      type: DataTypes.JSON,
      defaultValue: [],
      validate: {
        isArray(value) {
          if (!Array.isArray(value)) {
            throw new Error('objectives field must be an array');
          }
        },
      },
    },
    target_keywords: {
      type: DataTypes.JSON,
      defaultValue: [],
      validate: {
        isArray(value) {
          if (!Array.isArray(value)) {
            throw new Error('target_keywords field must be an array');
          }
        },
      },
    },
    top_ctr: {
      type: DataTypes.STRING,
    },
    ctr_graph: {
      type: DataTypes.JSON,
      defaultValue: [],
      validate: {
        isArray(value) {
          if (!Array.isArray(value)) {
            throw new Error('ctr_graph field must be an array');
          }
        },
      },
    },
    top_cvr: {
      type: DataTypes.STRING,
    },
    cvr_graph: {
      type: DataTypes.JSON,
      defaultValue: [],
      validate: {
        isArray(value) {
          if (!Array.isArray(value)) {
            throw new Error('cvr_graph field must be an array');
          }
        },
      },
    },
    clicks_graph: {
      type: DataTypes.JSON,
      defaultValue: [],
      validate: {
        isArray(value) {
          if (!Array.isArray(value)) {
            throw new Error('clicks_graph field must be an array');
          }
        },
      },
    },
    top_conversion: {
      type: DataTypes.STRING,
    },
    conversion_graph: {
      type: DataTypes.JSON,
      defaultValue: [],
      validate: {
        isArray(value) {
          if (!Array.isArray(value)) {
            throw new Error('conversion_graph field must be an array');
          }
        },
      },
    },
    top_remains: {
      type: DataTypes.STRING,
    },
    remain_graph: {
      type: DataTypes.JSON,
      defaultValue: [],
      validate: {
        isArray(value) {
          if (!Array.isArray(value)) {
            throw new Error('remain_graph field must be an array');
          }
        },
      },
    },
    affiliate_data:{
      type: DataTypes.STRING,
    },
    status:{
      type: DataTypes.STRING,
      defaultValue:0
    },
    built_with:{
      type: DataTypes.STRING
    },
    built_with_cms:{
      type: DataTypes.STRING
    },
    built_with_analytics_tracking:{
      type: DataTypes.STRING
    },
    industry:{
      type: DataTypes.STRING
    },
    budget:{
      type: DataTypes.STRING
    },
    thumb_nail_status:{
      type: DataTypes.INTEGER,
      defaultValue:0
    }
  }, {
    sequelize,
    modelName: 'tiktok_ad_meta_data',
    timestamps:true
  });
  return tiktok_ad_meta_data;
};