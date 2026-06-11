'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_requests', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      user_id: {
        type: Sequelize.INTEGER
      },
      user_type: {
        type: Sequelize.INTEGER
      },
      keywords: {
        type: Sequelize.TEXT
      },
      advertiser: {
        type: Sequelize.TEXT
      },
      url: {
        type: Sequelize.TEXT
      },
      sent_status: {
        type: Sequelize.INTEGER
      },
      country: {
        type: Sequelize.TEXT
      },
      keyword_status: {
        type: Sequelize.INTEGER
      },
      advertiser_status: {
        type: Sequelize.INTEGER
      },
      url_status: {
        type: Sequelize.INTEGER
      },
      priority_flag: {
        type: Sequelize.INTEGER
      },
      processed_date: {
        type: Sequelize.INTEGER
      },
      last_crawled_date: {
        type: Sequelize.DATE
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
    await queryInterface.dropTable('user_requests');
  }
};