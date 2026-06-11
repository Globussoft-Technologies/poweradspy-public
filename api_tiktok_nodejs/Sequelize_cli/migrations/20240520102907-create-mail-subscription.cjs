'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('mail_subscription', {
      id: {
        type: Sequelize.INTEGER,
        unique: true,
        primaryKey: true,
        autoIncrement:true
      },
      user_id:{
        type: Sequelize.INTEGER,
        allowNull:false,
        unique:true
      },
      name:{
        type: Sequelize.STRING,
      } ,
      email:{
        type: Sequelize.STRING,
      },
      shopify_mail_status:{
        type: Sequelize.INTEGER,
        defaultValue:1
      },
      cpa_mail_status:{
        type: Sequelize.INTEGER,
        defaultValue:1
      },
      Latest_Ad_status :{
        type: Sequelize.INTEGER,
        defaultValue:1
      },
      keywords_mail_status :{
        type: Sequelize.INTEGER,
        defaultValue:1
      },  
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('mail_subscriptions');
  }
};