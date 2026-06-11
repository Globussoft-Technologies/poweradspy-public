'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class mail_subscription extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  mail_subscription.init({
    id: {
      type: DataTypes.INTEGER,
      unique: true,
      primaryKey: true,
      autoIncrement:true
    },
    user_id:{
      type: DataTypes.INTEGER,
      allowNull:false,
      unique:true
    },
    name:{
      type: DataTypes.STRING,
    } ,
    email:{
      type: DataTypes.STRING,
    },
    shopify_mail_status:{
      type: DataTypes.INTEGER,
      defaultValue:1
    },
    cpa_mail_status:{
      type: DataTypes.INTEGER,
      defaultValue:1
    },
    Latest_Ad_status :{
      type: DataTypes.INTEGER,
      defaultValue:1
    },
    keywords_mail_status :{
      type: DataTypes.INTEGER,
      defaultValue:1
    }     
  }, {
    sequelize,
    modelName: 'mail_subscription',
    timestamps:true
  });
  return mail_subscription;
};