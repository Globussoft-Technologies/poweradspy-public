'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class user_details extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  user_details.init({
    amember_id: DataTypes.INTEGER,
    plan_id: DataTypes.INTEGER,
    plan_expiry_date: DataTypes.DATE,
    company_name: DataTypes.STRING,
    email: DataTypes.STRING,
    url: DataTypes.STRING,
    phone_number: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'user_details',
  });
  return user_details;
};