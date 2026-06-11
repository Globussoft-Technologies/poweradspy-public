'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('keyword_notification', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
       user_id:{
         type: Sequelize.INTEGER(11),
         allowNull: false
       },
       name:{
        type: Sequelize.STRING,
        allowNull: false
      },
       keyword:{
         type: Sequelize.STRING,
        allowNull: false
       },
       duration:{
         type: Sequelize.INTEGER(2),//'1: daily, 2:weekly, 3:monthly '
         allowNull: false
       },
       type:{
         type: Sequelize.TINYINT(4),//'1: keyword, 2: advertiser',
         allowNull: false
       },
       status:{
         type: Sequelize.INTEGER(1),
         allowNull: false,
         defaultValue: 0
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
    await queryInterface.dropTable('keyword_notifications');
  }
};