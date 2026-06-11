'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class amember_user_action extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  amember_user_action.init({
    id: {
      type: DataTypes.INTEGER,
      unique: true,
      primaryKey: true,
      autoIncrement:true
    },
    amember_id:{
      type: DataTypes.INTEGER,
      allowNull:false,
      unique:true
    },
    user_name:{
      type: DataTypes.STRING,
    } ,
    amember_email:{
      type: DataTypes.STRING,
      allowNull:false,
    },
    amember_subscription :{
      type: DataTypes.INTEGER,
      allowNull:false
    },
    ad_count :{
      type: DataTypes.INTEGER
    },
   month_count :{
      type: DataTypes.INTEGER,
      defaultValue:0
    },
    date :{
      type: DataTypes.DATEONLY
    },
    start_date :{
      type: DataTypes.DATEONLY
    },
    end_date :{
      type: DataTypes.DATEONLY
    },
  }, {
    sequelize,
    modelName: 'amember_user_actions',
    timestamps:true
  });
  return amember_user_action;
};