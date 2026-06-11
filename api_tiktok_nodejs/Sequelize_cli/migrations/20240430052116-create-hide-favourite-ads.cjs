'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('hide_favourite_ads', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      ad_id: {
        type: Sequelize.STRING,
      },
      post_owner_id: {
        type: Sequelize.INTEGER,
      },
      type:{
        type:
        Sequelize.INTEGER
      },
     status: {
        type: Sequelize.TEXT
      },
      is_notified: {
        type: Sequelize.TEXT
      },
      is_requested: {
        type: Sequelize.TEXT
      },
      lcs_status: {
        type: Sequelize.TEXT
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
    await queryInterface.dropTable('hide_favourite_ads');
  }
};