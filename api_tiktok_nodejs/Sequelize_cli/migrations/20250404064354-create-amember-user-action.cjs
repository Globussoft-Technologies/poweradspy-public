'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('amember_user_actions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      amember_id:{
        type: Sequelize.INTEGER,
        allowNull:false,
        unique:true
      },
      user_name:{
        type: Sequelize.STRING,
      } ,
      amember_email:{
        type: Sequelize.STRING,
        allowNull:false,
      },
      amember_subscription :{
        type: Sequelize.INTEGER,
        allowNull:false
      },
      ad_count :{
        type: Sequelize.INTEGER
      },
     month_count :{
        type: Sequelize.INTEGER,
        defaultValue:0
      },
      date :{
        type: Sequelize.DATEONLY
      },
      start_date :{
        type: Sequelize.DATEONLY
      },
      end_date :{
        type: Sequelize.DATEONLY
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
    await queryInterface.dropTable('amember_user_actions');
  }
};