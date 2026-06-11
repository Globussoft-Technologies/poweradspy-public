'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class user_requests extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  user_requests.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.INTEGER
    },
    user_type: {
      type: DataTypes.INTEGER
    },
    keywords: {
      type: DataTypes.TEXT
    },
    advertiser: {
      type: DataTypes.TEXT
    },
    url: {
      type: DataTypes.TEXT
    },
    sent_status: {
      type: DataTypes.INTEGER
    },
    country: {
      type: DataTypes.TEXT
    },
    keyword_status: {
      type: DataTypes.INTEGER
    },
    advertiser_status: {
      type: DataTypes.INTEGER
    },
    url_status: {
      type: DataTypes.INTEGER
    },
    priority_flag: {
      type: DataTypes.INTEGER
    },
    processed_date: {
      type: DataTypes.INTEGER
    },
    last_crawled_date: {
      type: DataTypes.DATE
    },
  }, {
    sequelize,
    modelName: 'user_requests',
    timestamps:true
  });
  return user_requests;
};