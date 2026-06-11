'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class keyword_notification extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  keyword_notification.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    name:{
      type: DataTypes.STRING,
      allowNull: false
    },
     user_id:{
       type: DataTypes.INTEGER(11),
       allowNull: false
     },
     keyword:{
       type: DataTypes.STRING,
      allowNull: false
     },
     duration:{
       type: DataTypes.INTEGER(2),//'1: daily, 2:weekly, 3:monthly '
       allowNull: false
     },
     type:{
       type: DataTypes.TINYINT(4),//'1: keyword, 2: advertiser',
       allowNull: false
     },
     status:{
       type: DataTypes.INTEGER(1),
       allowNull: false,
       defaultValue: 0
     }
  }, {
    sequelize,
    modelName: 'keyword_notification',
    timestamps:true
  });
  return keyword_notification;
};